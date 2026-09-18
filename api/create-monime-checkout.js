import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1. Extract the returnUrl passed from the frontend
    const { userId, amount, role, returnUrl } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount.' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: wallets, error: walletError } = await supabase
      .from('wallets')
      .select('metadata')
      .eq('user_id', userId)
      .eq('currency', 'SLE');

    if (walletError) throw new Error('Database error while fetching wallets.');

    const wallet = wallets?.find(w => w.metadata?.monime_account_id);
    if (!wallet) throw new Error('User does not have a linked Monime Financial Account.');

    const monimeAccountId = wallet.metadata.monime_account_id;
    const transactionRef = `MM_MOMO_${userId}_${Date.now()}`;
    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // 2. Define the exact redirect path using returnUrl
    const redirectUrl = returnUrl || `${req.headers.origin}/customer/${role}`;

    const payload = {
      name: "MatMove Wallet Load",
      reference: transactionRef,
      financialAccountId: monimeAccountId,
      successUrl: redirectUrl, // Dynamic return
      cancelUrl: redirectUrl,  // Dynamic return
      lineItems: [
        {
          type: "custom",
          name: "Wallet Top-up",
          quantity: 1,
          price: {
            currency: "SLE",
            value: Math.round(Number(amount) * 100)
          }
        }
      ]
    };

    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': transactionRef
      },
      body: JSON.stringify(payload)
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(`Monime checkout failed: ${JSON.stringify(rawData)}`);
    }

    const checkoutUrl = 
      rawData?.url || rawData?.redirectUrl || rawData?.data?.url ||
      rawData?.data?.redirectUrl || rawData?.result?.url ||
      rawData?.result?.redirectUrl || rawData?.checkoutUrl || rawData?.data?.checkoutUrl;

    if (!checkoutUrl) throw new Error(`MISSING URL. Monime responded with: ${JSON.stringify(rawData)}`);

    return res.status(200).json({ checkoutUrl, url: checkoutUrl, redirectUrl: checkoutUrl, link: checkoutUrl });
  } catch (error) {
    console.error('Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}