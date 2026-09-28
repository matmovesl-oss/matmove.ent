import { createClient } from '@supabase/supabase-js';

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
    const { bookingId, riderId, driverId, amount } = req.body;

    // 1. Fetch Rider Wallet
    const { data: wallets } = await supabase.from('wallets').select('metadata, monime_account_id').eq('user_id', riderId).limit(1);
    const riderWallet = wallets?.[0];

    let riderAccountId = riderWallet?.metadata?.monime_account_id || riderWallet?.monime_account_id;

    if (!riderAccountId) {
      return res.status(400).json({ error: 'Rider Monime Account could not be resolved.' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': `Bearer ${MONIME_API_KEY}`,
      'Monime-Space-Id': MONIME_SPACE_ID
    };

    // 2. Transfer full fare from Rider to Admin Escrow
    let monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: { currency: "SLE", value: Math.round(Number(amount) * 100) },
        sourceAccountId: riderAccountId,
        destinationAccountId: ADMIN_MASTER_ESCROW_ID,
        description: `Escrow Hold for Booking ${bookingId}`
      })
    });

    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount: { currency: "SLE", value: Math.round(Number(amount) * 100) },
          sourceAccountId: riderAccountId,
          destinationAccountId: ADMIN_MASTER_ESCROW_ID,
          description: `Escrow Hold for Booking ${bookingId}`
        })
      });
    }

    if (!monimeResponse.ok) {
      const errJson = await monimeResponse.text();
      return res.status(400).json({ error: errJson || 'Insufficient funds or Rider transfer failed.' });
    }

    // 3. Set Booking to Accepted
    await supabase.from('bookings').update({ 
       status: 'accepted', 
       driver_id: driverId 
    }).eq('id', bookingId);

    return res.status(200).json({ success: true, riderAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}