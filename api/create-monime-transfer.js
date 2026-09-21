import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, recipientAccountId } = req.body;
    if (!userId || !amount || !recipientAccountId) {
      return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('currency', 'SLE')
      .single();
    
    if (!wallet || !wallet.metadata?.monime_account_id) {
      throw new Error('Your wallet is not linked to a valid Monime Financial Account.');
    }

    const sourceAccountId = wallet.metadata.monime_account_id;
    if (sourceAccountId === recipientAccountId) {
      throw new Error('Cannot perform an internal transfer to the same account.');
    }

    const valueMinor = Math.round(Number(amount) * 100);
    const idempotencyKey = `trans_${crypto.randomUUID()}`;

    const payload = {
      amount: { currency: "SLE", value: valueMinor },
      sourceFinancialAccount: { id: sourceAccountId },
      destinationFinancialAccount: { id: recipientAccountId },
      description: "MatMove Internal Transfer"
    };

    const monimeRes = await fetch('https://api.monime.io/v1/internal-transfers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Idempotency-Key': idempotencyKey,
        'Monime-Version': 'caph.2025-08-23'
      },
      body: JSON.stringify(payload)
    });

    const rawText = await monimeRes.text();
    let rawData = {};
    try { rawData = rawText ? JSON.parse(rawText) : {}; } 
    catch (e) { throw new Error(`Monime Non-JSON Response: ${rawText.substring(0, 100)}`); }

    if (!monimeRes.ok || rawData.success === false) {
      let apiError = 'Monime API rejected the internal transfer';
      if (rawData.messages && Array.isArray(rawData.messages) && rawData.messages.length > 0) {
        apiError = rawData.messages.map(m => m.message || JSON.stringify(m)).join(' | ');
      } else if (rawData.message) {
        apiError = rawData.message;
      } else if (rawData.failureDetail?.message) {
        apiError = rawData.failureDetail.message;
      }
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    await supabase.rpc('process_gateway_payment', { 
      p_provider: 'monime_internal', 
      p_wallet_id: wallet.id, 
      p_amount: -Number(amount), 
      p_currency: 'SLE', 
      p_reference: transactionId 
    });

    return res.status(200).json({ success: true, message: 'Internal transfer processed!' });
  } catch (error) {
    console.error('Monime Internal Transfer Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}