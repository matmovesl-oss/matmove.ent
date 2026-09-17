import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId } = req.body;

    if (!amount || !userId) {
      return res.status(400).json({ error: 'Missing amount or user ID.' });
    }

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    if (!apiKey || !spaceId) {
      return res.status(401).json({ error: 'Monime API credentials missing in Vercel.' });
    }

    // 1. Generate unique reference for this transaction (Idempotency Key)
    const reference = `MM_MOMO_${userId}_${Date.now()}`;

    // 2. Call Monime API
    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': reference
      },
      body: JSON.stringify({
        name: 'MatMove Wallet Top Up',
        reference: reference,
        successUrl: 'https://matmoveent.vercel.app/rider-dashboard',
        cancelUrl: 'https://matmoveent.vercel.app/rider-dashboard',
        lineItems: [
          {
            name: 'Wallet Top Up',
            price: {
              currency: 'SLE',
              value: Number(amount)
            },
            quantity: 1
          }
        ]
      })
    });

    const rawData = await monimeRes.json();

    if (!monimeRes.ok) {
      console.error("Monime API Rejected:", rawData);
      let errorMessage = 'Unauthorized: Check Monime API Keys';
      if (typeof rawData.message === 'string') errorMessage = rawData.message;
      else if (typeof rawData.error === 'string') errorMessage = rawData.error;
      else if (rawData.message || rawData.error) errorMessage = JSON.stringify(rawData.message || rawData.error);
      throw new Error(errorMessage);
    }

    // Unwrap Monime's response to get the URL
    const session = rawData.data || rawData;
    const checkoutLink = session.redirectUrl || session.url;

    if (!checkoutLink) {
      throw new Error("Checkout link not found in Monime response");
    }

    // 3. Save pending transaction to Supabase
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from('payment_transactions').insert({
      user_id: userId,
      transaction_type: 'wallet_topup',
      provider: 'monime',
      amount: Number(amount),
      currency: 'SLE',
      status: 'pending',
      metadata: { reference: reference, session_id: session.id }
    });

    // 4. Send the correct link to the frontend
    return res.status(200).json({ link: checkoutLink });

  } catch (error) {
    console.error('Monime Checkout Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}