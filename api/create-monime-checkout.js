import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, role, returnUrl } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount.' });

    // Use Service Role to bypass RLS and read the protected metadata
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: wallets, error: walletError } = await supabase.from('wallets').select('metadata').eq('user_id', userId).eq('currency', 'SLE');
    if (walletError) throw new Error('Database error while fetching wallets.');

    const wallet = wallets?.find(w => w.metadata?.monime_account_id);
    if (!wallet) throw new Error('User does not have a linked Monime Financial Account.');

    const monimeAccountId = wallet.metadata.monime_account_id;
    const transactionRef = `MONIME_${userId}_${Date.now()}`;
    const destinationDashboard = returnUrl || `${req.headers.origin}/customer/${role}`;
    
    // Route to our Unified Webhook
    const safeCallbackUrl = `${req.headers.origin}/api/unified-webhook?returnUrl=${encodeURIComponent(destinationDashboard)}&provider=monime&ref=${transactionRef}&amount=${amount}`;

    const payload = {
      name: "MatMove Wallet Load",
      reference: transactionRef,
      financialAccountId: monimeAccountId,
      successUrl: safeCallbackUrl, 
      cancelUrl: destinationDashboard,
      lineItems: [
        { type: "custom", name: "Wallet Top-up", quantity: 1, price: { currency: "SLE", value: Math.round(Number(amount) * 100) } }
      ]
    };

    const monimeRes = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Idempotency-Key': transactionRef
      },
      body: JSON.stringify(payload)
    });

    const rawData = await monimeRes.json();
    const checkoutUrl = rawData?.url || rawData?.checkoutUrl || rawData?.data?.checkoutUrl || rawData?.data?.url;

    if (!checkoutUrl) throw new Error(`MISSING URL. Monime responded with: ${JSON.stringify(rawData)}`);

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    console.error('Checkout Error:', error);
    return res.status(500).json({ error: error.message });
  }
}