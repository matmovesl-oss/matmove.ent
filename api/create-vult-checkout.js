import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function formatPemPrivateKey(keyString) {
  if (!keyString) return '';
  let cleaned = keyString.trim();
  if (cleaned.includes('\\n')) {
    cleaned = cleaned.replace(/\\n/g, '\n');
  }
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
      return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const merchantId = process.env.VULT_MERCHANT_ID;
    const rawPrivateKey = process.env.VULT_PRIVATE_KEY;

    if (!merchantId || !rawPrivateKey) {
      return res.status(500).json({ error: 'VULT_MERCHANT_ID or VULT_PRIVATE_KEY missing in Vercel environment.' });
    }

    const formattedPrivateKey = formatPemPrivateKey(rawPrivateKey);

    // Map top-up method to Vult API enum: 'momo', 'card', or 'vult'
    let vultType = 'vult';
    if (type === 'card') vultType = 'card';
    if (type === 'momo') vultType = 'momo';

    const orderId = `MM_${userId}_${Date.now()}`;
    const requestBody = {
      merchantId: merchantId,
      type: vultType,
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: String(Number(amount))
      }
    };

    const bodyString = JSON.stringify(requestBody);

    // Generate strict RSA-SHA512 signature required by Vult
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    const signature = signer.sign({
      key: formattedPrivateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    // Call Vult Payment Link Endpoint
    const vultRes = await fetch('https://wallet.vultme.io/api/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vult-Merchant-Signature': signature
      },
      body: bodyString
    });

    const rawText = await vultRes.text();
    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error('Vult returned non-JSON response:', rawText);
      return res.status(vultRes.status || 500).json({ error: `Vult Gateway Error (${vultRes.status}): ${rawText}` });
    }

    if (!vultRes.ok) {
      return res.status(vultRes.status).json({ error: data?.message || data?.error || 'Vult link generation failed.' });
    }

    // Save pending intent in Supabase
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

    // Return URL link for Card/Vult, or USSD code for MoMo
    return res.status(200).json({
      link: data?.data?.link || data?.link || null,
      code: data?.data?.code || data?.code || null
    });

  } catch (err) {
    console.error('Checkout Exception:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}