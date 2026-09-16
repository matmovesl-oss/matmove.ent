import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;

    // 1. Load Keys
    const merchantId = process.env.VULT_MERCHANT_ID;
    let privateKey = process.env.VULT_PRIVATE_KEY || '';

    // Vercel often escapes newlines in environment variables. This safely restores them.
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!merchantId || !privateKey) {
      return res.status(500).json({ error: 'Vult environment configuration missing.' });
    }

    // 2. Construct Payload EXACTLY per Vult Documentation
    // Enforcing 'card' or 'momo' based on user selection
    const vultType = type === 'momo' ? 'momo' : 'card';
    const orderId = `MM_${userId}_${Date.now()}`;
    
    const requestBody = {
      merchantId: merchantId,
      type: vultType,
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: String(amount)
      }
    };

    // Serialize once
    const bodyString = JSON.stringify(requestBody);

    // 3. Cryptographic Signature (Direct from Vult Node.js spec)
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    // 4. Send to Vult Production Endpoint
    const vultRes = await fetch('https://wallet.vultme.io/api/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vult-Merchant-Signature': signature
      },
      body: bodyString
    });

    const resText = await vultRes.text();
    
    if (!vultRes.ok) {
      console.error(`Vult Rejected (${vultRes.status}):`, resText);
      return res.status(vultRes.status).json({ 
        error: `Vult Gateway Error (${vultRes.status}): ${resText}` 
      });
    }

    const data = JSON.parse(resText);

    // 5. Save Pending Transaction to Supabase
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

    // 6. Return Data to Frontend
    return res.status(200).json({
      link: data?.data?.link || null,
      code: data?.data?.code || null
    });

  } catch (err) {
    console.error('Checkout Exception:', err);
    return res.status(500).json({ error: err.message });
  }
}