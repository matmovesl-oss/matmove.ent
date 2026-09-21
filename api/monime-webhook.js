import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const event = req.body;
    if (!event || !event.type) return res.status(400).json({ error: 'Invalid event payload.' });

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const eventData = event.data || {};
    const ref = eventData.reference || eventData.id;

    switch (event.type) {
      case 'checkout_session.completed': {
        // We injected MatMove User ID into the reference (e.g. MONIME_123e4567-e89b..._1699999)
        const parts = (ref || '').split('_');
        const userId = parts[1]; 
        
        const lineItemPrice = eventData.lineItems?.data?.[0]?.price?.value || 0;
        const amountSLE = lineItemPrice > 0 ? lineItemPrice / 100 : Number(eventData.amount?.value || 0) / 100;

        if (userId && amountSLE > 0) {
          // Look up the exact Supabase internal UUID for the wallet
          const { data: walletData } = await supabase
            .from('wallets')
            .select('id')
            .eq('user_id', userId)
            .eq('currency', 'SLE')
            .single();

          if (walletData) {
            await supabase.rpc('process_gateway_payment', {
              p_provider: 'monime_payin',
              p_wallet_id: walletData.id, // Passes internal UUID to prevent 22P02 Error
              p_amount: amountSLE,
              p_currency: 'SLE',
              p_reference: ref
            });
          }
        }
        break;
      }

      case 'payout.completed': {
        if (ref) {
          await supabase
            .from('withdrawal_requests')
            .update({ status: 'completed' })
            .eq('reference', ref);
        }
        break;
      }

      case 'payout.failed': {
        if (ref) {
          const { data: request } = await supabase
            .from('withdrawal_requests')
            .select('*')
            .eq('reference', ref)
            .single();

          if (request && request.status !== 'failed') {
            await supabase
              .from('withdrawal_requests')
              .update({ status: 'failed' })
              .eq('reference', ref);

            const { data: walletData } = await supabase
              .from('wallets')
              .select('id')
              .eq('user_id', request.user_id)
              .eq('currency', 'SLE')
              .single();

            if (walletData) {
              await supabase.rpc('process_gateway_payment', {
                p_provider: 'monime_refund',
                p_wallet_id: walletData.id,
                p_amount: Number(request.amount),
                p_currency: 'SLE',
                p_reference: `refund_${ref}`
              });
            }
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('FATAL Webhook Error:', error);
    return res.status(500).json({ error: error.message });
  }
}