import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, recipientAccountId } = req.body;
    if (!userId || !amount || !recipientAccountId) return res.status(400).json({ error: 'Missing required parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const sourceWallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!sourceWallet || !sourceWallet.metadata?.monime_account_id) {
        throw new Error('Your account is not linked to a Monime Wallet.');
    }

    // REMOVED LOCAL BALANCE CHECK. Monime acts as the source of truth.

    const valueMinor = Math.round(Number(amount) * 100);
    const idempotencyKey = `trans_${crypto.randomUUID()}`;

    // STRICT SCHEMA: No extra tracking reference fields in the body
    const payload = {
      amount: { currency: "SLE", value: valueMinor },
      sourceFinancialAccount: { id: sourceWallet.metadata.monime_account_id },
      destinationFinancialAccount: { id: recipientAccountId }
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
    let rawData;
    try { rawData = rawText ? JSON.parse(rawText) : {}; } 
    catch (e) { throw new Error(`Monime Server Error: ${rawText.substring(0, 100)}`); }

    // Enhanced error parsing for Monime rejections
    if (!monimeRes.ok || rawData.success === false) {
      let apiError = 'Monime API rejected the internal transfer';
      if (rawData.messages && Array.isArray(rawData.messages) && rawData.messages.length > 0) {
          apiError = rawData.messages.map(m => m.message).join(' | ');
      } else if (rawData.message) {
          apiError = rawData.message;
      } else if (rawData.failureDetail?.message) {
          apiError = rawData.failureDetail.message;
      } else if (rawData.error) {
          apiError = rawData.error;
      }
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    await supabase.rpc('process_gateway_payment', { p_provider: 'monime_internal', p_wallet_id: sourceWallet.id, p_amount: -Number(amount), p_currency: 'SLE', p_reference: transactionId });
    
    const { data: allWallets } = await supabase.from('wallets').select('id, metadata');
    const targetWallet = allWallets?.find(w => w.metadata?.monime_account_id === recipientAccountId);
    if (targetWallet) {
      await supabase.rpc('process_gateway_payment', { p_provider: 'monime_internal', p_wallet_id: targetWallet.id, p_amount: Number(amount), p_currency: 'SLE', p_reference: transactionId });
    }

    return res.status(200).json({ success: true, message: 'Internal transfer processed!' });
  } catch (error) {
    console.error('Monime Internal Transfer Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}