import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { returnUrl, provider, ref, amount } = req.query;
  const redirectUrl = returnUrl || '/';

  // Validate Success strictly for Monime
  const isMonimeSuccess = provider === 'monime'; 

  if (!isMonimeSuccess) {
    return res.redirect(302, `${redirectUrl}?error=payment_failed`);
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Extract UserId from our custom reference format (e.g., MONIME_userid_timestamp)
    const parts = ref.split('_');
    const userId = parts[1];
    
    const { data: walletData } = await supabase.from('wallets').select('id').eq('user_id', userId).eq('currency', 'SLE').single();
    
    if (walletData) {
       // Hit the secure Admin function to log the transaction and update balance
       await supabase.rpc('process_gateway_payment', {
         p_provider: 'monime',
         p_wallet_id: walletData.id,
         p_amount: Number(amount || 0),
         p_currency: 'SLE',
         p_reference: ref
       });
    }

    return res.redirect(302, `${redirectUrl}?payment=success`);
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.redirect(302, `${redirectUrl}?error=server_error`);
  }
}