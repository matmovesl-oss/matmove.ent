import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const payload = req.body;
    console.log("🚨 INCOMING MONIME WEBHOOK PAYLOAD:", JSON.stringify(payload));
    
    const session = payload.result || payload.data || payload.checkoutSession || payload;
    const reference = session.reference || payload.reference || (session.metadata && session.metadata.reference);

    if (!reference) return res.status(400).json({ error: 'Missing reference' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Find the exact transaction using the Reference ID
    const { data: transaction, error: txError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('metadata->>reference', reference)
      .eq('status', 'pending')
      .single();

    if (txError || !transaction) return res.status(200).json({ message: 'Transaction already processed or not found' });

    const userId = transaction.user_id;
    const amountPaid = Number(transaction.amount); 

    // 2. Fetch the user's current wallet
    let { data: wallet } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', userId)
      .single();

    // 3. Auto-Create wallet if missing, otherwise update balance
    if (!wallet) {
      await supabase.from('wallets').insert({
        user_id: userId,
        balance: amountPaid
      });
    } else {
      const newBalance = Number(wallet.balance) + amountPaid;
      await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    }

    // 4. Mark transaction as completed
    await supabase.from('payment_transactions').update({ status: 'completed' }).eq('id', transaction.id);

    return res.status(200).json({ success: true, message: 'Wallet credited successfully' });

  } catch (error) {
    console.error('FATAL Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}