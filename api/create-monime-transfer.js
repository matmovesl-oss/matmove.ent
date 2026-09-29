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
    const recipientAccountId = req.body && req.body.recipientAccountId;

    if (!amount || !userId || !recipientAccountId) return res.status(400).json({ error: 'Missing required fields.' });

    const sourceAccountId = await resolveMonimeAccountId(userId);
    if (!sourceAccountId) return res.status(400).json({ error: 'Your Source Wallet Account was not found.' });

    const transferAmountMinor = Math.round(Number(amount) * 100);

    const payload = {
      amount: { currency: "SLE", value: transferAmountMinor },
      sourceFinancialAccount: { id: sourceAccountId },
      destinationFinancialAccount: { id: recipientAccountId },
      description: `P2P Transfer from ${userId}`
    };

    let monimeResponse = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': '*/*', 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID, 'Idempotency-Key': `transfer-${userId}-${Date.now()}` },
      body: JSON.stringify(payload)
    });

    if (monimeResponse.status === 404) {
      monimeResponse = await fetch('https://api.monime.io/v1/internal_transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': '*/*', 'Authorization': `Bearer ${MONIME_API_KEY}`, 'Monime-Space-Id': MONIME_SPACE_ID, 'Idempotency-Key': `transfer-${userId}-${Date.now()}` },
        body: JSON.stringify(payload)
      });
    }

    const resText = await monimeResponse.text();
    let transferData = {};
    try { transferData = JSON.parse(resText); } catch (e) {}

    if (!monimeResponse.ok) return res.status(400).json({ error: transferData.message || resText });

    const result = transferData.result || transferData;
    if (result.status === 'failed') {
      const reason = (result.failureDetail && (result.failureDetail.message || result.failureDetail.code)) || 'Unknown error';
      return res.status(400).json({ error: `Transfer failed: ${reason}` });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}