import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || ''
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY || '';
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID || '';

async function resolveMonimeAccountId(userId) {
  try {
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).limit(1);
    const wallet = wallets && wallets[0];
    let accountId = (wallet && wallet.metadata && wallet.metadata.monime_account_id) || (wallet && wallet.monime_account_id);
    if (accountId && String(accountId).startsWith('fac-')) return accountId;

    const monimeRes = await fetch('https://api.monime.io/v1/financial-accounts', {
      headers: { 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID, 'Accept': '*/*' }
    });
    if (monimeRes.ok) {
      const monimeData = await monimeRes.json();
      const accounts = monimeData.result || monimeData.data || [];
      const match = accounts.find(acc => acc.reference === userId);
      if (match && match.id) return match.id;
    }
  } catch (e) { console.error(e); }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const amount = req.body && req.body.amount;
    const userId = req.body && req.body.userId;
    const role = (req.body && req.body.role) || 'rider';
    
    if (!amount || !userId) return res.status(400).json({ error: 'Missing amount or userId.' });

    const targetAccountId = await resolveMonimeAccountId(userId);
    if (!targetAccountId) return res.status(400).json({ error: 'User Monime Account could not be resolved.' });

    const loadAmountMinor = Math.round(Number(amount) * 100);
    const hostUrl = (req.headers && req.headers.origin) ? req.headers.origin : 'https://matmoveent.vercel.app';

    const payload = {
      name: `MatMove Wallet Top-up`,
      // 🔴 REDIRECT TO ROOT TO FIX 405 AND TRIGGER PIN LOCK
      successUrl: `${hostUrl}/`, 
      cancelUrl: `${hostUrl}/`,
      financialAccountId: targetAccountId,
      lineItems: [{ type: "custom", name: "Wallet Load", price: { currency: "SLE", value: loadAmountMinor }, quantity: 1 }],
      metadata: { userId: userId, role: role }
    };

    const monimeResponse = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': '*/*', 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID, 'Idempotency-Key': `load-${userId}-${Date.now()}` },
      body: JSON.stringify(payload)
    });

    const resText = await monimeResponse.text();
    let sessionData = {};
    try { sessionData = JSON.parse(resText); } catch (e) {}

    if (!monimeResponse.ok) return res.status(400).json({ error: sessionData.message || resText });

    const result = sessionData.result || sessionData;
    const checkoutUrl = result.redirectUrl || result.url;
    if (!checkoutUrl) return res.status(400).json({ error: 'Monime did not return a valid checkout URL.' });

    return res.status(200).json({ link: checkoutUrl });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}