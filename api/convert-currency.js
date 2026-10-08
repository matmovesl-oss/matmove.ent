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

    // 3. Execute Monime Financial Transaction (Let Monime validate the true balance)
    const transferPayload = {
      amount: { 
        value: Math.round(numAmount * 100), 
        currency: sourceCurr 
      },
      sourceFinancialAccount: { 
        id: sourceAccountId 
      },
      destinationFinancialAccount: { 
        id: targetAccountId 
      },
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
    
    // Handle Errors or Rejections
    if (!monimeRes.ok) {
       let errorMsg = monimeData.message || monimeData.error || 'Monime internal transfer failed.';
       
       if (monimeData.failureDetail && monimeData.failureDetail.code === 'fund_insufficient') {
           return res.status(400).json({ error: `Insufficient funds in your ${sourceCurr} account on Monime.` });
       }
       
       // FAILSAFE: If Monime rejects cross-currency transfers natively, fallback to MatMove's local ledger
       if (errorMsg.toLowerCase().includes('currency') || monimeRes.status === 400) {
           console.warn("Monime rejected cross-currency transfer. Falling back to local Supabase ledger update.", errorMsg);
           if (Number(sourceWallet.balance || 0) < numAmount) {
                return res.status(400).json({ error: `Insufficient ${sourceCurr} balance in local ledger.` });
           }
       } else {
           return res.status(400).json({ error: errorMsg });
       }
    }

    // 4. Update Supabase Wallets Table with the new converted totals
    const oldSrcBal = Number(sourceWallet.balance || 0);
    const oldTgtBal = Number(targetWallet.balance || 0);
    
    const newSourceBal = Math.max(0, oldSrcBal - numAmount);
    const newTargetBal = oldTgtBal + convertedAmount;

    await supabase.from('wallets').update({ balance: newSourceBal, updated_at: new Date().toISOString() }).eq('id', sourceWallet.id);
    await supabase.from('wallets').update({ balance: newTargetBal, updated_at: new Date().toISOString() }).eq('id', targetWallet.id);

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