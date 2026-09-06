import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event, data } = req.body;

    // Verify successful payment event from Monime / Vult
    if (event === 'payment.completed' || event === 'checkout.session.completed') {
      const userId = data?.metadata?.user_id;
      const amount = Number(data?.amount);
      const reference = data?.reference || data?.id;

      if (!userId || !amount) {
        return res.status(400).json({ error: 'Missing payment metadata' });
      }

      // Admin connection to run the wallet RPC
      const supabaseAdmin = createClient(
        process.env.VITE_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const { error } = await supabaseAdmin.rpc('process_wallet_transaction', {
        p_amount: amount,
        p_type: 'topup',
        p_description: `Monime/Vult Payment Ref: ${reference}`
      });

      if (error) {
        console.error('RPC Error:', error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ status: 'success', reference });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}