import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
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
    const transactionRef = `MONIME_${userId}_${Date.now()}`;
    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    const destinationDashboard = returnUrl || `${req.headers.origin}/customer/${role || 'rider'}`;
    const safeCallbackUrl = `${req.headers.origin}/api/unified-webhook?returnUrl=${encodeURIComponent(destinationDashboard)}&provider=monime&ref=${transactionRef}&amount=${amount}`;

    const payload = {
      name: "MatMove Wallet Top-Up",
      reference: transactionRef,
      financialAccountId: monimeAccountId,
      successUrl: safeCallbackUrl,
      cancelUrl: destinationDashboard,
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
      throw new Error(rawData.messages?.join(', ') || 'Monime checkout failed.');
    }

    const checkoutUrl = 
      rawData?.result?.redirectUrl || 
      rawData?.result?.url || 
      rawData?.redirectUrl || 
      rawData?.url || 
      rawData?.data?.redirectUrl || 
      rawData?.checkoutUrl;

    if (!checkoutUrl) throw new Error('Checkout session created, but redirect URL was missing.');

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    console.error('Monime Checkout Error:', error);
    return res.status(500).json({ error: error.message || 'Internal payment error' });
  }
}