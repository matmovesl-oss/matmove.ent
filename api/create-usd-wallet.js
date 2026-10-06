import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Check if USD wallet already exists
    const { data: existing } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'USD').single();
    if (existing) return res.status(200).json({ wallet: existing });

    // 2. Create the Account in Monime
    const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID,
        'Idempotency-Key': `create-usd-${userId}-${Date.now()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: "USD Reserve Wallet",
        currency: "USD",
        reference: `usd_${userId}`
      })
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok) throw new Error(rawData.message || 'Failed to create Monime account');

    const accountId = rawData.result?.id || rawData.id;

    // 3. Save to Supabase
    const { data: newWallet, error: insertError } = await supabase.from('wallets').insert({
      user_id: userId,
      currency: 'USD',
      balance: 0,
      monime_account_id: accountId,
      is_frozen: false
    }).select().single();

    if (insertError) throw insertError;

    return res.status(200).json({ wallet: newWallet });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}