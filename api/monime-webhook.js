import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    console.log("Incoming Monime Webhook:", JSON.stringify(payload));
    
    // Aggressively extract the session data regardless of where Monime nested it
    const session = payload.result || payload.data || payload.checkoutSession || payload;
    
    // Extract the reference ID needed to find the transaction
    const reference = session.reference || payload.reference || (session.metadata && session.metadata.reference);

    if (!reference) {
      console.error('Webhook missing reference id. Payload:', JSON.stringify(payload));
      return res.status(400).json({ error: 'Missing reference' });
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Find the pending transaction using the reference
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('metadata->>reference', reference)
      .eq('status', 'pending')
      .single();

    if (txError || !transaction) {
      console.error('Transaction not found or already processed:', reference);
      return res.status(200).json({ message: 'Transaction already processed or not found' });
    }

    const userId = transaction.user_id;
    const amountPaid = Number(transaction.amount); 

    // 2. Fetch the user's current wallet balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', userId)
      .single();

    if (!wallet) throw new Error('Wallet not found for user');

    const newBalance = Number(wallet.balance) + amountPaid;

    // 3. Update the Wallet and mark Transaction as Completed
    await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    await supabase.from('payment_transactions').update({ status: 'completed' }).eq('id', transaction.id);

    return res.status(200).json({ success: true, message: 'Wallet credited successfully' });

  } catch (error) {
    console.error('Monime Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}