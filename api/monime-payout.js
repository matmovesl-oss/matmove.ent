import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, phone, userId } = req.body;

    if (!amount || !phone || !userId) {
      return res.status(400).json({ error: 'Missing payout fields' });
    }

    // 1. Initialize Supabase Admin Client
    const supabaseAdmin = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 2. Fetch User Profile & Role Verification
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('role, kyc_status')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    if (profile.role === 'rider' || profile.role === 'client') {
      return res.status(403).json({ error: 'Riders are not permitted to withdraw funds' });
    }

    if (profile.kyc_status !== 'approved') {
      return res.status(403).json({ error: 'Approved KYC required for payouts' });
    }

    // 3. Initiate Monime Payout API Request
    const monimeRes = await fetch('https://api.monime.sl/v1/payouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        space_id: process.env.MONIME_SPACE_ID,
        amount: amount,
        currency: 'SLE',
        destination: {
          type: 'mobile_money',
          phone_number: phone
        },
        metadata: { user_id: userId }
      })
    });

    const payoutData = await monimeRes.json();

    if (!monimeRes.ok) {
      return res.status(500).json({ error: payoutData.message || 'Monime Payout Failed' });
    }

    return res.status(200).json({ status: 'success', payout: payoutData });

  } catch (err) {
    console.error('Payout API Exception:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}