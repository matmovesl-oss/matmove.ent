import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, amount } = req.body;
    let { driverId } = req.body;

    if (!bookingId || !amount) {
      return res.status(400).json({ error: 'Missing bookingId or amount.' });
    }

    // 1. BULLETPROOFING: Fetch the booking directly to guarantee we have the correct driver_id
    if (!driverId) {
      const { data: booking } = await supabase.from('bookings').select('driver_id').eq('id', bookingId).single();
      driverId = booking?.driver_id;
    }

    if (!driverId) {
      return res.status(400).json({ error: 'Driver ID not found for this booking.' });
    }

    // 2. Fetch the Driver's Wallet
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', driverId).limit(1);
    const wallet = wallets?.[0];
    
    let driverAccountId = wallet?.metadata?.monime_account_id || wallet?.monime_account_id;

    // 3. Fallback to Monime API using the correct HYPHENATED endpoint if not found
    if (!driverAccountId || !String(driverAccountId).startsWith('fac-')) {
      const { data: profiles } = await supabase.from('profiles').select('*').eq('id', driverId).limit(1);
      const phone = profiles?.[0]?.phone || profiles?.[0]?.phone_number || '';
      
      const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
        headers: { 'Authorization': `Bearer ${MONIME_API_KEY}`, 'x-monime-space-id': MONIME_SPACE_ID }
      });

      if (monimeRes.ok) {
        const monimeData = await monimeRes.json();
        const accounts = monimeData.data || monimeData.accounts || [];
        const match = accounts.find((acc: any) => phone && String(acc.name || '').includes(phone));
        if (match?.id) driverAccountId = match.id;
      }
    }

    if (!driverAccountId) {
      return res.status(400).json({ error: 'Driver Monime Financial Account could not be resolved.' });
    }

    // 4. Calculate Driver Payout (85% of fare in minor units / cents)
    const driverEarnings = Math.round((Number(amount) * 0.85) * 100);

    // 5. Execute Internal Transfer from Escrow to Driver Wallet
    // NOTE: Testing both underscore and hyphenated endpoints just in case Monime routes differ
    let monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'x-monime-space-id': MONIME_SPACE_ID
      },
      body: JSON.stringify({
        amount: { currency: "SLE", value: driverEarnings },
        sourceAccountId: ADMIN_MASTER_ESCROW_ID,
        destinationAccountId: driverAccountId,
        description: `Trip Earnings Payout for Booking ${bookingId}`
      })
    });

    // Automatic fallback if Monime prefers hyphens for transfers
    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MONIME_API_KEY}`,
          'x-monime-space-id': MONIME_SPACE_ID
        },
        body: JSON.stringify({
          amount: { currency: "SLE", value: driverEarnings },
          sourceAccountId: ADMIN_MASTER_ESCROW_ID,
          destinationAccountId: driverAccountId,
          description: `Trip Earnings Payout for Booking ${bookingId}`
        })
      });
    }

    if (!monimeResponse.ok) {
      const errJson = await monimeResponse.json().catch(() => ({}));
      return res.status(400).json({ error: errJson.message || 'Failed to release Escrow funds to Driver.' });
    }

    // 6. Update Supabase Booking to completed
    await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

    return res.status(200).json({ success: true, driverAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}