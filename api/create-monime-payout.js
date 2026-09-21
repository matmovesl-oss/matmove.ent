import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, destinationPhone, networkProvider } = req.body;
    if (!userId || !amount || !destinationPhone) return res.status(400).json({ error: 'Missing parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const sourceWallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!sourceWallet || !sourceWallet.metadata?.monime_account_id) {
      throw new Error('Your account is not linked to a Monime Wallet yet.');
    }
    if (Number(sourceWallet.balance) < Number(amount)) {
      throw new Error('Insufficient wallet balance.');
    }

    const valueMinor = Math.round(Number(amount) * 100);
    const idempotencyKey = `payout_${crypto.randomUUID()}`;

    // --- STRICT PHONE FORMATTING (Force 0 prefix) ---
    let formattedPhone = destinationPhone.replace(/\D/g, '');
    if (formattedPhone.startsWith('232') && formattedPhone.length >= 11) {
      formattedPhone = '0' + formattedPhone.substring(3);
    } else if (formattedPhone.length === 8) {
      formattedPhone = '0' + formattedPhone;
    }

    let providerId = networkProvider === 'afrimoney' ? "m18" : "m17";
    if (formattedPhone.match(/^(0)?(30|33|34|35|77|79)/)) {
      providerId = "m18"; // Auto-detect Afrimoney
    }

    const payload = {
      amount: { currency: "SLE", value: valueMinor },
      source: { financialAccountId: sourceWallet.metadata.monime_account_id },
      destination: { type: "momo", providerId: providerId, phoneNumber: formattedPhone },
      reference: idempotencyKey
    };

    const monimeRes = await fetch('https://api.monime.io/v1/payouts', {
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
    catch (e) { throw new Error(`Monime Non-JSON Error: ${rawText.substring(0, 100)}`); }

    if (!monimeRes.ok || rawData.success === false) {
      let apiError = 'Monime API rejected the payout';
      if (rawData.messages && Array.isArray(rawData.messages)) {
        apiError = rawData.messages.map(m => m.message).join(' | ');
      } else if (rawData.message) {
        apiError = rawData.message;
      }
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    await supabase.rpc('process_gateway_payment', {
       p_provider: 'monime_cashout',
       p_wallet_id: sourceWallet.id,
       p_amount: -Number(amount), 
       p_currency: 'SLE',
       p_reference: transactionId
    });

    await supabase.from('withdrawal_requests').insert({
       user_id: userId, amount, currency: 'SLE', provider: 'monime', status: 'processing', destination_phone: formattedPhone, reference: transactionId
    });

    return res.status(200).json({ success: true, message: 'Payout requested successfully!' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}