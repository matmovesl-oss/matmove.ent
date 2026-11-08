import {createClient} from '@supabase/supabase-js';
import {
  readMonimeRawBody,
  verifyMonimeWebhookSignature,
  parseMonimeWebhook
} from '../server/monime-webhook-security.js';

export const config={api:{bodyParser:false}};

function serviceClient(){
  const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Webhook service configuration is incomplete.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});

  const secret=process.env.MONIME_WEBHOOK_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook service unavailable.'});

  let rawBody,event;
  try{
    rawBody=await readMonimeRawBody(req);
    if(!verifyMonimeWebhookSignature(rawBody,req.headers['monime-signature'],secret)){
      return res.status(401).json({error:'Unauthorized.'});
    }
    event=parseMonimeWebhook(rawBody);
    if(!event)return res.status(400).json({error:'Invalid event.'});
  }catch(error){
    const status=error?.status===413?413:400;
    return res.status(status).json({error:'Invalid request.'});
  }

  try{
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
    if(registration.error||!registration.data?.success){
      throw new Error('Unable to persist verified webhook event.');
    }

    // The event is durably stored before acknowledging Monime.
    // The Vercel Cron worker processes it asynchronously after this 2xx.
    return res.status(200).json({
      received:true,
      duplicate:registration.data.duplicate===true,
      queued:registration.data.processing_status!=='ignored'
    });
  }catch(error){
    console.error('MatMove Monime webhook intake failed:',error?.message||'unknown error');
    return res.status(503).json({error:'Webhook event could not be safely queued.'});
  }
}
