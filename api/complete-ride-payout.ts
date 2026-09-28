import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

async function resolveMonimeAccountId(userId: string) {
  const { data: w1 } = await supabase.from('wallets').select('*').eq('user_id', userId).limit(1);
  const { data: w2 } = await supabase.from('wallets').select('*').eq('id', userId).limit(1);
  const wallet = w1?.[0] || w2?.[0];
  
  let accountId = wallet?.metadata?.monime_account_id || wallet?.monime_account_id;
  if (accountId && String(accountId).startsWith('fac-')) return accountId;

  try {
    const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
      headers: {
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'Monime-Space-Id': MONIME_SPACE_ID,
        'Accept': '*/*'
      }
    });

    if (monimeRes.ok) {
      const monimeData = await monimeRes.json();
      const accounts = monimeData.result || monimeData.data || (Array.isArray(monimeData) ? monimeData : []);
      
      const match = accounts.find((acc: any) => acc.reference === userId);
      
      if (match?.id) {
        if (wallet?.id) {
          await supabase.from('wallets').update({
            metadata: { ...(wallet.metadata || {}), monime_account_id: match.id }
          }).eq('id', wallet.id);
        }
        return match.id;
      }
    }
  } catch (e) {
    console.error('Monime resolution failed:', e);
  }
  return null;
}

export default async function handler(req: any, res: any) {
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

    const driverAccountId = await resolveMonimeAccountId(driverId);

    if (!driverAccountId) {
      return res.status(400).json({ error: `Missing Driver Wallet Account. Driver ID: ${driverId}` });
    }

    const driverEarnings = Math.round((Number(amount) * 0.85) * 100);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Authorization': `Bearer ${MONIME_API_KEY}`,
      'Monime-Space-Id': MONIME_SPACE_ID,
      'Idempotency-Key': `payout-${bookingId}-${Date.now()}`
    };

    // EXACT PAYLOAD KEYS AS DEMANDED BY MONIME LOGS
    const payload = {
      amount: { currency: "SLE", value: driverEarnings },
      sourceFinancialAccount: ADMIN_MASTER_ESCROW_ID,
      destinationFinancialAccount: driverAccountId,
      description: `Trip Earnings Payout for Booking ${bookingId}`
    };

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

    await supabase.from('bookings').update({ status: 'completed' }).eq('id', bookingId);
    return res.status(200).json({ success: true, driverAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}