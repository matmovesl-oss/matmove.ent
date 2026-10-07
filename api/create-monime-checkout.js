import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, role = 'rider' } = req.body;
    if (!amount || !userId) return res.status(400).json({ error: 'Missing amount or userId.' });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: wallet } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE').maybeSingle();
    let targetAccountId = wallet?.monime_account_id || wallet?.metadata?.monime_account_id;
    
    if (!targetAccountId) return res.status(400).json({ error: 'User Monime Account could not be resolved.' });

    const loadAmountMinor = Math.round(Number(amount) * 100);
    const hostUrl = req.headers.origin || 'https://matmoveent.vercel.app';

    // 🔴 CRITICAL FIX: Route success and cancel to the new bouncer API
    const payload = {
      name: `MatMove Wallet Top-up`,
      successUrl: `${hostUrl}/api/monime-return?status=success`, 
      cancelUrl: `${hostUrl}/api/monime-return?status=cancelled`,
      financialAccountId: targetAccountId,
      lineItems: [{ type: "custom", name: "Wallet Load", price: { currency: "SLE", value: loadAmountMinor }, quantity: 1 }],
      metadata: { userId: userId, role: role }
    };

    const monimeResponse = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 'Accept': '*/*', 
        'Authorization': `Bearer ${process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY}`, 
        'Monime-Space-Id': process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID, 
        'Idempotency-Key': `load-${userId}-${Date.now()}` 
      },
      body: JSON.stringify(payload)
    });

    const rawText = await monimeResponse.text();
    let sessionData = {};
    try { sessionData = JSON.parse(rawText); } catch (e) { return res.status(500).json({ error: "Gateway Error: Did not receive valid JSON." }); }

    if (!monimeResponse.ok) return res.status(400).json({ error: sessionData.message || 'Payment creation failed' });
    const checkoutUrl = sessionData.result?.redirectUrl || sessionData.result?.url || sessionData.url || sessionData.redirectUrl;
    if (!checkoutUrl) return res.status(400).json({ error: 'Monime did not return a valid checkout URL.' });

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}