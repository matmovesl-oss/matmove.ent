import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, fromCurrency = 'USD', toCurrency = 'SLE', amount } = req.body;
    const numAmount = Number(amount);

    if (!userId || !numAmount || numAmount <= 0) return res.status(400).json({ error: 'Invalid parameters.' });

    const sourceCurr = String(fromCurrency).toUpperCase();
    const targetCurr = String(toCurrency).toUpperCase();
    if (sourceCurr === targetCurr) return res.status(400).json({ error: 'Must be different currencies.' });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: rateData } = await supabase.from('exchange_rates').select('*').eq('from_currency', sourceCurr).eq('to_currency', targetCurr).maybeSingle();
    let rate = sourceCurr === 'USD' ? 24.68 : (1 / 24.68);
    if (rateData && rateData.rate) rate = Number(rateData.rate);

    const convertedAmount = numAmount * rate;

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId);
    const sourceWallet = wallets?.find(w => String(w.currency).toUpperCase() === sourceCurr);
    const targetWallet = wallets?.find(w => String(w.currency).toUpperCase() === targetCurr);

    if (!sourceWallet || !targetWallet) return res.status(400).json({ error: `Both wallets must be active.` });
    if (Number(sourceWallet.balance || 0) < numAmount) return res.status(400).json({ error: `Insufficient ${sourceCurr} balance.` });

    const newSourceBal = Number(sourceWallet.balance) - numAmount;
    const newTargetBal = Number(targetWallet.balance) + convertedAmount;

    await supabase.from('wallets').update({ balance: newSourceBal, updated_at: new Date().toISOString() }).eq('id', sourceWallet.id);
    await supabase.from('wallets').update({ balance: newTargetBal, updated_at: new Date().toISOString() }).eq('id', targetWallet.id);

    return res.status(200).json({ success: true, rate });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}