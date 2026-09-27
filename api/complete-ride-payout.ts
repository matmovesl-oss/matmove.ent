import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, driverId, amount } = req.body;

    // 1. Calculate Driver Payout (85% of fare)
    const driverEarnings = Math.round((Number(amount) * 0.85) * 100); // Minor units

    // 2. Get the Driver's Monime Account ID
    const { data: driverWallet } = await supabase.from('wallets').select('metadata').eq('user_id', driverId).single();
    if (!driverWallet?.metadata?.monime_account_id) {
       return res.status(400).json({ error: 'Driver Monime Account not found.' });
    }

    // 3. Move funds from Admin Escrow to Driver Wallet
    const monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'x-monime-space-id': MONIME_SPACE_ID
      },
      body: JSON.stringify({
        amount: { currency: "SLE", value: driverEarnings },
        sourceAccountId: ADMIN_MASTER_ESCROW_ID,
        destinationAccountId: driverWallet.metadata.monime_account_id,
        description: `Trip Earnings for Booking ${bookingId}`
      })
    });

    if (!monimeResponse.ok) {
       return res.status(400).json({ error: 'Failed to release Escrow to Driver.' });
    }

    // 4. Update Trip Status to Completed
    await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

    return res.status(200).json({ success: true });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}