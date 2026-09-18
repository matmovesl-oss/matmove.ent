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

    // 2. Format the payload EXACTLY as Monime documentation requires
    const payload = {
      name: "MatMove Wallet Load",
      reference: transactionRef,
      financialAccountId: monimeAccountId,
      successUrl: `https://matmoveent.vercel.app/api/monime-success?ref=${transactionRef}`,
      cancelUrl: `https://matmoveent.vercel.app/api/monime-cancel?ref=${transactionRef}`,
      lineItems: [
        {
          type: "custom",
          name: "Wallet Top-up",
          quantity: 1,
          price: {
            currency: "SLE",
            value: Math.round(Number(amount) * 100) // MUST be in minor units (cents)
          }
        }
      ]
    };

    // 3. Create the Checkout session
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

    // 4. BULLETPROOF URL EXTRACTION
    // Checks every possible property Monime might use to return the link
    const checkoutUrl = 
      rawData?.url ||
      rawData?.redirectUrl || 
      rawData?.data?.url ||
      rawData?.data?.redirectUrl || 
      rawData?.result?.url ||
      rawData?.result?.redirectUrl || 
      rawData?.checkoutUrl ||
      rawData?.data?.checkoutUrl;

    // If the URL is still somehow missing, push the exact Monime response to the frontend alert
    if (!checkoutUrl) {
      throw new Error(`MISSING URL. Monime responded with: ${JSON.stringify(rawData)}`);
    }

   // Send the URL using multiple common labels so the frontend catches it
    return res.status(200).json({ 
      checkoutUrl: checkoutUrl, 
      url: checkoutUrl, 
      redirectUrl: checkoutUrl,
      link: checkoutUrl
    });