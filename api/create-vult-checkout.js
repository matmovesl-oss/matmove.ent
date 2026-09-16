import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;

    if (!amount || Number(amount) <= 0 || !userId) {
      return res.status(400).json({ error: 'Missing amount or user ID.' });
    }

    // Load Vult credentials
    const merchantId = process.env.VULT_MERCHANT_ID;
    let privateKey = process.env.VULT_PRIVATE_KEY;

    if (!merchantId || !privateKey) {
      console.error('Missing VULT_MERCHANT_ID or VULT_PRIVATE_KEY in Vercel Environment Variables.');
      return res.status(500).json({ error: 'Vult payment gateway credentials not configured.' });
    }

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Generate unique order ID for reconciliation
    const orderId = `MM_${userId}_${Date.now()}`;

    // Map payment type to Vult specs
    let vultType = 'in-app';
    if (type === 'card') vultType = 'card';
    if (type === 'momo') vultType = 'momo';

    const requestBody = {
      merchantId: merchantId,
      type: vultType,
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: String(amount)
      }
    };

    const bodyString = JSON.stringify(requestBody);

    // Cryptographic RSA-SHA512 Signature
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

    if (!vultRes.ok) {
      const errText = await vultRes.text();
      console.error('Vult Gateway Error Response:', errText);
      return res.status(vultRes.status).json({ error: `Vult Error: ${errText || 'Failed to generate payment link'}` });
    }

    const data = await vultRes.json();

    // Register pending transaction in Supabase
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
        metadata: { order_id: orderId }
      });
    }

    return res.status(200).json({ link: data?.data?.link, code: data?.data?.code });

  } catch (error) {
    console.error('Create Vult Checkout Exception:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}