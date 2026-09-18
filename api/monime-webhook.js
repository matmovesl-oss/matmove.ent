import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    console.log("🚨 INCOMING MONIME WEBHOOK PAYLOAD:", JSON.stringify(payload));
    
    // 1. Verify this is a completed checkout event
    const eventName = payload?.event?.name;
    if (eventName !== 'checkout_session.completed') {
      return res.status(200).json({ message: 'Event ignored - Not a completed checkout' });
    }

    const data = payload?.data || {};
    const financialAccountId = data.financialAccountId;
    const reference = data.reference;

    if (!financialAccountId || !reference) {
      return res.status(400).json({ error: 'Missing account or reference data in payload' });
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 2. EXTRACT USER ID FROM THE REFERENCE (Format: MM_MOMO_UserID_Timestamp)
    const referenceParts = reference.split('_');
    const userId = referenceParts[2];

    if (!userId) return res.status(400).json({ error: 'Invalid reference format' });

    // 3. Mark the pending transaction as completed in history
    const { data: pendingTxs, error: txError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (!txError && pendingTxs && pendingTxs.length > 0) {
      const transaction = pendingTxs.find(tx => tx.metadata && tx.metadata.reference === reference);
      if (transaction) {
        await supabase.from('payment_transactions').update({ status: 'completed' }).eq('id', transaction.id);
      }
    }

    // 4. Query Monime for the TRUE ledger balance of this specific sub-account
    const apiKey = process.env.MONIME_API_KEY;
    const spaceId = process.env.MONIME_SPACE_ID;
    
    const accountRes = await fetch(`https://api.monime.io/v1/financial-accounts/${financialAccountId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Monime-Space-Id': spaceId
      }
    });

    if (!accountRes.ok) {
      console.error("Failed to fetch Monime Account:", await accountRes.text());
      throw new Error('Failed to fetch true account balance from Monime');
    }

    const accountData = await accountRes.json();
    
    // 5. Extract balance. Monime stores balances in minor units (cents)
    let rawBalance = 
      accountData?.data?.balance?.value || 
      accountData?.data?.balance || 
      accountData?.balance?.value || 
      accountData?.balance || 0;

    // Convert minor units (cents) back to standard SLE format (e.g., 198 -> 1.98)
    const trueBalance = Number(rawBalance) / 100;

    // 6. Force Supabase wallet to mirror Monime's true balance perfectly
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ balance: trueBalance })
      .eq('user_id', userId)
      .eq('currency', 'SLE');

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, message: `Wallet synced perfectly. True balance: ${trueBalance}` });

  } catch (error) {
    console.error('FATAL Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}