import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    console.log("🚨 INCOMING MONIME WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));
    
    // Aggressively extract the session data regardless of Monime's structure
    const session = payload.result || payload.data || payload.checkoutSession || payload;
    
    // Track through the exact Reference ID we generated on checkout
    const reference = session.reference || payload.reference || (session.metadata && session.metadata.reference);

    if (!reference) {
      console.error('❌ Webhook missing reference id. Cannot track transaction.');
      return res.status(400).json({ error: 'Missing reference' });
    }

    console.log(`✅ Tracking Transaction via Reference: ${reference}`);

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Find the pending transaction using the EXACT reference ID
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('metadata->>reference', reference)
      .eq('status', 'pending')
      .single();

    if (txError || !transaction) {
      console.error('❌ Transaction not found or already processed for reference:', reference);
      return res.status(200).json({ message: 'Transaction already processed or not found' });
    }

    const userId = transaction.user_id;
    
    // We strictly use the exact amount saved in our database to ensure perfect accuracy
    const amountPaid = Number(transaction.amount); 

    console.log(`✅ Found Pending Transaction. User ID: ${userId}, Exact Amount: ${amountPaid}`);

    // 2. Fetch the user's current wallet
    let { data: wallet } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', userId)
      .single();

    // 3. Update the Wallet (or instantly create it if it doesn't exist yet)
    if (!wallet) {
      console.log('⚠️ Wallet not found for user. Creating a new wallet instantly.');
      await supabase.from('wallets').insert({
        user_id: userId,
        balance: amountPaid
      });
    } else {
      const newBalance = Number(wallet.balance) + amountPaid;
      console.log(`💰 Updating Wallet. Old Balance: ${wallet.balance}, New Balance: ${newBalance}`);
      await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    }

    // 4. Mark the transaction as completed so it can't be processed twice
    await supabase.from('payment_transactions').update({ status: 'completed' }).eq('id', transaction.id);

    console.log('🎉 Wallet Top-Up Fully Complete and Pushed to Backend!');
    return res.status(200).json({ success: true, message: 'Wallet credited successfully' });

  } catch (error) {
    console.error('❌ FATAL Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}