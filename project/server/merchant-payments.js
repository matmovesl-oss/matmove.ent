


import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, assertAllowed, verifiedAccount, toMinorUnits, keyFor, monime, dbClient } from './wallet-security.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const final = state => ['completed','failed','review_required'].includes(state);
export function merchantFees(productMinor, delivery) {
  if (!Number.isSafeInteger(productMinor) || productMinor <= 0 || productMinor > 1000000000000 || typeof delivery !== 'boolean') throw new HttpError(400,'Invalid product total or delivery choice.');
  const deliveryMinor = delivery ? 5000 : 0;
  const feeMinor = Number((BigInt(productMinor + deliveryMinor) + 50n) / 100n);
  return { productMinor, deliveryMinor, feeMinor, totalMinor: productMinor + deliveryMinor + feeMinor };
}
async function rpc(db,name,args) {
  const { data,error } = await db.rpc(name,args);
  if (error) {
    console.error('MatMove merchant payment RPC failed',{ function:name,code:error.code,message:error.message });
    const known=/^(FORBIDDEN|CONFLICT|INVALID|NOT_FOUND):/.test(error.message);
    throw new HttpError(known ? 409 : 503,known ? error.message.replace(/^[A-Z_]+: /,'') : 'Merchant payment storage is unavailable. Run MERCHANT_PAYMENTS_SETUP.sql.');
  }
  return data;
}
function payload(body) {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length>50 || typeof body.delivery !== 'boolean') throw new HttpError(400,'Choose products and a delivery option.');
  const merged=new Map();
  for (const item of body.items) {
    if (!uuid.test(String(item.productId)) || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>100) throw new HttpError(400,'Invalid product or quantity.');
    merged.set(item.productId,(merged.get(item.productId)||0)+item.quantity);
  }
  const items=[...merged].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({ productId,quantity }));
  if (items.some(x=>x.quantity>100)) throw new HttpError(400,'Maximum quantity per product is 100.');
  let phone=String(body.phone||'').replace(/[\s()-]/g,'');
  if (/^0\d{8}$/.test(phone)) phone='+232'+phone.slice(1);
  if (/^232\d{8}$/.test(phone)) phone='+'+phone;
  if (!/^\+232\d{8}$/.test(phone)) throw new HttpError(400,'Enter a valid Sierra Leone contact phone.');
  const address=body.delivery ? String(body.address||'').trim() : 'Product only — pickup arranged with merchant';
  if (body.delivery && (address.length<5 || address.length>500 || body.city!=='Freetown')) throw new HttpError(400,'SLE 50 delivery is available in Freetown. Enter your full street address.');
  const normalized={ items,delivery:body.delivery,phone,address,city:body.delivery ? 'Freetown' : null };
  return { ...normalized, hash:createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
}
async function read(db,id) {
  const {data,error}=await db.from('matmove_merchant_payments').select('*').eq('id',id).maybeSingle();
  if(error) throw new HttpError(503,'Merchant payment storage is unavailable.');
  if(!data) throw new HttpError(404,'Merchant payment not found.');
  return data;
}
async function customerAccount(db,userId,role,verify) {
  const [p,w]=await Promise.all([db.from('profiles').select('*').eq('id',userId).single(),db.from('wallets').select('*').eq('user_id',userId)]);
  if(p.error||w.error||!p.data) throw new HttpError(503,'Unable to verify merchant wallet permissions.');
  if(p.data.role!==role) throw new HttpError(403,'Merchant account required.');
  assertAllowed(p.data,w.data||[],'purchase');
  const wallets=(w.data||[]).filter(x=>x.currency==='SLE');
  if(wallets.length!==1) throw new HttpError(409,'A unique SLE merchant wallet is required.');
  return verify(db,wallets[0]);
}
export async function runMerchantLeg(db,id,kind,provider=monime) {
  const leg=await rpc(db,'matmove_claim_merchant_leg',{p_id:id,p_kind:kind});
  if(!leg || ['completed','failed','review_required'].includes(leg.status) || (!leg.can_create&&!leg.provider_id)) return leg;
  let transfer;
  try {
    transfer=leg.provider_id ? await provider(`internal-transfers/${encodeURIComponent(leg.provider_id)}`) : await provider('internal-transfers',{
      method:'POST',headers:{'Idempotency-Key':leg.request_key},body:JSON.stringify({
        amount:{currency:'SLE',value:Number(leg.amount_minor)},sourceFinancialAccount:{id:leg.source_account},destinationFinancialAccount:{id:leg.destination_account},
        description:`MatMove merchant ${kind} ${id}`,metadata:{merchantPaymentId:id,leg:kind,requestKey:leg.request_key}
      })
    });
  } catch(error) {
    if(leg.can_create) await rpc(db,'matmove_record_merchant_leg',{p_id:id,p_kind:kind,p_provider_id:null,p_status:'review_required',p_error:'Provider response uncertain. Verify receipts before retrying.'});
    throw error;
  }
  const matches=typeof transfer?.id==='string'&&transfer.id.length>0&&(!leg.provider_id||transfer.id===leg.provider_id)
    &&transfer.amount?.currency==='SLE'&&transfer.amount?.value===Number(leg.amount_minor)
    &&transfer.sourceFinancialAccount?.id===leg.source_account&&transfer.destinationFinancialAccount?.id===leg.destination_account
    &&['pending','processing','completed','failed'].includes(transfer.status);
  if(!matches) return rpc(db,'matmove_record_merchant_leg',{p_id:id,p_kind:kind,p_provider_id:leg.provider_id||null,p_status:'review_required',p_error:'Provider receipt does not match this merchant payment.'});
  return rpc(db,'matmove_record_merchant_leg',{p_id:id,p_kind:kind,p_provider_id:transfer.id,p_status:transfer.status,p_error:transfer.failureDetail?.message||null});
}
export async function reconcileMerchantPayment(db,id,provider=monime) {
  let payment=await read(db,id);
  if(final(payment.state)) return payment;
  if(payment.state==='holding') { await runMerchantLeg(db,id,'hold',provider); payment=await read(db,id); }
  if(payment.state==='merchant_pending') { await runMerchantLeg(db,id,'merchant',provider); payment=await read(db,id); }
  return payment;
}
async function respond(db,res,payment) {
  const {data,error}=await db.from('matmove_merchant_payment_legs').select('*').eq('payment_id',payment.id);
  if(error) throw new HttpError(503,'Unable to load transfer receipts. Check this same payment again.');
  return res.status(payment.state==='completed'?200:202).json({ payment:{
    id:payment.id,state:payment.state,error:payment.error,items:payment.items,
    productMinor:Number(payment.product_minor),deliveryMinor:Number(payment.delivery_minor),feeMinor:Number(payment.fee_minor),totalMinor:Number(payment.total_minor),
    deliveryState:payment.delivery_state,escrowAccount:payment.escrow_account,merchantAccount:payment.merchant_account,
    phone:payment.phone,address:payment.address,receipts:(data||[]).map(x=>({kind:x.kind,id:x.provider_id,status:x.status,amountMinor:Number(x.amount_minor)}))
  }});
}
async function processMerchantPayment(req,res,{provider=monime,verifyAccount=verifiedAccount}={}) {
  const {db,user,profile,wallets}=req.matmove;
  if(profile.role!=='rider') throw new HttpError(403,'Rider checkout required.');
  const action=req.body.action;
  if(action==='merchant_status') {
    if(!uuid.test(String(req.body.paymentId))) throw new HttpError(400,'Valid payment reference required.');
    const old=await read(db,req.body.paymentId);
    if(old.rider_id!==user.id) throw new HttpError(403,'This payment belongs to another rider.');
    return respond(db,res,await reconcileMerchantPayment(db,old.id,provider));
  }
  if(!['merchant_quote','merchant_submit'].includes(action)) throw new HttpError(400,'Invalid merchant checkout action.');
  const input=payload(req.body);
  const key=keyFor(user.id,'merchant',req.body.idempotencyKey);
  if(action==='merchant_submit') {
    const {data:old,error}=await db.from('matmove_merchant_payments').select('*').eq('request_key',key).maybeSingle();
    if(error) throw new HttpError(503,'Run MERCHANT_PAYMENTS_SETUP.sql before paying merchants.');
    if(old) {
      if(old.rider_id!==user.id||old.payload_hash!==input.hash) throw new HttpError(409,'Request key belongs to a different checkout.');
      return respond(db,res,await reconcileMerchantPayment(db,old.id,provider));
    }
  }
  assertAllowed(profile,wallets,'purchase');
  const {data:products,error}=await db.from('products').select('*').in('id',input.items.map(x=>x.productId));
  if(error||products?.length!==input.items.length) throw new HttpError(409,'Some products are no longer available.');
  if(products.some(p=>p.is_available===false))throw new HttpError(409,'A selected product is sold. Remove it and review your cart.');
  if(products.some(p=>(p.currency??'SLE')!=='SLE'))throw new HttpError(409,'USD-priced products do not support SLE wallet checkout. No currency conversion has been applied.');
  const merchants=[...new Set(products.map(x=>x.merchant_id))];
  if(merchants.length!==1) throw new HttpError(400,'Pay one merchant per checkout. Select a merchant in your cart.');
  const merchantId=merchants[0];
  if(merchantId===user.id) throw new HttpError(400,'You cannot pay your own merchant account.');
  const items=input.items.map(x=>{ const p=products.find(p=>p.id===x.productId); return {...x,name:p.name,unitMinor:toMinorUnits(p.price)}; });
  const amounts=merchantFees(items.reduce((n,x)=>n+x.unitMinor*x.quantity,0),input.delivery);
  const customerWallets=wallets.filter(x=>x.currency==='SLE');
  if(customerWallets.length!==1) throw new HttpError(409,'A unique SLE rider wallet is required.');
  const [source,merchant]=await Promise.all([verifyAccount(db,customerWallets[0]),customerAccount(db,merchantId,'merchant',verifyAccount)]);
  const escrowId=process.env.MONIME_ESCROW_ACCOUNT_ID;
  if(!/^fac-[A-Za-z0-9_-]+$/.test(String(escrowId))) throw new HttpError(503,'Configure MONIME_ESCROW_ACCOUNT_ID.');
  const escrow=await provider(`financial-accounts/${encodeURIComponent(escrowId)}?withBalance=true`);
  if(escrow.id!==escrowId||escrow.currency!=='SLE'||[source.id,merchant.id].includes(escrowId)||source.id===merchant.id) throw new HttpError(409,'Escrow and customer accounts must be distinct SLE accounts.');
  if(source.balance?.available?.currency!=='SLE'||!Number.isSafeInteger(source.balance.available.value)||source.balance.available.value<0) throw new HttpError(503,'Available wallet balance could not be verified.');
  const quote={...amounts,items,availableMinor:source.balance.available.value,affordable:source.balance.available.value>=amounts.totalMinor,merchantId,escrowAccount:escrowId};
  if(action==='merchant_quote') return res.status(200).json({quote});
  if(req.body.acceptedTotalMinor!==amounts.totalMinor) throw new HttpError(409,'Prices or fees changed. Review the checkout again.');
  if(!quote.affordable) throw new HttpError(409,'Insufficient balance for products, delivery and payment fee.');
  const payment=await rpc(db,'matmove_prepare_merchant_payment',{
    p_key:key,p_payload_hash:input.hash,p_rider:user.id,p_merchant:merchantId,p_source:source.id,p_destination:merchant.id,p_escrow:escrowId,p_items:items,
    p_product:amounts.productMinor,p_delivery:amounts.deliveryMinor,p_fee:amounts.feeMinor,p_total:amounts.totalMinor,p_phone:input.phone,p_address:input.delivery?'Freetown - '+input.address:input.address
  });
  return respond(db,res,await reconcileMerchantPayment(db,payment.id,provider));
}

export async function merchantPaymentAction(req,res,options) {
  try { return await processMerchantPayment(req,res,options); }
  catch(error) {
    // Only unlock a rejected draft after proving no durable payment exists.
    if(req.body.action==='merchant_submit' && [400,403,409,423].includes(error.status)) {
      try {
        const key=keyFor(req.matmove.user.id,'merchant',req.body.idempotencyKey);
        const result=await req.matmove.db.from('matmove_merchant_payments').select('id').eq('request_key',key).maybeSingle();
        if(!result.error&&!result.data) error.code='MERCHANT_PAYMENT_NOT_STARTED';
      } catch { /* Keep the request locked whenever storage cannot be verified. */ }
    }
    throw error;
  }
}

export async function reconcileMerchantPayments(req,res,{dbFactory=dbClient,provider=monime}={}) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed.'});
  const secret=process.env.CRON_SECRET;
  const actual=String(req.headers.authorization||'');
  const expected=secret ? `Bearer ${secret}` : '';
  if(!secret||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) return res.status(401).json({error:'Unauthorized scheduler.'});
  try {
    const db=dbFactory();
    const {data,error}=await db.from('matmove_merchant_payments').select('id').in('state',['holding','merchant_pending']).order('updated_at',{ascending:true}).limit(5);
    if(error) throw error;
    let checked=0,failed=0;
    for(const row of data||[]) {
      try {
        await db.from('matmove_merchant_payments').update({updated_at:new Date().toISOString()}).eq('id',row.id);
        await reconcileMerchantPayment(db,row.id,provider); checked++;
      } catch(error) { failed++;console.error('Merchant payment reconciliation failed',{paymentId:row.id,message:error.message}); }
    }
    return res.status(200).json({checked,failed});
  } catch { return res.status(503).json({error:'Merchant payment reconciliation unavailable.'}); }
}
