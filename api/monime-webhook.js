import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Monime sends webhooks as POST requests
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    
    // Optional: Verify Webhook Secret if Monime requires it
    const webhookSecret = process.env.MONIME_WEBHOOK_SECRET;
    const incomingSignature = req.headers['x-monime-signature'];
    
    // Check if the payment was successful
    if (payload.status !== 'successful') {
      return res.status(200).json({ message: 'Ignored: Payment not successful' });
    }

    const reference = payload.reference;
    const amountPaid = Number(payload.amount);

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
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const userId = transaction.user_id;

    // 2. Fetch the user's current wallet balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', userId)
      .single();

    if (!wallet) throw new Error('Wallet not found');

    const newBalance = Number(wallet.balance) + amountPaid;

    // 3. Update the Wallet and mark Transaction as Completed (Atomic-like operation)
    await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    await supabase.from('payment_transactions').update({ status: 'completed' }).eq('id', transaction.id);

    // Tell Monime we received the webhook successfully
    return res.status(200).json({ success: true, message: 'Wallet credited successfully' });

  } catch (error) {
    console.error('Monime Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}