import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, fromCurrency = 'USD', toCurrency = 'SLE', amount } = req.body;
    const numAmount = Number(amount);

    if (!userId || !numAmount || numAmount <= 0) {
      return res.status(400).json({ error: 'Invalid conversion parameters.' });
    }

    const sourceCurr = String(fromCurrency).toUpperCase();
    const targetCurr = String(toCurrency).toUpperCase();

    if (sourceCurr === targetCurr) {
      return res.status(400).json({ error: 'Source and target currencies must be different.' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch live rate from exchange_rates table (Default: 1 USD = 26 SLE)
    const { data: rateData } = await supabase
      .from('exchange_rates')
      .select('*')
      .eq('from_currency', 'USD')
      .eq('to_currency', 'SLE')
      .maybeSingle();

    const baseRateUsdToSle = rateData?.rate ? Number(rateData.rate) : 26.00;
    const rate = sourceCurr === 'USD' ? baseRateUsdToSle : (1 / baseRateUsdToSle);
    const convertedAmount = numAmount * rate;

    // 2. Fetch user wallets from MatMove's local Supabase Ledger
    const { data: wallets, error: wErr } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId);

    if (wErr || !wallets || wallets.length === 0) {
      return res.status(400).json({ error: 'Wallets not found for user.' });
    }

    const sourceWallet = wallets.find(w => String(w.currency).toUpperCase() === sourceCurr);
    const targetWallet = wallets.find(w => String(w.currency).toUpperCase() === targetCurr);

    if (!sourceWallet || !targetWallet) {
      return res.status(400).json({ error: `Both ${sourceCurr} and ${targetCurr} wallets must be active.` });
    }

    const sourceAccountId = sourceWallet.monime_account_id || sourceWallet.metadata?.monime_account_id;
    const targetAccountId = targetWallet.monime_account_id || targetWallet.metadata?.monime_account_id;

    // 3. Verify Local Ledger Balance (Bypassing Monime's strict same-currency limit)
    const currentSourceBalance = Number(sourceWallet.balance || 0);
    
    if (currentSourceBalance < numAmount) {
      return res.status(400).json({ error: `Insufficient ${sourceCurr} balance. Available: ${sourceCurr} ${currentSourceBalance.toFixed(2)}` });
    }

    // 4. Update Supabase Wallets Table (MatMove acts as the exchange Middleman)
    const currentTargetBalance = Number(targetWallet.balance || 0);
    const newSourceBal = Math.max(0, currentSourceBalance - numAmount);
    const newTargetBal = currentTargetBalance + convertedAmount;

    // Deduct from Source
    const { error: updErr1 } = await supabase
      .from('wallets')
      .update({ balance: newSourceBal, updated_at: new Date().toISOString() })
      .eq('id', sourceWallet.id);
    if (updErr1) throw new Error("Failed to debit source wallet.");

    // Credit to Target
    const { error: updErr2 } = await supabase
      .from('wallets')
      .update({ balance: newTargetBal, updated_at: new Date().toISOString() })
      .eq('id', targetWallet.id);
    if (updErr2) throw new Error("Failed to credit target wallet.");

    // Log the transaction internally
    await supabase.from('transactions').insert([
      {
        wallet_id: sourceWallet.id,
        type: 'conversion_out',
        amount: numAmount,
        currency: sourceCurr,
        status: 'completed',
        reference: `conv_out_${Date.now()}`
      },
      {
        wallet_id: targetWallet.id,
        type: 'conversion_in',
        amount: convertedAmount,
        currency: targetCurr,
        status: 'completed',
        reference: `conv_in_${Date.now()}`
      }
    ]);

    return res.status(200).json({
      success: true,
      convertedAmount: convertedAmount.toFixed(2),
      rate: rate,
      sourceBalance: newSourceBal.toFixed(2),
      targetBalance: newTargetBal.toFixed(2),
      sourceId: sourceAccountId,
      targetId: targetAccountId
    });
  } catch (error) {
    console.error('Convert API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}