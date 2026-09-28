import { createClient } from '@supabase/supabase-js';

// Enforce Service Role Key to completely bypass Supabase Row Level Security
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, amount } = req.body;

    // 1. Fetch booking securely from DB to ensure we have the correct driver_id
    const { data: booking } = await supabase.from('bookings').select('driver_id').eq('id', bookingId).single();
    const driverId = booking?.driver_id;

    if (!driverId) {
      return res.status(400).json({ error: `Driver ID not found in database for booking ${bookingId}.` });
    }

    // 2. Fetch Driver Wallet directly (Service Role bypasses RLS)
    const { data: wallets } = await supabase.from('wallets').select('metadata, monime_account_id').eq('user_id', driverId).limit(1);
    const driverWallet = wallets?.[0];

    let driverAccountId = driverWallet?.metadata?.monime_account_id || driverWallet?.monime_account_id;

    if (!driverAccountId) {
      return res.status(400).json({ error: `Missing Driver Wallet Account. Driver ID: ${driverId}` });
    }

    // 3. Calculate Driver Payout (85% of fare in minor units / cents)
    const driverEarnings = Math.round((Number(amount) * 0.85) * 100);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': `Bearer ${MONIME_API_KEY}`,
      'Monime-Space-Id': MONIME_SPACE_ID // CORRECTED: Using exact casing from your logs
    };

    // 4. Execute Transfer using corrected hyphenated endpoint
    let monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: { currency: "SLE", value: driverEarnings },
        sourceAccountId: ADMIN_MASTER_ESCROW_ID,
        destinationAccountId: driverAccountId,
        description: `Trip Earnings Payout for Booking ${bookingId}`
      })
    });

    // Automatic fallback to underscore if Monime uses old routing for transfers
    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: { currency: "SLE", value: driverEarnings },
          sourceAccountId: ADMIN_MASTER_ESCROW_ID,
          destinationAccountId: driverAccountId,
          description: `Trip Earnings Payout for Booking ${bookingId}`
        })
      });
    }

    if (!monimeResponse.ok) {
      const errText = await monimeResponse.text();
      return res.status(400).json({ error: `Monime API Error: ${errText}` });
    }

    // 5. Update Supabase Booking to completed
    await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

    return res.status(200).json({ success: true, driverAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}