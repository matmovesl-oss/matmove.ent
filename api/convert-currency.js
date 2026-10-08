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

    // 3. Fetch LIVE balance directly from Monime properly parsing the nested object
    let liveSourceBalance = Number(sourceWallet.balance || 0);
    if (apiKey && spaceId) {
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
          // Extract value safely from the nested balance.available.value object
          const availableValue = accData.result?.balance?.available?.value;
          if (typeof availableValue === 'number') {
            liveSourceBalance = availableValue / 100; // Convert minor units (cents) to standard units
          }
        }
      } catch (e) {
        console.warn("Monime balance fetch warning:", e);
      }
    }

    // Ensure they have enough funds based on the LIVE Monime check
    if (liveSourceBalance < numAmount) {
      return res.status(400).json({ error: `Insufficient ${sourceCurr} balance. Available: ${sourceCurr} ${liveSourceBalance.toFixed(2)}` });
    }

    // 4. Execute Monime Financial Transaction using exact OpenAPI spec structure
    if (apiKey && spaceId) {
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
      if (!monimeRes.ok) {
        // Pass Monime's specific error message to the frontend if it fails (e.g. cross-currency rejection)
        return res.status(400).json({ error: monimeData.message || monimeData.error || 'Monime internal transfer failed.' });
      }
    }

    // 5. Update Supabase Wallets Table (The MatMove App Ledger)
    const newSourceBal = Math.max(0, liveSourceBalance - numAmount);
    const newTargetBal = Number(targetWallet.balance || 0) + convertedAmount;

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