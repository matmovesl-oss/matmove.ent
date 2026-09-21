import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { userId, amount, transferType, destinationPhone, networkProvider } = req.body;
    if (!userId || !amount || !destinationPhone) return res.status(400).json({ error: 'Missing parameters.' });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Sender Wallet
    const { data: wallets } = await supabase.from('wallets').select('*').eq('user_id', userId).eq('currency', 'SLE');
    const sourceWallet = wallets?.find(w => w.metadata?.monime_account_id);
    
    if (!sourceWallet) throw new Error('Your account is not linked to a Monime Wallet yet.');
    if (Number(sourceWallet.balance) < Number(amount)) throw new Error('Insufficient wallet balance.');

    // Amount must be in minor units (cents)
    const valueMinor = Math.round(Number(amount) * 100);
    const idempotencyKey = `trans_${crypto.randomUUID()}`;

    let apiUrl = '';
    let payload = {};
    let targetWalletId = null;

    if (transferType === 'matmove_user') {
      // ==========================================
      // MODE A: INTERNAL TRANSFER (Wallet to Wallet)
      // ==========================================
      const cleanSearchPhone = destinationPhone.trim();
      const { data: targetProfile } = await supabase.from('profiles').select('id').eq('phone', cleanSearchPhone).single();
      
      if (!targetProfile) throw new Error(`No MatMove account found for phone number: ${cleanSearchPhone}`);

      const { data: targetWallets } = await supabase.from('wallets').select('*').eq('user_id', targetProfile.id).eq('currency', 'SLE');
      const targetWallet = targetWallets?.find(w => w.metadata?.monime_account_id);
      if (!targetWallet) throw new Error('Recipient does not have a valid Monime Wallet setup yet.');

      targetWalletId = targetWallet.id;
      apiUrl = 'https://api.monime.io/v1/internal-transfers';
      
      // Strict Monime Schema for Internal Transfers
      payload = {
        amount: { currency: "SLE", value: valueMinor },
        sourceFinancialAccount: { id: sourceWallet.metadata.monime_account_id },
        destinationFinancialAccount: { id: targetWallet.metadata.monime_account_id },
        description: "MatMove Internal Transfer"
      };

    } else {
      // ==========================================
      // MODE B: EXTERNAL PAYOUT (Mobile Money)
      // ==========================================
      apiUrl = 'https://api.monime.io/v1/payouts';
      
      // Map provider to strict Monime ENUMS: m17 = Orange, m18 = Afrimoney
      let providerId = networkProvider === 'afrimoney' ? "m18" : "m17";
      const cleanPhone = destinationPhone.replace(/\D/g, '');
      if (cleanPhone.match(/^(232|0)?(30|33|34|35|77|79)/)) {
        providerId = "m18"; // Auto-detect Afrimoney prefix
      }
      
      // Strict Monime Schema for Payouts
      payload = {
        amount: { currency: "SLE", value: valueMinor },
        source: { financialAccountId: sourceWallet.metadata.monime_account_id },
        destination: {
          type: "momo",
          providerId: providerId,
          phoneNumber: destinationPhone
        }
      };
    }

    // 2. Call Monime API
    const monimeRes = await fetch(apiUrl, {
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
    catch (e) { throw new Error(`Monime Error (Not JSON): ${rawText.substring(0, 100)}...`); }

    // Check for success == true OR status == 200
    if (!monimeRes.ok || rawData.success === false) {
      let apiError = 'Unknown API error';
      if (rawData.messages && Array.isArray(rawData.messages)) {
        apiError = rawData.messages.map(m => m.message || JSON.stringify(m)).join(' | ');
      } else if (rawData.message) {
        apiError = rawData.message;
      } else {
        apiError = JSON.stringify(rawData);
      }
      throw new Error(apiError);
    }

    const transactionId = rawData.result?.id || rawData.id || idempotencyKey;

    // 3. Process Ledger Updates
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