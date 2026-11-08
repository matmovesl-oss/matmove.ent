import { createClient } from '@supabase/supabase-js';
import {
  readMonimeRawBody,
  verifyMonimeWebhookSignature,
  parseMonimeWebhook
} from '../server/monime-webhook-security.js';
import { checkoutWalletCredit } from '../server/monime-webhook-processing.js';

export const config = { api: { bodyParser: false } };

function serviceClient() {
  const url=process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key) throw new Error('Webhook service configuration is incomplete.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function getAuthoritativeCheckout(sessionId) {
  const token=process.env.MONIME_API_KEY;
  const spaceId=process.env.MONIME_SPACE_ID;
  if(!token || !spaceId) throw new Error('Monime API configuration is incomplete.');
  const response=await fetch('https://api.monime.io/v1/checkout-sessions/'+encodeURIComponent(sessionId),{
    method:'GET',
    headers:{
      Authorization:'Bearer '+token,
      'Monime-Space-Id':spaceId,
      'Monime-Version':'caph.2025-08-23',
      Accept:'application/json'
    },
    signal:AbortSignal.timeout(3500)
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok || !body?.result) throw new Error('Monime checkout status could not be verified.');
  return body.result;
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');

  if(req.method!=='POST') return res.status(405).json({error:'Method Not Allowed'});

  const secret=process.env.MONIME_WEBHOOK_SECRET;
  if(!secret) return res.status(503).json({error:'Webhook service unavailable.'});

  let rawBody,event;
  try {
    rawBody=await readMonimeRawBody(req);
    if(!verifyMonimeWebhookSignature(rawBody,req.headers['monime-signature'],secret)) {
      return res.status(401).json({error:'Unauthorized.'});
    }
    event=parseMonimeWebhook(rawBody);
    if(!event) return res.status(400).json({error:'Invalid event.'});
  } catch(error) {
    const status=error?.status===413?413:400;
    return res.status(status).json({error:'Invalid request.'});
  }

  try {
    const db=serviceClient();
    const registration=await db.rpc('register_provider_webhook_event',{
      p_provider:'monime_customer',
      p_event_id:event.id,
      p_event_type:event.type,
      p_withdrawal_id:null,
      p_payment_transaction_id:null,
      p_provider_transaction_id:null,
      p_idempotency_key:event.id,
      p_payload:event
    });
    if(registration.error || !registration.data?.success || typeof registration.data.event_id!=='string') {
      throw new Error('Unable to persist verified webhook event.');
    }

    const stored=registration.data;
    if(stored.duplicate && ['processed','ignored','processing'].includes(stored.processing_status)) {
      return res.status(200).json({received:true,duplicate:true});
    }

    if(event.type!=='checkout_session.completed') {
      const ignored=await db.from('provider_webhook_events')
        .update({processing_status:'ignored',processed_at:new Date().toISOString(),processing_error:null})
        .eq('id',stored.event_id)
        .eq('provider','monime_customer');
      if(ignored.error) throw new Error('Unable to record ignored webhook event.');
      return res.status(200).json({received:true,ignored:true});
    }

    const sessionId=event.data?.id;
    if(typeof sessionId!=='string' || sessionId.length<4 || sessionId.length>160) {
      throw new Error('Checkout session ID is invalid.');
    }

    const session=await getAuthoritativeCheckout(sessionId);
    const credit=checkoutWalletCredit(session);
    if(!credit || credit.checkoutSessionId!==sessionId) {
      throw new Error('Completed checkout does not match MatMove wallet-load rules.');
    }

    const walletResult=await db.from('wallets')
      .select('id,user_id,currency,monime_account_id,metadata,is_frozen')
      .eq('user_id',credit.userId)
      .eq('currency','SLE')
      .maybeSingle();
    if(walletResult.error || !walletResult.data) {
      throw new Error('Unique MatMove SLE wallet could not be verified.');
    }

    const wallet=walletResult.data;
    const direct=wallet.monime_account_id;
    const legacy=wallet.metadata?.monime_account_id;
    if((direct && legacy && direct!==legacy) ||
       (direct || legacy)!==credit.financialAccountId ||
       wallet.is_frozen===true) {
      throw new Error('Wallet account ownership needs manual review.');
    }

    const verifiedCheckout={
      id:credit.checkoutSessionId,
      status:'completed',
      financialAccountId:credit.financialAccountId,
      userId:credit.userId,
      amountMinor:credit.amountMinor,
      currency:'SLE',
      role:credit.role
    };

    const posted=await db.rpc('matmove_credit_monime_checkout',{
      p_event_id:stored.event_id,
      p_wallet_id:wallet.id,
      p_user_id:credit.userId,
      p_financial_account_id:credit.financialAccountId,
      p_checkout_session_id:credit.checkoutSessionId,
      p_amount_minor:credit.amountMinor,
      p_verified_checkout:verifiedCheckout
    });
    if(posted.error || !posted.data?.success) throw new Error('Verified wallet credit could not be posted.');

    return res.status(200).json({
      received:true,
      processed:true,
      duplicate:posted.data.duplicate===true
    });
  } catch(error) {
    console.error('MatMove Monime webhook processing failed:',error?.message||'unknown error');
    return res.status(503).json({error:'Webhook processing unavailable. The provider may retry this event.'});
  }
}
