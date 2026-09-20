import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, destinationPhone } = req.body;
    if (!userId || !amount || !destinationPhone) return res.status(400).json({ error: 'Missing required parameters.' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Create the withdrawal request for the Admin to review
    const { error: dbError } = await supabase.from('withdrawal_requests').insert({
       user_id: userId,
       amount: amount,
       currency: 'SLE',
       provider: 'monime',
       destination_phone: destinationPhone,
       status: 'pending' 
    });

    if (dbError) throw dbError;

    return res.status(200).json({ success: true, message: 'Withdrawal requested successfully. Pending admin approval.' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}