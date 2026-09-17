import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Completely removed the POST restriction so you can run it in Chrome/Safari
  
  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Fetch all SLE wallets
    const { data: wallets, error: fetchError } = await supabase
      .from('wallets')
      .select('id, user_id, metadata')
      .eq('currency', 'SLE');

    if (fetchError) throw fetchError;

    // 2. Filter out wallets that already have a Monime ID
    const walletsToSync = wallets.filter(w => !w.metadata || !w.metadata.monime_account_id);

    if (walletsToSync.length === 0) {
      return res.status(200).json({ message: 'All users are already synced!' });
    }

    // 3. Fetch user profiles to get their names and roles
    const userIds = walletsToSync.map(w => w.user_id);
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('id', userIds);

    if (profileError) throw profileError;

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;

    let successCount = 0;
    let errors = [];

    // 4. Loop through existing users and create their Monime accounts
    for (const wallet of walletsToSync) {
      const profile = profiles.find(p => p.id === wallet.user_id);
      if (!profile) continue;

      // Unique idempotency key so we never double-create
      const idempotencyKey = `MM_MIGRATE_${wallet.user_id}`; 

      try {
        const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Monime-Space-Id': spaceId,
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            name: `MatMove ${String(profile.role).toUpperCase()} - ${profile.full_name || 'User'}`,
            currency: 'SLE',
            reference: wallet.user_id
          })
        });

        const rawData = await monimeRes.json();
        if (!monimeRes.ok || rawData.success === false) throw new Error(JSON.stringify(rawData));

        const monimeAccountId = rawData.data?.id || rawData.result?.id;

        // Safely update the database, preserving any other metadata if it exists
        const updatedMetadata = { ...(wallet.metadata || {}), monime_account_id: monimeAccountId };

        await supabase
          .from('wallets')
          .update({ metadata: updatedMetadata })
          .eq('id', wallet.id);

        successCount++;
      } catch (err) {
        errors.push({ userId: wallet.user_id, error: err.message });
      }
    }

    return res.status(200).json({
      message: `Successfully synced ${successCount} out of ${walletsToSync.length} users.`,
      errors: errors
    });

  } catch (error) {
    console.error('Migration Error:', error);
    return res.status(500).json({ error: error.message });
  }
}