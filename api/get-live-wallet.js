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

    // 1. Fetch the user's MatMove wallet to get their secret Monime Account ID
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

    // 2. Ask Monime directly for the true, real-time balance
    const monimeRes = await fetch(`https://api.monime.io/v1/financial-accounts/${accountId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Monime-Version': 'caph.2025-08-23'
      }
    });

    const rawText = await monimeRes.text();
    let monimeData = {};
    
    try {
      const parsed = JSON.parse(rawText);
      monimeData = parsed.result || parsed; // Handle Monime's wrapper
    } catch(e) {
      console.error("Failed to parse Monime API response:", rawText);
    }

    let realBalance = null;

    // 3. Dynamically locate the balance in Monime's schema (Monime uses minor units / cents)
    if (monimeData.balance && typeof monimeData.balance.value !== 'undefined') {
        realBalance = monimeData.balance.value / 100;
    } else if (monimeData.availableBalance && typeof monimeData.availableBalance.value !== 'undefined') {
        realBalance = monimeData.availableBalance.value / 100;
    } else if (monimeData.amount && typeof monimeData.amount.value !== 'undefined') {
        realBalance = monimeData.amount.value / 100;
    }

    // 4. Force-Sync the true balance back to the MatMove database
    if (realBalance !== null) {
      await supabase
        .from('wallets')
        .update({ balance: realBalance, updated_at: new Date().toISOString() })
        .eq('id', wallet.id);
        
      return res.status(200).json({ balance: realBalance });
    }

    // Fallback if Monime is unreachable or structure changes
    return res.status(200).json({ balance: wallet.balance });
  } catch (error) {
    console.error('Live Sync Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}