import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

const MONIME_API_KEY = process.env.VITE_MONIME_API_KEY || process.env.MONIME_API_KEY!;
const MONIME_SPACE_ID = process.env.VITE_MONIME_SPACE_ID || process.env.MONIME_SPACE_ID!;

async function resolveMonimeAccountId(userId: string) {
  try {
    const { data: w1 } = await supabase.from('wallets').select('*').eq('user_id', userId).limit(1);
    const { data: w2 } = await supabase.from('wallets').select('*').eq('id', userId).limit(1);
    const wallet = w1?.[0] || w2?.[0];
    
    let accountId = wallet?.metadata?.monime_account_id || wallet?.monime_account_id;
    if (accountId && String(accountId).startsWith('fac-')) return accountId;

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
      if (match?.id) return match.id;
    }
  } catch (e) {
    console.error('Monime resolution error:', e);
  }
  return null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, role } = req.body || {};
    
    if (!amount || !userId) {
      return res.status(400).json({ error: 'Missing amount or userId.' });
    }

    const targetAccountId = await resolveMonimeAccountId(userId);
    if (!targetAccountId) {
      return res.status(400).json({ error: `User Monime Account could not be resolved for ID: ${userId}` });
    }

    const loadAmountMinor = Math.round(Number(amount) * 100);
    const hostUrl = req.headers?.origin || 'https://matmoveent.vercel.app';

    const payload = {
      name: `MatMove ${String(role || 'User').toUpperCase()} Wallet Top-up`,
      successUrl: `${hostUrl}/customer/${role || 'rider'}?load=success`,
      cancelUrl: `${hostUrl}/customer/${role || 'rider'}?load=cancelled`,
      financialAccountId: targetAccountId,
      lineItems: [
        {
          type: "custom",
          name: "Wallet Load",
          price: { currency: "SLE", value: loadAmountMinor },
          quantity: 1
        }
      ],
      metadata: { userId, role }
    };

    const monimeResponse = await fetch('https://api.monime.io/v1/checkout-sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Authorization': `Bearer ${MONIME_API_KEY}`,
        'Monime-Space-Id': MONIME_SPACE_ID,
        'Idempotency-Key': `load-${userId}-${Date.now()}`
      },
      body: JSON.stringify(payload)
    });

    const resText = await monimeResponse.text();
    let sessionData: any = {};
    try { sessionData = JSON.parse(resText); } catch (e) {}

    if (!monimeResponse.ok) {
      return res.status(400).json({ error: `Checkout Creation Failed: ${monimeResponse.status} - ${sessionData.message || resText}` });
    }

    const result = sessionData.result || sessionData;
    const checkoutUrl = result.redirectUrl || result.url;

    if (!checkoutUrl) {
      return res.status(400).json({ error: 'Monime did not return a valid checkout URL.' });
    }

    return res.status(200).json({ link: checkoutUrl });

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}