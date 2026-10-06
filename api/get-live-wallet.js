import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId);
    
    if (!wallets || wallets.length === 0) {
      return res.status(200).json({ sleWallet: null, usdWallet: null, transactions: [] });
    }

    let sleWallet = wallets.find(w => w.currency === 'SLE') || wallets[0];
    let usdWallet = wallets.find(w => w.currency === 'USD') || null;
    let transactions = [];

    const updateBalanceAndFetchTx = async (walletObj, fetchTx = false) => {
      if (!walletObj) return null;
      const accountId = walletObj.monime_account_id || walletObj.metadata?.monime_account_id;
      if (!accountId) return walletObj;

      try {
          const authHeaders = {
              'Authorization': `Bearer ${process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY}`,
              'Monime-Space-Id': process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID,
              'Monime-Version': 'caph.2025-08-23'
          };

          // Fetch Balance
          const monimeRes = await fetch(`https://api.monime.io/v1/financial-accounts/${accountId}?withBalance=true`, { headers: authHeaders });
          if (monimeRes.ok) {
            const monimeData = (await monimeRes.json()).result || {};
            if (monimeData.balance?.available?.value !== undefined) {
               const realBalance = monimeData.balance.available.value / 100; 
               await supabase.from('wallets').update({ balance: realBalance, updated_at: new Date().toISOString() }).eq('id', walletObj.id);
               walletObj.balance = realBalance;
            }
          }

          // Fetch Transactions for main wallet
          if (fetchTx) {
              const txRes = await fetch(`https://api.monime.io/v1/financial-transactions?financialAccountId=${accountId}&limit=10`, { headers: authHeaders });
              if (txRes.ok) {
                  const txData = await txRes.json();
                  transactions = txData.result?.items || txData.result || [];
              }
          }
      } catch(e) { console.error("Monime Sync Error", e); }

      return walletObj;
    };

    sleWallet = await updateBalanceAndFetchTx(sleWallet, true);
    usdWallet = await updateBalanceAndFetchTx(usdWallet, false);

    return res.status(200).json({ sleWallet, usdWallet, transactions });
  } catch (error) {
    console.error('Live Sync Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}