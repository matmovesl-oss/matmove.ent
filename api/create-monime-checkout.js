import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId } = req.body;
    if (!amount || !userId) return res.status(400).json({ error: 'Missing amount or user ID.' });

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // Dynamically capture the exact dashboard URL the user is currently on
    const referer = req.headers.referer;
    let returnPath = '/';
    if (referer) {
      returnPath = new URL(referer).pathname; // e.g., will capture "/customer/rider"
    }

    const reference = `MM_MOMO_${userId}_${Date.now()}`;
    const baseAmount = Number(amount);

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
        // Pass the exact path into the success and cancel handlers
        successUrl: `https://matmoveent.vercel.app/api/monime-success?path=${encodeURIComponent(returnPath)}`,
        cancelUrl: `https://matmoveent.vercel.app/api/monime-cancel?path=${encodeURIComponent(returnPath)}`,
        lineItems: [
          {
            name: 'Wallet Top Up',
            price: { currency: 'SLE', value: Math.round(baseAmount * 100) },
            quantity: 1
          }
        ]
      })
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) throw new Error(`Monime rejected: ${JSON.stringify(rawData)}`);

    const session = rawData.result || rawData.data || rawData;
    const checkoutLink = session.redirectUrl;

    if (!checkoutLink) throw new Error("Checkout link missing");

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from('payment_transactions').insert({
      user_id: userId,
      transaction_type: 'wallet_topup',
      provider: 'monime',
      amount: baseAmount,
      currency: 'SLE',
      status: 'pending',
      metadata: { reference: reference, session_id: session.id }
    });

    return res.status(200).json({ link: checkoutLink });

  } catch (error) {
    console.error('Monime Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}