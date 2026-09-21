import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, recipientPhone } = req.body;
    if (!userId || !amount || !recipientPhone) return res.status(400).json({ error: 'Missing required parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const sourceWallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!sourceWallet || !sourceWallet.metadata?.monime_account_id) throw new Error('Your account is not linked to a Monime Wallet.');
    if (Number(sourceWallet.balance) < Number(amount)) throw new Error('Insufficient wallet balance.');

    // Find Recipient
    const { data: targetProfile } = await supabase.from('profiles').select('id').eq('phone', recipientPhone.trim()).single();
    if (!targetProfile) throw new Error('Recipient MatMove account not found.');

    const { data: targetWallets } = await supabase.from('wallets').select('*').eq('user_id', targetProfile.id).eq('currency', 'SLE');
    const targetWallet = targetWallets?.find(w => w.metadata?.monime_account_id);
    if (!targetWallet || !targetWallet.metadata?.monime_account_id) throw new Error('Recipient does not have an active Monime Wallet.');

    const valueMinor = Math.round(Number(amount) * 100);
    const idempotencyKey = `trans_${crypto.randomUUID()}`;

    const payload = {
      amount: { currency: "SLE", value: valueMinor },
      sourceFinancialAccount: { id: sourceWallet.metadata.monime_account_id },
      destinationFinancialAccount: { id: targetWallet.metadata.monime_account_id },
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
    let rawData;
    try { rawData = rawText ? JSON.parse(rawText) : {}; } 
    catch (e) { throw new Error(`Monime Non-JSON response: ${rawText.substring(0, 100)}`); }

    if (!monimeRes.ok || rawData.success === false) {
      let apiError = 'Monime API rejected the internal transfer';
      if (rawData.messages && Array.isArray(rawData.messages)) apiError = rawData.messages.map(m => m.message).join(' | ');
      else if (rawData.message) apiError = rawData.message;
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    await supabase.rpc('process_gateway_payment', { p_provider: 'monime_internal', p_wallet_id: sourceWallet.id, p_amount: -Number(amount), p_currency: 'SLE', p_reference: transactionId });
    await supabase.rpc('process_gateway_payment', { p_provider: 'monime_internal', p_wallet_id: targetWallet.id, p_amount: Number(amount), p_currency: 'SLE', p_reference: transactionId });

    return res.status(200).json({ success: true, message: 'Internal transfer processed!' });
  } catch (error) {
    console.error('Monime Internal Transfer Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}