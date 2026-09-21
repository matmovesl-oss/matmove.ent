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
      return res.status(200).json({ transactions: [] });
    }

    const accountId = wallet.metadata.monime_account_id;

    const monimeRes = await fetch(`https://api.monime.io/v1/financial-transactions?financialAccountId=${accountId}&limit=20`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Monime-Version': 'caph.2025-08-23'
      }
    });

    const rawData = await monimeRes.json();

    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(rawData.message || 'Failed to fetch transactions');
    }

    const txList = rawData.result?.items || rawData.result || [];
    return res.status(200).json({ transactions: Array.isArray(txList) ? txList : [] });
  } catch (error) {
    console.error('Fetch Transactions Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}