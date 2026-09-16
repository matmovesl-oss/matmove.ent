import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function formatPemPrivateKey(keyString) {
  if (!keyString) return '';
  let cleaned = keyString.trim();

  // Replace escaped line breaks if pasted into Vercel UI as single-line string
  if (cleaned.includes('\\n')) {
    cleaned = cleaned.replace(/\\n/g, '\n');
  }

  // Ensure valid PEM header wrapping if missing
  if (!cleaned.includes('-----BEGIN PRIVATE KEY-----') && !cleaned.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    const rawBody = cleaned.replace(/[\r\n\s]/g, '');
    const chunked = rawBody.match(/.{1,64}/g)?.join('\n') || rawBody;
    cleaned = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----`;
  }

  return cleaned;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;

    if (!amount || Number(amount) <= 0 || !userId) {
      return res.status(400).json({ error: 'Missing amount or user ID.' });
    }

    const merchantId = process.env.VULT_MERCHANT_ID;
    const rawPrivateKey = process.env.VULT_PRIVATE_KEY;

    if (!merchantId || !rawPrivateKey) {
      return res.status(500).json({ 
        error: 'Vult API configuration missing: VULT_MERCHANT_ID or VULT_PRIVATE_KEY is unassigned in Vercel.' 
      });
    }

    const formattedPrivateKey = formatPemPrivateKey(rawPrivateKey);

    // Map top-up method to Vult's strict schema enum: 'momo', 'card', or 'in-app'
    let vultType = 'in-app';
    if (type === 'card') vultType = 'card';
    if (type === 'momo') vultType = 'momo';

    const orderId = `MM_${userId}_${Date.now()}`;
    const formattedAmount = String(Number(amount));

    // Payload structured strictly according to Vult API spec
    const requestBody = {
      merchantId: merchantId,
      type: vultType,
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: formattedAmount
      }
    };

    // Serialize payload once to ensure identical string for signature generation and HTTP body
    const bodyString = JSON.stringify(requestBody);

    // Generate RSA-SHA512 Signature with PSS Padding (matching Vult's official spec)[cite: 1]
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    
    let signature;
    try {
      signature = signer.sign({
        key: formattedPrivateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }, 'base64');
    } catch (pemError) {
      console.error('RSA Signing Error:', pemError);
      return res.status(500).json({ 
        error: 'Failed to generate Vult cryptographic signature. Check VULT_PRIVATE_KEY PEM format.' 
      });
    }

    // Call Vult PROD API endpoint[cite: 1]
    const vultRes = await fetch('https://wallet.vultme.io/api/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vult-Merchant-Signature': signature
      },
      body: bodyString
    });

    const resText = await vultRes.text();
    let data;
    try { data = JSON.parse(resText); } catch { data = { raw: resText }; }

    if (!vultRes.ok) {
      console.error(`Vult API Rejected Request (${vultRes.status}):`, resText);
      
      // If 403, output specific signature troubleshooting step
      if (vultRes.status === 403) {
        return res.status(403).json({ 
          error: `Vult 403 Forbidden: Signature or Merchant ID mismatch. Verify VULT_MERCHANT_ID matches the RSA key registered with Vult.` 
        });
      }

      return res.status(vultRes.status).json({ 
        error: `Vult Error (${vultRes.status}): ${data?.message || data?.error || resText}` 
      });
    }

    // Store pending payment record in Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey);
      await supabase.from('payment_transactions').insert({
        user_id: userId,
        transaction_type: 'wallet_topup',
        provider: 'vult',
        amount: Number(amount),
        currency: 'SLE',
        status: 'pending',
        metadata: { order_id: orderId, vult_type: vultType }
      });
    }

    return res.status(200).json({ 
      link: data?.data?.link || data?.link || null, 
      code: data?.data?.code || data?.code || null 
    });

  } catch (error) {
    console.error('Vult Checkout Route Exception:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}