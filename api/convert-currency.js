import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amountUsd } = req.body;
    if (!userId || !amountUsd) return res.status(400).json({ error: 'Missing parameters' });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch both wallets
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId);
    const sleWallet = wallets.find(w => w.currency === 'SLE');
    const usdWallet = wallets.find(w => w.currency === 'USD');

    if (!sleWallet?.monime_account_id || !usdWallet?.monime_account_id) {
       return res.status(400).json({ error: 'Both SLE and USD wallets must be active.' });
    }

    // Hit Monime Transfer endpoint to handle the internal FX swap
    const transferPayload = {
        sourceAccountId: usdWallet.monime_account_id,
        destinationAccountId: sleWallet.monime_account_id,
        amount: { currency: 'USD', value: Math.round(Number(amountUsd) * 100) },
        description: 'Internal Wallet Conversion (USD to SLE)'
    };

    const monimeRes = await fetch('https://api.monime.io/v1/transfers', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY}`,
            'Monime-Space-Id': process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID,
            'Content-Type': 'application/json',
            'Idempotency-Key': `convert-${userId}-${Date.now()}`
        },
        body: JSON.stringify(transferPayload)
    });

    const data = await monimeRes.json();
    if (!monimeRes.ok) throw new Error(data.message || 'Conversion failed at gateway');

    return res.status(200).json({ success: true, result: data });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}