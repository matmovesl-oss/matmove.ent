import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount.' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Fetch the user's specific Monime Account ID from their SLE wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('metadata')
      .eq('user_id', userId)
      .eq('currency', 'SLE')
      .single();

    if (walletError || !wallet?.metadata?.monime_account_id) {
      throw new Error('User does not have a linked Monime Financial Account.');
    }

    const monimeAccountId = wallet.metadata.monime_account_id;
    const transactionRef = `MM_MOMO_${userId}_${Date.now()}`;
    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // 2. Create the Checkout session and route it to the user's sub-account
    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': transactionRef
      },
      body: JSON.stringify({
        name: 'MatMove Wallet Load',
        reference: transactionRef,
        financialAccountId: monimeAccountId, // <-- THIS ROUTES THE MONEY DIRECTLY TO THE USER
        successUrl: `https://matmoveent.vercel.app/api/monime-success?ref=${transactionRef}`,
        cancelUrl: `https://matmoveent.vercel.app/api/monime-cancel?ref=${transactionRef}`,
        lineItems: [
          {
            name: 'Wallet Top-up',
            type: 'custom',
            quantity: 1,
            price: {
              currency: 'SLE',
              value: Number(amount)
            }
          }
        ]
      })
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(`Monime checkout failed: ${JSON.stringify(rawData)}`);
    }

    // Monime returns the checkout URL in data.url or data.checkout_url
    const checkoutUrl = rawData.data?.url || rawData.result?.url || rawData.data?.checkout_url;

    return res.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}