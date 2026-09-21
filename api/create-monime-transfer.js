import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, transferType, destinationPhone, destinationEmail, networkProvider } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Sender Wallet
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const sourceWallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!sourceWallet) throw new Error('Your account is not linked to a Monime Wallet yet.');
    if (Number(sourceWallet.balance) < Number(amount)) throw new Error('Insufficient wallet balance.');

    const idempotencyKey = `trans_${crypto.randomUUID()}`;
    let apiUrl = '';
    let payload = {};
    let targetWalletId = null;

    if (transferType === 'matmove_user') {
      // MODE A: INTERNAL TRANSFER (MatMove to MatMove)
      if (!destinationEmail) throw new Error('Recipient email is required.');
      const { data: targetProfile } = await supabase.from('profiles').select('id').eq('email', destinationEmail.trim().toLowerCase()).single();
      if (!targetProfile) throw new Error('MatMove user not found.');

      const { data: targetWallets } = await supabase.from('wallets').select('*').eq('user_id', targetProfile.id).eq('currency', 'SLE');
      const targetWallet = targetWallets?.find(w => w.metadata?.monime_account_id);
      if (!targetWallet) throw new Error('Target user does not have a valid Monime Wallet.');

      targetWalletId = targetWallet.id;
      apiUrl = 'https://api.monime.io/v1/internal-transfers';
      
      payload = {
        sourceAccountId: sourceWallet.metadata.monime_account_id,
        destinationAccountId: targetWallet.metadata.monime_account_id,
        amount: Number(amount),
        currency: "SLE",
        reference: idempotencyKey,
        description: "MatMove Wallet to Wallet Transfer"
      };

    } else {
      // MODE B: EXTERNAL PAYOUT (Mobile Money Cashout)
      if (!destinationPhone) throw new Error('Mobile Money number is required.');
      apiUrl = 'https://api.monime.io/v1/payouts';
      
      // Ensure lowercase network provider
      let provider = networkProvider ? networkProvider.toLowerCase() : "orange";
      const cleanPhone = destinationPhone.replace(/\D/g, '');
      if (cleanPhone.match(/^(232|0)?(30|33|34|35|77|79)/)) {
        provider = "afrimoney";
      }
      
      // STRICT FLATTENED PAYLOAD BASED ON MONIME SPECS
      payload = {
        sourceAccountId: sourceWallet.metadata.monime_account_id,
        amount: Number(amount),
        currency: "SLE",
        destination: {
          type: "mobile_money",
          provider: provider,
          phoneNumber: destinationPhone
        },
        reference: idempotencyKey
      };
    }

    // 2. Call Monime API
    const monimeRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONIME_API_KEY}`,
        'Monime-Space-Id': process.env.MONIME_SPACE_ID,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });

    // 3. Bulletproof Error Parsing (Prevents blank errors)
    const rawText = await monimeRes.text();
    let rawData;
    try {
      rawData = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      throw new Error(`Monime returned invalid JSON: ${rawText.substring(0, 100)}...`);
    }

    if (!monimeRes.ok || rawData.success === false || rawData.status === 'failed') {
      let apiError = 'Unknown error';
      if (rawData.messages && Array.isArray(rawData.messages)) {
        apiError = rawData.messages.map(m => m.message || JSON.stringify(m)).join(' | ');
      } else if (rawData.error) {
        apiError = typeof rawData.error === 'string' ? rawData.error : JSON.stringify(rawData.error);
      } else if (rawData.message) {
        apiError = rawData.message;
      } else {
        apiError = JSON.stringify(rawData);
      }
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    // 4. Update Ledgers
    await supabase.rpc('process_gateway_payment', {
       p_provider: transferType === 'matmove_user' ? 'monime_internal' : 'monime_cashout',
       p_wallet_id: sourceWallet.id,
       p_amount: -Number(amount), 
       p_currency: 'SLE',
       p_reference: transactionId
    });

    if (transferType === 'matmove_user' && targetWalletId) {
      await supabase.rpc('process_gateway_payment', {
         p_provider: 'monime_internal',
         p_wallet_id: targetWalletId,
         p_amount: Number(amount), 
         p_currency: 'SLE',
         p_reference: transactionId
      });
    } else {
      await supabase.from('withdrawal_requests').insert({
         user_id: userId, amount, currency: 'SLE', provider: 'monime', status: 'completed', destination_phone: destinationPhone
      });
    }

    return res.status(200).json({ success: true, message: 'Transfer successful!' });
  } catch (error) {
    console.error('Monime Transfer Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}