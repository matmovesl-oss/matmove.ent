import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  // CORS Handling
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, amount } = req.body;
    let { driverId } = req.body;

    if (!driverId) {
      const { data: booking } = await supabase.from('bookings').select('driver_id').eq('id', bookingId).single();
      driverId = booking?.driver_id;
    }

    if (!driverId) return res.status(400).json({ error: 'Driver ID is missing.' });

    // 1. Fetch Wallet: Check both 'user_id' and 'id' columns to prevent schema mismatches
    const { data: w1 } = await supabase.from('wallets').select('*').eq('user_id', driverId).limit(1);
    const { data: w2 } = await supabase.from('wallets').select('*').eq('id', driverId).limit(1);
    const driverWallet = w1?.[0] || w2?.[0];

    let driverAccountId = driverWallet?.metadata?.monime_account_id || driverWallet?.monime_account_id;

    // 2. Monime Fallback if DB lookup fails
    if (!driverAccountId || !String(driverAccountId).startsWith('fac-')) {
      const { data: profiles } = await supabase.from('profiles').select('*').eq('id', driverId).limit(1);
      const profile = profiles?.[0];
      const phone = profile?.phone || profile?.phone_number || '';
      
      const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
        headers: { 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID }
      });

      if (monimeRes.ok) {
        const monimeData = await monimeRes.json();
        // FIX: Extract from 'result' based on the exact Monime JSON logs provided
        const accounts = monimeData.result || monimeData.data || [];
        const match = accounts.find((acc: any) => phone && String(acc.name || '').includes(phone));
        if (match?.id) driverAccountId = match.id;
      }
    }

    if (!driverAccountId) {
      return res.status(400).json({ error: `Driver Account not found. Database and Monime fallback failed for ${driverId}.` });
    }

    // 3. Payout Calculation (Driver gets 85% in minor units / cents)
    const driverEarnings = Math.round((Number(amount) * 0.85) * 100);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': `Bearer ${MONIME_API_KEY}`,
      'Monime-Space-Id': MONIME_SPACE_ID
    };

    const payload = {
      amount: { currency: "SLE", value: driverEarnings },
      sourceAccountId: ADMIN_MASTER_ESCROW_ID,
      destinationAccountId: driverAccountId,
      description: `Trip Earnings Payout for Booking ${bookingId}`
    };

    // 4. Monime Internal Transfer to Driver
    let monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST', headers, body: JSON.stringify(payload)
    });

    // Fallback if Monime router prefers underscore
    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
    }

    if (!monimeResponse.ok) {
      const errText = await monimeResponse.text();
      return res.status(400).json({ error: `Transfer failed: ${monimeResponse.status} - ${errText}` });
    }

    // 5. Success! Mark as completed.
    await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);
    return res.status(200).json({ success: true, driverAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}