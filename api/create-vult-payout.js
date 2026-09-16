import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { amount, userId, destinationPhone } = req.body;

    if (!amount || Number(amount) <= 0 || !userId) {
      return res.status(400).json({ error: 'Missing amount or user ID.' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Verify user profile & balance
    const { data: profile } = await supabase.from('profiles').select('kyc_status, role').eq('id', userId).single();
    if (profile?.kyc_status !== 'approved') {
      return res.status(403).json({ error: 'Admin KYC approval is required for cashouts.' });
    }

    const { data: wallet } = await supabase.from('wallets').select('id, balance').eq('user_id', userId).single();
    if (!wallet || Number(wallet.balance) < Number(amount)) {
      return res.status(400).json({ error: 'Insufficient wallet balance for cashout.' });
    }

    // 2. Prepare Vult payload
    const orderId = `WD_${userId}_${Date.now()}`;
    const formattedAmount = String(Number(amount));

    const requestBody = {
      merchantId: process.env.VULT_MERCHANT_ID,
      type: 'momo',
      payload: {
        orderId: orderId,
        currency: 'SLE',
        amount: formattedAmount,
        recipient: destinationPhone
      }
    };

    let privateKey = process.env.VULT_PRIVATE_KEY;
    if (privateKey && privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const bodyString = JSON.stringify(requestBody);
    const signer = crypto.createSign('RSA-SHA512');
    signer.update(bodyString);
    const signature = signer.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');

    // 3. Deduct wallet balance and log transaction
    const newBalance = Number(wallet.balance) - Number(amount);
    await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);

    await supabase.from('payment_transactions').insert({
      user_id: userId,
      transaction_type: 'withdrawal',
      provider: 'vult',
      amount: Number(amount),
      currency: 'SLE',
      status: 'pending',
      metadata: { order_id: orderId, destination_phone: destinationPhone }
    });

    return res.status(200).json({ success: true, message: `Withdrawal request of SLE ${amount} submitted successfully!` });

  } catch (error) {
    console.error('Vult Cashout Exception:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}