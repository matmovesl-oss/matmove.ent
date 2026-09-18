import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // 1. Fetch all wallets that have a Monime Account ID
    const { data: wallets, error: fetchError } = await supabase
      .from('wallets')
      .select('id, user_id, metadata')
      .not('metadata', 'is', null);

    if (fetchError) throw fetchError;

    let syncedCount = 0;
    const errors = [];

    // 2. Loop through every wallet and sync
    for (const wallet of wallets) {
      const facId = wallet.metadata?.monime_account_id;
      if (!facId) continue;

      try {
        // Fetch with ?withBalance=true parameter
        const accountRes = await fetch(`https://api.monime.io/v1/financial-accounts/${facId}?withBalance=true`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Monime-Space-Id': spaceId
          }
        });

        if (!accountRes.ok) throw new Error(`Failed to fetch from Monime: ${accountRes.status}`);

        const accountData = await accountRes.json();
        
        // Extract balance mapping to Monime's deeply nested schema
        let rawBalance = 
          accountData?.data?.balance?.available?.value || 
          accountData?.result?.balance?.available?.value ||
          accountData?.data?.balance?.value || 
          accountData?.balance?.available?.value || 
          0;

        const trueBalance = Number(rawBalance) / 100;

        // Force the update into Supabase
        await supabase
          .from('wallets')
          .update({ balance: trueBalance })
          .eq('id', wallet.id);

        syncedCount++;
      } catch (err) {
        errors.push({ userId: wallet.user_id, error: err.message });
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: `Successfully synced ${syncedCount} wallets with true balances!`,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Master Sync Error:', error);
    return res.status(500).json({ error: error.message });
  }
}