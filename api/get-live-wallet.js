import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId parameter' });

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Get the mapping ID from Supabase
    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('metadata')
      .eq('user_id', userId)
      .single();

    if (error || !wallet?.metadata?.monime_account_id) {
      return res.status(404).json({ error: 'User does not have a linked Monime account.' });
    }

    const facId = wallet.metadata.monime_account_id;
    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // 2. Fetch the true live balance directly from Monime
    const accountRes = await fetch(`https://api.monime.io/v1/financial-accounts/${facId}?withBalance=true`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId
      }
    });

    if (!accountRes.ok) throw new Error('Failed to reach Monime API');

    const accountData = await accountRes.json();
    
    // Monime docs define balance inside result.balance.available.value
    const rawBalance = accountData?.result?.balance?.available?.value || 0;
    const liveBalance = Number(rawBalance) / 100;

    // 3. Return everything the frontend needs to render the UI
    return res.status(200).json({ 
      accountId: facId,
      balance: liveBalance,
      currency: 'SLE',
      accountName: accountData?.result?.name || 'MatMove Wallet'
    });

  } catch (error) {
    console.error('Live Fetch Error:', error);
    return res.status(500).json({ error: error.message });
  }
}