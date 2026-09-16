import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;

    if (!amount || Number(amount) <= 0 || !userId) {
      return res.status(400).json({ error: 'Missing amount or user ID.' });
    }

    const merchantId = process.env.VULT_MERCHANT_ID;
    let privateKey = process.env.VULT_PRIVATE_KEY;

    if (!merchantId || !privateKey) {
      return res.status(500).json({ error: 'Vult API credentials (MERCHANT_ID or PRIVATE_KEY) are missing in Vercel.' });
    }

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

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

    // Serialize payload once to ensure identical bytes for signature and request body
    const bodyString = JSON.stringify(requestBody);

    // Generate RSA-SHA512 Signature with PSS Padding (matching Vult's official Node snippet)
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    // Call Vult PROD API
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
    try {
      data = JSON.parse(resText);
    } catch {
      data = { raw: resText };
    }

    if (!vultRes.ok) {
      console.error('Vult API Error:', resText);
      const detailMsg = data?.message || data?.error || resText || 'Failed to generate payment link';
      return res.status(vultRes.status).json({ error: `Vult Error (${vultRes.status}): ${detailMsg}` });
    }

    // Record pending transaction in Supabase
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
    console.error('Vult Checkout Exception:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}