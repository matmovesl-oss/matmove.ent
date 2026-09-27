import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;
const ADMIN_MASTER_ESCROW_ID = 'fac-k6V1AXPbAjLxDw9rnsDxWqYpjXp';

async function resolveMonimeAccountId(userId: string): Promise<string | null> {
  const { data: wallet } = await supabase.from('wallets').select('*').eq('user_id', userId).single();
  let accountId = wallet?.metadata?.monime_account_id || wallet?.monime_account_id;
  if (accountId && String(accountId).startsWith('fac-')) return accountId;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (!profile) return null;

  const phone = profile.phone || profile.phone_number || '';
  const fullName = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();

  try {
    const monimeRes = await fetch('https://api.monime.io/v1/financial_accounts', {
      headers: {
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'x-monime-space-id': MONIME_SPACE_ID
      }
    });

    if (monimeRes.ok) {
      const monimeData = await monimeRes.json();
      const accounts = monimeData.data || monimeData.accounts || [];

      const match = accounts.find((acc: any) => {
        const accName = String(acc.name || '').toLowerCase();
        return (
          (phone && accName.includes(phone.toLowerCase())) ||
          (fullName && accName.includes(fullName.toLowerCase()))
        );
      });

      if (match?.id) {
        await supabase.from('wallets').update({
          metadata: { ...(wallet?.metadata || {}), monime_account_id: match.id }
        }).eq('user_id', userId);

        return match.id;
      }
    }
  } catch (e) {
    console.error('Monime resolution error:', e);
  }

  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { bookingId, riderId, driverId, amount } = req.body;

    const riderAccountId = await resolveMonimeAccountId(riderId);
    if (!riderAccountId) {
      return res.status(400).json({ error: 'Rider Monime Account could not be resolved.' });
    }

    // Transfer full fare from Rider to Admin Escrow
    const monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'x-monime-space-id': MONIME_SPACE_ID
      },
      body: JSON.stringify({
        amount: { currency: "SLE", value: Math.round(Number(amount) * 100) },
        sourceAccountId: riderAccountId,
        destinationAccountId: ADMIN_MASTER_ESCROW_ID,
        description: `Escrow Hold for Booking ${bookingId}`
      })
    });

    if (!monimeResponse.ok) {
      const errJson = await monimeResponse.json().catch(() => ({}));
      return res.status(400).json({ error: errJson.message || 'Insufficient funds or Rider transfer failed.' });
    }

    await supabase.from('bookings').update({ 
       status: 'accepted', 
       driver_id: driverId 
    }).eq('id', bookingId);

    return res.status(200).json({ success: true, riderAccountId });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}