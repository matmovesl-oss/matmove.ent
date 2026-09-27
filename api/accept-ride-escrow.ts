import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
// THE ADMIN MASTER ESCROW ACCOUNT CREATED IN MONIME
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, riderId, driverId, amount } = req.body;

    // 1. Get the Rider's Wallet ID from Supabase
    const { data: riderWallet } = await supabase.from('wallets').select('metadata').eq('user_id', riderId).single();
    if (!riderWallet?.metadata?.monime_account_id) {
       return res.status(400).json({ error: 'Rider Monime Account not found.' });
    }

    // 2. Instruct Monime to transfer funds from Rider to Admin Escrow
    const monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'x-monime-space-id': MONIME_SPACE_ID
      },
      body: JSON.stringify({
        amount: { currency: "SLE", value: Math.round(Number(amount) * 100) },
        sourceAccountId: riderWallet.metadata.monime_account_id,
        destinationAccountId: ADMIN_MASTER_ESCROW_ID,
        description: `Escrow Hold for Trip ${bookingId}`
      })
    });

    if (!monimeResponse.ok) {
       const errorData = await monimeResponse.json();
       return res.status(400).json({ error: 'Insufficient funds or transfer failed.' });
    }

    // 3. Funds successfully held. Update Supabase Database.
    await supabase.from('bookings').update({ 
       status: 'accepted', 
       driver_id: driverId 
    }).eq('id', bookingId);

    return res.status(200).json({ success: true });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}