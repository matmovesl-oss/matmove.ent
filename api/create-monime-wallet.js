import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, role, fullName } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing user ID.' });

    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;
    
    // Generate a unique Idempotency-Key
    const idempotencyKey = `MM_WALLET_${userId}_${Date.now()}`;

    // 1. Call Monime to create the Financial Account
    const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        name: `MatMove ${String(role).toUpperCase()} - ${fullName}`,
        currency: 'SLE',
        reference: userId 
      })
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) {
      console.error("Monime Gateway Rejected:", rawData);
      throw new Error(`Monime rejected wallet creation: ${JSON.stringify(rawData)}`);
    }

    const monimeAccountId = rawData.data?.id || rawData.result?.id;
    console.log("Successfully generated Monime Account ID:", monimeAccountId);

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 2. Safe Database Sync (Only Update)
    // The frontend already created the row, so we just cleanly inject the Monime ID into it.
    const { error: dbError } = await supabase
      .from('wallets')
      .update({ metadata: { monime_account_id: monimeAccountId } })
      .eq('user_id', userId)
      .eq('currency', 'SLE');

    if (dbError) throw dbError;

    return res.status(200).json({ success: true, monime_account_id: monimeAccountId });
  } catch (error) {
    console.error('Wallet Creation Error:', error);
    return res.status(500).json({ error: error.message });
  }
}