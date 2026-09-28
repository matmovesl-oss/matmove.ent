import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, riderId, driverId, amount } = req.body;

    // 1. Fetch Wallet: Check both 'user_id' and 'id' columns
    const { data: w1 } = await supabase.from('wallets').select('*').eq('user_id', riderId).limit(1);
    const { data: w2 } = await supabase.from('wallets').select('*').eq('id', riderId).limit(1);
    const riderWallet = w1?.[0] || w2?.[0];

    let riderAccountId = riderWallet?.metadata?.monime_account_id || riderWallet?.monime_account_id;

    // 2. Monime Fallback if DB lookup fails
    if (!riderAccountId || !String(riderAccountId).startsWith('fac-')) {
      const { data: profiles } = await supabase.from('profiles').select('*').eq('id', riderId).limit(1);
      const phone = profiles?.[0]?.phone || profiles?.[0]?.phone_number || '';
      
      const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
        headers: { 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID }
      });

      if (monimeRes.ok) {
        const monimeData = await monimeRes.json();
        // FIX: Extract from 'result' array
        const accounts = monimeData.result || monimeData.data || [];
        const match = accounts.find((acc: any) => phone && String(acc.name || '').includes(phone));
        if (match?.id) riderAccountId = match.id;
      }
    }

    if (!riderAccountId) {
      return res.status(400).json({ error: `Rider Account not found. Database and Monime fallback failed.` });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': `Bearer ${MONIME_API_KEY}`,
      'Monime-Space-Id': MONIME_SPACE_ID
    };

    const payload = {
      amount: { currency: "SLE", value: Math.round(Number(amount) * 100) },
      sourceAccountId: riderAccountId,
      destinationAccountId: ADMIN_MASTER_ESCROW_ID,
      description: `Escrow Hold for Booking ${bookingId}`
    };

    // 3. Monime Internal Transfer to Escrow
    let monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST', headers, body: JSON.stringify(payload)
    });

    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
    }

    if (!monimeResponse.ok) {
      const errText = await monimeResponse.text();
      return res.status(400).json({ error: `Transfer failed: ${monimeResponse.status} - ${errText}` });
    }

    // 4. Success! Mark as accepted.
    await supabase.from('bookings').update({ status: 'accepted', driver_id: driverId }).eq('id', bookingId);
    return res.status(200).json({ success: true, riderAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}