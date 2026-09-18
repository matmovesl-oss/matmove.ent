import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    // 1. Fetch all wallets
    const { data: wallets, error: fetchError } = await supabase
      .from('wallets')
      .select('*')
      .not('metadata', 'is', null);

    if (fetchError) throw fetchError;

    let syncedCount = 0;

    // 2. Loop and mirror
    for (const wallet of wallets) {
      const facId = wallet.metadata?.monime_account_id;
      if (!facId) continue;

      try {
        const accountRes = await fetch(`https://api.monime.io/v1/financial-accounts/${facId}?withBalance=true`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Monime-Space-Id': spaceId
          }
        });

        if (!accountRes.ok) continue;

        const rawMonimeData = await accountRes.json();
        
        // 3. RESTRUCTURE: Dump the entire Monime object into the Supabase wallet metadata
        const updatedMetadata = {
          ...wallet.metadata,
          monime_raw_data: rawMonimeData
        };

        await supabase
          .from('wallets')
          .update({ metadata: updatedMetadata })
          .eq('id', wallet.id);

        syncedCount++;
      } catch (err) {
        console.error(err);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: `Restructured ${syncedCount} wallets. Open your Supabase Table Editor and look inside the metadata column!`
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}