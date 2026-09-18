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

    // 2. Create the Checkout session using the EXACT fields Monime requires
    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': transactionRef
      },
      body: JSON.stringify({
        amount: Number(amount),
        currency: 'SLE',
        reference: transactionRef,
        financialAccountId: monimeAccountId, // <-- Routes the money directly to the user
        success_url: `https://matmoveent.vercel.app/api/monime-success?ref=${transactionRef}`,
        cancel_url: `https://matmoveent.vercel.app/api/monime-cancel?ref=${transactionRef}`
      })
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(`Monime checkout failed: ${JSON.stringify(rawData)}`);
    }

    // 3. Extract the URL safely. Monime returns it in either rawData.url or rawData.data.url
    const checkoutUrl = rawData.url || rawData.data?.url || rawData.checkout_url || rawData.data?.checkout_url;

    if (!checkoutUrl) {
      console.error("Monime API returned session without a URL:", JSON.stringify(rawData));
      throw new Error("Could not find the checkout URL in Monime's response.");
    }

    return res.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}