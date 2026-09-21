import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, destinationPhone } = req.body;
    if (!userId || !amount || !destinationPhone) return res.status(400).json({ error: 'Missing parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const wallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!wallet) throw new Error('Your account is not linked to a Monime Wallet yet.');
    if (Number(wallet.balance) < Number(amount)) throw new Error('Insufficient wallet balance.');

    // Dynamically detect Afrimoney vs Orange Money based on prefix (lowercase as required by Monime)
    let network = "orange";
    const cleanPhone = destinationPhone.replace(/\D/g, '');
    if (cleanPhone.match(/^(232|0)?(30|33|34|35|77|79)/)) {
      network = "afrimoney";
    }

    const idempotencyKey = `cashout_${crypto.randomUUID()}`;
    
    // EXACT PAYLOAD FROM MONIME DOCS
    const payload = {
      sourceAccountId: wallet.metadata.monime_account_id,
      amount: Number(amount),
      currency: "SLE",
      destination: {
        type: "mobile_money",
        provider: network,
        phoneNumber: destinationPhone
      },
      reference: idempotencyKey
    };

    const monimeRes = await fetch('https://api.monime.io/v1/payouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });

    const rawData = await monimeRes.json();
    if (!monimeRes.ok || rawData.success === false) {
      throw new Error(rawData.messages?.join(', ') || rawData.message || 'Monime API rejected the payout.');
    }

    // Deduct the funds securely from the MatMove ledger
    await supabase.rpc('process_gateway_payment', {
       p_provider: 'monime_cashout',
       p_wallet_id: wallet.id,
       p_amount: -Number(amount), 
       p_currency: 'SLE',
       p_reference: rawData.id || idempotencyKey
    });

    await supabase.from('withdrawal_requests').insert({
       user_id: userId, amount, currency: 'SLE', provider: 'monime', status: 'completed', destination_phone: destinationPhone
    });

    return res.status(200).json({ success: true, message: 'Cashout successful!' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}