import { createClient } from '@supabase/supabase-js';

// Use the Service Role Key to bypass RLS blocks
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId } = req.body;
    
    // Securely update the booking status to trigger the Rider's payment screen
    const { error } = await supabase
      .from('bookings')
      .update({ status: 'in_progress' })
      .eq('id', bookingId);

    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}