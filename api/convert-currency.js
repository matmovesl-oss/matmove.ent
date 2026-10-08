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

    // 2. Fetch user wallets
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

    if (!sourceAccountId || !targetAccountId) {
      return res.status(400).json({ error: 'Monime Account IDs missing for transfer.' });
    }

    const apiKey = process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID;

    if (!apiKey || !spaceId) {
        return res.status(500).json({ error: 'Server configuration error: Monime API keys missing.' });
    }

    // 3. Fetch LIVE balance directly from Monime (ONLY IF SOURCE IS SLE)
    // Monime only natively supports SLE, so USD checks must rely on local ledger
    let liveSourceBalance = Number(sourceWallet.balance || 0);
    if (apiKey && spaceId && sourceCurr === 'SLE') {
      try {
        const accRes = await fetch(`https://api.monime.io/v1/financial-accounts/${sourceAccountId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Monime-Space-Id': spaceId,
            'Accept': 'application/json'
          }
        });
        if (accRes.ok) {
          const accData = await accRes.json();
          const availableValue = accData.result?.balance?.available?.value;
          if (typeof availableValue === 'number') {
            liveSourceBalance = availableValue / 100;
          }
        }
      } catch (e) {
        console.warn("Monime balance fetch warning:", e);
      }
    }

    if (liveSourceBalance < numAmount) {
      return res.status(400).json({ error: `Insufficient ${sourceCurr} balance. Available: ${sourceCurr} ${liveSourceBalance.toFixed(2)}` });
    }

    // 4. Ping Monime Financial Transaction (Catch their native Cross-Currency Rejection cleanly)
    const transferPayload = {
      amount: { 
        value: Math.round(numAmount * 100), 
        currency: sourceCurr 
      },
      sourceFinancialAccount: { id: sourceAccountId },
      destinationFinancialAccount: { id: targetAccountId },
      description: `MatMove Exchange Transfer: ${numAmount} ${sourceCurr} to ${targetCurr}`
    };

    const monimeRes = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': `convert-${userId}-${Date.now()}`
      },
      body: JSON.stringify(transferPayload)
    });

    const monimeData = await monimeRes.json();
    
    // Safely process the response without crashing on nested object errors
    if (!monimeRes.ok) {
       const errorObj = monimeData.error || {};
       const errorMsg = String(errorObj.message || monimeData.message || 'Monime internal transfer failed.');
       
       if (errorObj.reason === 'fund_insufficient' || (monimeData.failureDetail && monimeData.failureDetail.code === 'fund_insufficient')) {
           return res.status(400).json({ error: `Insufficient funds in your ${sourceCurr} account on Monime.` });
       }
       
       // Fallback: If Monime rejects cross-currency natively, safely proceed with MatMove's internal ledger
       if (errorMsg.toLowerCase().includes('currency') || errorObj.reason === 'invariant_violation') {
           console.warn("Monime rejected cross-currency transfer. Falling back to local Supabase ledger.");
       } else {
           // A genuine network or structural error occurred
           return res.status(400).json({ error: errorMsg });
       }
    }

    // 5. Update Supabase Wallets Table (The MatMove App Ledger handles the exchange)
    const oldTgtBal = Number(targetWallet.balance || 0);
    const newSourceBal = Math.max(0, liveSourceBalance - numAmount);
    const newTargetBal = oldTgtBal + convertedAmount;

    const { error: updErr1 } = await supabase.from('wallets').update({ balance: newSourceBal, updated_at: new Date().toISOString() }).eq('id', sourceWallet.id);
    if (updErr1) throw new Error("Failed to debit source wallet.");

    const { error: updErr2 } = await supabase.from('wallets').update({ balance: newTargetBal, updated_at: new Date().toISOString() }).eq('id', targetWallet.id);
    if (updErr2) throw new Error("Failed to credit target wallet.");

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