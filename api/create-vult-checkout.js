import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, type } = req.body;
    const orderId = `MM_${userId}_${Date.now()}`;

    // 1. If user chose MoMo on Vult, we request a USSD payment code
    // 2. If user chose Card/Vult, we request a payment link
    const vultType = type === 'card' ? 'card' : type === 'momo' ? 'momo' : 'vult';[cite: 1]

    const requestBody = {
      merchantId: process.env.VULT_MERCHANT_ID,[cite: 1]
      type: vultType,[cite: 1]
      payload: {
        orderId: orderId,[cite: 1]
        currency: 'SLE',[cite: 1]
        amount: String(amount)[cite: 1]
      }
    };

    // Save intent in Supabase
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    await supabase.from('payment_transactions').insert({
      user_id: userId,
      transaction_type: 'wallet_topup',
      provider: 'vult',
      amount: Number(amount),
      currency: 'SLE',
      status: 'pending',
      metadata: { order_id: orderId, type: vultType }
    });

    // Directly request link/code from Vult
    const vultRes = await fetch('https://wallet.vultme.io/api/merchants/private/v1/payment-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await vultRes.json();

    // Return link (for card) OR code (for USSD momo)[cite: 1]
    return res.status(200).json({
      link: data?.data?.link || null,[cite: 1]
      code: data?.data?.code || null[cite: 1]
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}