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
      return res.status(500).json({ error: 'Monime API credentials missing in Vercel.' });
    }

    // 1. Generate unique reference for this transaction
    const reference = `MM_MOMO_${userId}_${Date.now()}`;

    // 2. Call Monime API to create checkout session
    // (Ensure this URL matches the endpoint provided in your Monime Docs)
    const monimeRes = await fetch('https://api.monime.sl/v1/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        space_id: spaceId,
        amount: Number(amount),
        currency: 'SLE',
        reference: reference,
        description: 'MatMove Wallet Top Up',
        // Update this URL to where you want the user to return after paying
        return_url: 'https://matmoveent.vercel.app/rider-dashboard' 
      })
    });

    const data = await monimeRes.json();

    if (!monimeRes.ok) {
      throw new Error(data.message || 'Failed to initialize Monime checkout');
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
      metadata: { reference: reference }
    });

    // 4. Send the Monime secure checkout URL back to the frontend
    return res.status(200).json({ link: data.checkout_url });

  } catch (error) {
    console.error('Monime Checkout Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}