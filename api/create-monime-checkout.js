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

    const reference = `MM_MOMO_${userId}_${Date.now()}`;

    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId
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

    const data = await monimeRes.json();

    if (!monimeRes.ok) {
      console.error("Monime API Rejected:", data);
      
      // Fixes the [object Object] issue by forcing the error into a readable string
      let errorMessage = 'Unauthorized: Check Monime API Keys';
      if (typeof data.message === 'string') errorMessage = data.message;
      else if (typeof data.error === 'string') errorMessage = data.error;
      else if (data.message || data.error) errorMessage = JSON.stringify(data.message || data.error);
      
      throw new Error(errorMessage);
    }

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
      metadata: { reference: reference, session_id: data.id }
    });

    return res.status(200).json({ link: data.redirectUrl || data.checkout_url });

  } catch (error) {
    console.error('Monime Checkout Error:', error);
    // Ensure we are passing a clean string back to the frontend
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}