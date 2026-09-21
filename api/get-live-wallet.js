import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'SLE')
      .single();
    
    if (!wallet || !wallet.metadata?.monime_account_id) {
      return res.status(200).json({ balance: wallet?.balance || 0 });
    }

    const accountId = wallet.metadata.monime_account_id;

    // Fetch account from Monime with '?withBalance=true' query parameter as per docs
    const monimeRes = await fetch(`https://api.monime.io/v1/financial-accounts/${accountId}?withBalance=true`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Monime-Version': 'caph.2025-08-23'
      }
    });

    if (monimeRes.ok) {
      const rawData = await monimeRes.json();
      const monimeData = rawData.result || rawData;
      
      // Strict mapping based on Monime's OpenAPI schema: balance.available.value
      if (monimeData.balance?.available?.value !== undefined) {
         const realBalance = monimeData.balance.available.value / 100; 
         
         // Sync real balance to local DB
         await supabase
           .from('wallets')
           .update({ balance: realBalance, updated_at: new Date().toISOString() })
           .eq('id', wallet.id);
           
         return res.status(200).json({ balance: realBalance });
      }
    }

    return res.status(200).json({ balance: wallet.balance });
  } catch (error) {
    console.error('Live Sync Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}