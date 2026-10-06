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

    // Fetch all wallets for the user
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId);
    
    if (!wallets || wallets.length === 0) {
      return res.status(200).json({ sleWallet: null, usdWallet: null });
    }

    let sleWallet = wallets.find(w => w.currency === 'SLE') || wallets[0];
    let usdWallet = wallets.find(w => w.currency === 'USD') || null;

    const updateBalance = async (walletObj) => {
      if (!walletObj) return null;
      const accountId = walletObj.monime_account_id || walletObj.metadata?.monime_account_id;
      if (!accountId) return walletObj;

      const monimeRes = await fetch(`https://api.monime.io/v1/financial-accounts/${accountId}?withBalance=true`, {
        headers: {
          'Authorization': `Bearer ${process.env.MONIME_API_KEY || process.env.VITE_MONIME_API_KEY}`,
          'Monime-Space-Id': process.env.MONIME_SPACE_ID || process.env.VITE_MONIME_SPACE_ID,
          'Monime-Version': 'caph.2025-08-23'
        }
      });

      if (monimeRes.ok) {
        const rawData = await monimeRes.json();
        const monimeData = rawData.result || rawData;
        if (monimeData.balance?.available?.value !== undefined) {
           const realBalance = monimeData.balance.available.value / 100; 
           await supabase.from('wallets').update({ balance: realBalance, updated_at: new Date().toISOString() }).eq('id', walletObj.id);
           return { ...walletObj, balance: realBalance };
        }
      }
      return walletObj;
    };

    sleWallet = await updateBalance(sleWallet);
    usdWallet = await updateBalance(usdWallet);

    return res.status(200).json({ sleWallet, usdWallet });
  } catch (error) {
    console.error('Live Sync Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}