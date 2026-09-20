import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { status, tx_ref, returnUrl, provider, ref, amount } = req.query;
  const redirectUrl = returnUrl || '/';

  // Validate Success from either Flot (Flutterwave) or Monime
  const isFlotSuccess = status === 'successful' || status === 'completed';
  const isMonimeSuccess = provider === 'monime'; 

  if (!isFlotSuccess && !isMonimeSuccess) {
    return res.redirect(302, `${redirectUrl}?error=payment_failed`);
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    const reference = tx_ref || ref;
    const gateway = provider || (tx_ref ? 'flot' : 'monime');
    
    // Extract UserId from our custom reference format
    const parts = reference.split('_');
    const userId = parts[1];
    
    const { data: walletData } = await supabase.from('wallets').select('id').eq('user_id', userId).eq('currency', 'SLE').single();
    
    if (walletData) {
       // Hit the secure Admin function to log the transaction and update balance
       await supabase.rpc('process_gateway_payment', {
         p_provider: gateway,
         p_wallet_id: walletData.id,
         p_amount: Number(amount || 0),
         p_currency: 'SLE',
         p_reference: reference
       });
    }

    return res.redirect(302, `${redirectUrl}?payment=success`);
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.redirect(302, `${redirectUrl}?error=server_error`);
  }
}