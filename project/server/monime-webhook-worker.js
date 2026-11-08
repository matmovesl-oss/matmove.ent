import {timingSafeEqual} from 'node:crypto';
import {dbClient,assertMonimeEnvironment} from './wallet-security.js';
import {checkoutWalletCredit} from './monime-webhook-processing.js';

const MAX_BATCH=3;
const MONIME_REQUEST_TIMEOUT_MS=6000;

export function isAuthorizedCronRequest(req,secret=process.env.CRON_SECRET){
  if(typeof secret!=='string'||secret.length<24)return false;
  const expected=Buffer.from('Bearer '+secret,'utf8');
  const actual=Buffer.from(String(req?.headers?.authorization||''),'utf8');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

export function classifyMonimeWebhookEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event))return 'ignored';
  if(event.type!=='checkout_session.completed')return 'ignored';
  const id=event.data?.id;
  return typeof id==='string'&&id.length>=4&&id.length<=160?'checkout':'ignored';
}

function serviceConfig(){
  const token=process.env.MONIME_API_KEY;
  const space=process.env.MONIME_SPACE_ID;
  if(!token||!space)throw new Error('Monime API configuration is incomplete.');
  assertMonimeEnvironment();
  return {token,space};
}

async function authoritativeCheckout(sessionId){
  const {token,space}=serviceConfig();
  const response=await fetch(
    'https://api.monime.io/v1/checkout-sessions/'+encodeURIComponent(sessionId),
    {
      method:'GET',
      headers:{
        Authorization:'Bearer '+token,
        'Monime-Space-Id':space,
        'Monime-Version':'caph.2025-08-23',
        Accept:'application/json'
      },
      signal:AbortSignal.timeout(MONIME_REQUEST_TIMEOUT_MS)
    }
  );
  const body=await response.json().catch(()=>null);
  if(response.status===404)return {notFound:true};
  if(!response.ok||!body?.result)throw new Error('Monime checkout verification is temporarily unavailable.');
  return {session:body.result};
}

async function updateEvent(db,id,values){
  const result=await db.from('provider_webhook_events')
    .update({...values,updated_at:new Date().toISOString()})
    .eq('id',id)
    .eq('processing_status','processing');
  if(result.error)throw new Error('Unable to update webhook event state.');
}

async function processEvent(db,row){
  const event=row.event_payload;
  const classification=classifyMonimeWebhookEvent({type:row.provider_event_type,data:event?.data});
  if(classification==='ignored'){
    await updateEvent(db,row.event_row_id,{
      processing_status:'ignored',
      processed_at:new Date().toISOString(),
      processing_error:'Event type or checkout reference is not eligible for MatMove wallet credit.'
    });
    return 'ignored';
  }

  const sessionId=event.data.id;
  const lookup=await authoritativeCheckout(sessionId);
  if(lookup.notFound){
    await updateEvent(db,row.event_row_id,{
      processing_status:'ignored',
      processed_at:new Date().toISOString(),
      processing_error:'Checkout session was not found in the configured Monime Space.'
    });
    return 'ignored';
  }

  const credit=checkoutWalletCredit(lookup.session);
  if(!credit||credit.checkoutSessionId!==sessionId){
    await updateEvent(db,row.event_row_id,{
      processing_status:'ignored',
      processed_at:new Date().toISOString(),
      processing_error:'Provider checkout receipt did not match MatMove wallet-load rules.'
    });
    return 'ignored';
  }

  const walletResult=await db.from('wallets')
    .select('id,user_id,currency,monime_account_id,metadata,is_frozen')
    .eq('user_id',credit.userId)
    .eq('currency','SLE')
    .maybeSingle();
  if(walletResult.error||!walletResult.data)throw new Error('Unique MatMove wallet could not be verified.');

  const wallet=walletResult.data;
  const direct=wallet.monime_account_id;
  const legacy=wallet.metadata?.monime_account_id;
  if((direct&&legacy&&direct!==legacy)||
     (direct||legacy)!==credit.financialAccountId||
     wallet.is_frozen===true){
    await updateEvent(db,row.event_row_id,{
      processing_status:'ignored',
      processed_at:new Date().toISOString(),
      processing_error:'Wallet account ownership or frozen status needs manual review.'
    });
    return 'ignored';
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
    p_event_id:row.event_row_id,
    p_wallet_id:wallet.id,
    p_user_id:credit.userId,
    p_financial_account_id:credit.financialAccountId,
    p_checkout_session_id:credit.checkoutSessionId,
    p_amount_minor:credit.amountMinor,
    p_verified_checkout:verifiedCheckout
  });
  if(posted.error||!posted.data?.success)throw new Error('Verified wallet credit could not be posted.');
  return 'processed';
}

export async function reconcileMonimeWebhookEvents(req,res,{dbFactory=dbClient}={}){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  if(!isAuthorizedCronRequest(req))return res.status(401).json({error:'Unauthorized.'});

  try{
    const db=dbFactory();
    const claimed=await db.rpc('matmove_claim_monime_customer_webhooks',{p_limit:MAX_BATCH});
    if(claimed.error||!Array.isArray(claimed.data))throw new Error('Webhook queue could not be claimed.');

    const results=await Promise.allSettled(claimed.data.map(row=>processEvent(db,row)));
    let processed=0,ignored=0,failed=0;
    for(let i=0;i<results.length;i++){
      const result=results[i];
      if(result.status==='fulfilled'){
        if(result.value==='processed')processed++;
        else ignored++;
      }else{
        failed++;
        const row=claimed.data[i];
        try{
          await updateEvent(db,row.event_row_id,{
            processing_status:'failed',
            processing_error:'Temporary verification or ledger failure. Retry is scheduled.'
          });
        }catch{
          // If this write also fails, the claim function reclaims this processing
          // event after five minutes.
        }
      }
    }
    return res.status(200).json({checked:claimed.data.length,processed,ignored,failed});
  }catch(error){
    console.error('MatMove webhook worker failed:',error?.message||'unknown error');
    return res.status(503).json({error:'Webhook worker unavailable.'});
  }
}
