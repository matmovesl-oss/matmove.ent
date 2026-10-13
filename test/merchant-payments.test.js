
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { merchantFees, reconcileMerchantPayment, merchantPaymentAction, reconcileMerchantPayments } from '../server/merchant-payments.js';
const rider='11111111-1111-4111-8111-111111111111';
const merchant='22222222-2222-4222-8222-222222222222';
const product='33333333-3333-4333-8333-333333333333';
const wallet='44444444-4444-4444-8444-444444444444';
const merchantWallet='55555555-5555-4555-8555-555555555555';
const items=[{productId:product,quantity:1,name:'Rice',unitMinor:10000}];
async function fixture() {
 const pg=new PGlite();
 await pg.exec(`create role anon; create role authenticated; create role service_role; create role supabase_admin;
 create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false);
 create table wallets(id uuid primary key,user_id uuid,currency text,monime_account_id text,metadata jsonb default '{}',is_frozen boolean default false);
 create table products(id uuid primary key,merchant_id uuid,name text,price numeric);
 create table app_orders(id uuid primary key default gen_random_uuid(),rider_id uuid,merchant_id uuid,product_name text,price numeric,quantity integer,delivery_location text,customer_phone text,status text);
 insert into profiles values('${rider}','rider','pending',false),('${merchant}','merchant','approved',false);
 insert into wallets(id,user_id,currency,monime_account_id) values('${wallet}','${rider}','SLE','fac-rider'),('${merchantWallet}','${merchant}','SLE','fac-merchant');
 insert into products values('${product}','${merchant}','Rice',100);`);
 await pg.exec(await readFile(new URL('../docs/MERCHANT_PAYMENTS_SETUP.sql',import.meta.url),'utf8'));
 const db={
  rpc:async(name,args)=>{try {const values=Object.values(args).map(v=>Array.isArray(v) ? JSON.stringify(v) : v);const query=`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) as data`;const r=await pg.query(query,values);return {data:r.rows[0].data,error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}},
  from:table=>{
   const conditions=[]; const values=[];
   const run=async single=>{const r=await pg.query(`select * from public.${table}${conditions.length?' where '+conditions.join(' and '):''}`,values);return {data:single?r.rows[0]||null:r.rows,error:null};};
   const chain={select:()=>chain,eq:(col,value)=>{values.push(value);conditions.push(`${col}=$${values.length}`);return chain;},in:(col,list)=>{const names=list.map(value=>{values.push(value);return '$'+values.length;});conditions.push(`${col} in (${names.join(',')})`);return chain;},maybeSingle:()=>run(true),single:()=>run(true),then:(resolve,reject)=>run(false).then(resolve,reject)};
   return chain;
  }
 };
 async function prepare(delivery=false,key='a'.repeat(64),amountItems=items) {
  const f=merchantFees(10000,delivery);
  return db.rpc('matmove_prepare_merchant_payment',{p_key:key,p_payload_hash:'b'.repeat(64),p_rider:rider,p_merchant:merchant,p_source:'fac-rider',p_destination:'fac-merchant',p_escrow:'fac-escrow',p_items:JSON.stringify(amountItems),p_product:f.productMinor,p_delivery:f.deliveryMinor,p_fee:f.feeMinor,p_total:f.totalMinor,p_phone:'+23277123456',p_address:delivery?'Freetown - Signal Hill':'Product only — pickup arranged with merchant'});
 }
 const counts={post:0,get:0}; let transferStatus='completed'; let mismatch=false;
 const transfers=new Map();
 const provider=async(path,options)=>{
  if(options?.method==='POST') {
   counts.post++; const body=JSON.parse(options.body); const id='trn-'+counts.post;
   const t={id,...body,status:transferStatus}; if(mismatch)t.amount={currency:'SLE',value:1};transfers.set(id,t);return t;
  }
  counts.get++;const t=transfers.get(path.split('/').pop());return {...t,status:transferStatus};
 };
 return {pg,db,prepare,provider,counts,setStatus:v=>transferStatus=v,setMismatch:v=>mismatch=v};
}
test('1% fee and optional SLE 50 delivery use integer cents',()=>{
 assert.deepEqual(merchantFees(10000,false),{productMinor:10000,deliveryMinor:0,feeMinor:100,totalMinor:10100});
 assert.deepEqual(merchantFees(10000,true),{productMinor:10000,deliveryMinor:5000,feeMinor:150,totalMinor:15150});
 assert.equal(merchantFees(49,false).feeMinor,0);assert.equal(merchantFees(50,false).feeMinor,1);
 assert.throws(()=>merchantFees(1.1,false));assert.throws(()=>merchantFees(100,'yes'));
});
test('product-only checkout credits merchant once and retains only fee',async()=>{
 const f=await fixture();try{const p=await f.prepare();assert.equal(p.error,null);
 const result=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(result.state,'completed');assert.equal(result.delivery_state,'not_requested');assert.equal(f.counts.post,2);
 const legs=(await f.pg.query('select * from matmove_merchant_payment_legs order by kind')).rows;
 assert.equal(Number(legs[0].amount_minor),10100);assert.equal(legs[0].destination_account,'fac-escrow');assert.equal(Number(legs[1].amount_minor),10000);assert.equal(legs[1].destination_account,'fac-merchant');
 const orders=(await f.pg.query('select * from app_orders')).rows;assert.equal(orders.length,1);assert.equal(orders[0].wallet_payment_status,'paid');assert.equal(Number(orders[0].price),100);
 await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(f.counts.post,2);assert.equal((await f.pg.query('select count(*) n from app_orders')).rows[0].n,1);
 }finally{await f.pg.close();}
});
test('delivery funds and payment fee stay in escrow; merchant receives products only',async()=>{
 const f=await fixture();try{const p=await f.prepare(true);const result=await reconcileMerchantPayment(f.db,p.data.id,f.provider);
 assert.equal(result.state,'completed');assert.equal(result.delivery_state,'funded');assert.equal(Number(result.delivery_minor),5000);assert.equal(Number(result.fee_minor),150);
 const legs=(await f.pg.query('select * from matmove_merchant_payment_legs order by kind')).rows;assert.equal(Number(legs[0].amount_minor)-Number(legs[1].amount_minor),5150);
 }finally{await f.pg.close();}
});
test('pending hold polls its receipt before sending merchant credit',async()=>{
 const f=await fixture();try{const p=await f.prepare();f.setStatus('processing');await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(f.counts.post,1);assert.equal((await f.pg.query('select count(*) n from app_orders')).rows[0].n,0);
 f.setStatus('completed');const r=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(r.state,'completed');assert.equal(f.counts.post,2);assert.equal(f.counts.get,1);
 }finally{await f.pg.close();}
});
test('provider receipt mismatch stops checkout without merchant credit',async()=>{
 const f=await fixture();try{const p=await f.prepare();f.setMismatch(true);const r=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');assert.equal(f.counts.post,1);assert.equal((await f.pg.query('select count(*) n from app_orders')).rows[0].n,0);
 }finally{await f.pg.close();}
});
test('lost POST response is not retried',async()=>{
 const f=await fixture();try{const p=await f.prepare();let posts=0;
 await assert.rejects(reconcileMerchantPayment(f.db,p.data.id,async()=>{posts++;throw new Error('timeout');}));
 const r=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');assert.equal(posts,1);assert.equal(f.counts.post,0);
 }finally{await f.pg.close();}
});
test('same request key returns original checkout and rejects changed payload',async()=>{
 const f=await fixture();try{const a=await f.prepare();const b=await f.prepare();assert.equal(a.data.id,b.data.id);
 const r=await f.pg.query("select matmove_prepare_merchant_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) x",['a'.repeat(64),'c'.repeat(64),rider,merchant,'fac-rider','fac-merchant','fac-escrow',JSON.stringify(items),10000,0,100,10100,'+23277123456','Pickup']).then(()=>null,e=>e);assert.match(r.message,/Request key/);
 }finally{await f.pg.close();}
});
test('changed product price cannot be charged from a stale quote',async()=>{
 const f=await fixture();try{await f.pg.exec('update products set price=101');const p=await f.prepare();assert.match(p.error.message,/Product price changed/);assert.equal((await f.pg.query('select count(*) n from matmove_merchant_payments')).rows[0].n,0);
 }finally{await f.pg.close();}
});
test('freeze before initial debit prevents provider calls',async()=>{
 const f=await fixture();try{const p=await f.prepare();await f.pg.exec(`update wallets set is_frozen=true where user_id='${rider}'`);const r=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(r.state,'failed');assert.equal(f.counts.post,0);
 }finally{await f.pg.close();}
});
test('freeze after hold leaves funds in escrow for review',async()=>{
 const f=await fixture();try{const p=await f.prepare();f.setStatus('processing');await reconcileMerchantPayment(f.db,p.data.id,f.provider);await f.pg.exec(`update wallets set is_frozen=true where user_id='${merchant}'`);f.setStatus('completed');const r=await reconcileMerchantPayment(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');assert.equal(f.counts.post,1);
 }finally{await f.pg.close();}
});
test('browser roles cannot execute money RPCs or forge paid order receipts',async()=>{
 const f=await fixture();try{await f.pg.exec('grant usage on schema public to authenticated; grant insert,update,select on app_orders to authenticated; set role authenticated;');
 await assert.rejects(f.pg.query('select matmove_claim_merchant_leg($1,$2)',[rider,'hold']),/permission denied/);
 await assert.rejects(f.pg.query("insert into app_orders(wallet_payment_status) values('paid')"),/server authorization/);
 }finally{await f.pg.close();}
});

function response() { return { status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){} }; }
async function apiFixture() {
 const f=await fixture();
 const profile={id:rider,role:'rider',is_wallet_frozen:false};
 const wallets=[{id:wallet,user_id:rider,currency:'SLE',monime_account_id:'fac-rider'}];
 let available=100000; process.env.MONIME_ESCROW_ACCOUNT_ID='fac-escrow';
 const verifyAccount=async(db,w)=>({id:w.monime_account_id,currency:'SLE',balance:{available:{currency:'SLE',value:available}}});
 const provider=async(path,options)=>path.startsWith('financial-accounts/') ? {id:'fac-escrow',currency:'SLE'} : f.provider(path,options);
 const body={action:'merchant_submit',items:[{productId:product,quantity:1}],delivery:false,phone:'077123456',city:'Freetown',address:'',acceptedTotalMinor:10100,idempotencyKey:'66666666-6666-4666-8666-666666666666'};
 const invoke=async(extra={})=>{const res=response();await merchantPaymentAction({body:{...body,...extra},matmove:{db:f.db,user:{id:rider},profile,wallets}},res,{provider,verifyAccount});return res;};
 return {...f,invoke,profile,setAvailable:value=>available=value};
}
test('quote is read-only and source balance must cover all fees',async()=>{
 const f=await apiFixture();try{const quote=await f.invoke({action:'merchant_quote'});assert.equal(quote.body.quote.totalMinor,10100);assert.equal(f.counts.post,0);assert.equal((await f.pg.query('select count(*) n from matmove_merchant_payments')).rows[0].n,0);
 f.setAvailable(10000);await assert.rejects(f.invoke(),e=>e.status===409&&e.code==='MERCHANT_PAYMENT_NOT_STARTED');assert.equal(f.counts.post,0);
 }finally{await f.pg.close();}
});
test('API submit uses server prices and duplicate submissions reuse receipts',async()=>{
 const f=await apiFixture();try{const a=await f.invoke({price:1,merchantId:rider,recipientAccountId:'fac-attacker',feeMinor:0});assert.equal(a.body.payment.state,'completed');assert.equal(a.body.payment.productMinor,10000);assert.equal(a.body.payment.feeMinor,100);
 const b=await f.invoke();assert.equal(a.body.payment.id,b.body.payment.id);assert.equal(f.counts.post,2);
 }finally{await f.pg.close();}
});
test('API rejects changed accepted total and clears only an unstarted draft',async()=>{
 const f=await apiFixture();try{await assert.rejects(f.invoke({acceptedTotalMinor:10000}),e=>e.status===409&&e.code==='MERCHANT_PAYMENT_NOT_STARTED');assert.equal(f.counts.post,0);
 await f.invoke();await assert.rejects(f.invoke({items:[{productId:product,quantity:2}]}),e=>e.status===409&&e.code!=='MERCHANT_PAYMENT_NOT_STARTED');assert.equal(f.counts.post,2);
 }finally{await f.pg.close();}
});
test('API checks merchant approval, rider freeze and delivery area',async()=>{
 const f=await apiFixture();try{await f.pg.exec(`update profiles set kyc_status='pending' where id='${merchant}'`);await assert.rejects(f.invoke(),/approval/);assert.equal(f.counts.post,0);
 await f.pg.exec(`update profiles set kyc_status='approved' where id='${merchant}'`);f.profile.is_wallet_frozen=true;await assert.rejects(f.invoke(),/frozen/);f.profile.is_wallet_frozen=false;
 await assert.rejects(f.invoke({delivery:true,city:'Bo',address:'Main Road',acceptedTotalMinor:15150}),/Freetown/);assert.equal(f.counts.post,0);
 }finally{await f.pg.close();}
});
test('API status forbids another rider from accessing payment',async()=>{
 const f=await apiFixture();try{const a=await f.invoke();const other='77777777-7777-4777-8777-777777777777';await f.pg.query("insert into profiles(id,role) values($1,'rider')",[other]);await f.pg.query('update matmove_merchant_payments set rider_id=$1 where id=$2',[other,a.body.payment.id]);await assert.rejects(f.invoke({action:'merchant_status',paymentId:a.body.payment.id}),/another rider/);assert.equal(f.counts.post,2);
 }finally{await f.pg.close();}
});
test('two claim attempts authorize one provider POST',async()=>{
 const f=await fixture();try{const p=await f.prepare();const a=await f.db.rpc('matmove_claim_merchant_leg',{p_id:p.data.id,p_kind:'hold'});const b=await f.db.rpc('matmove_claim_merchant_leg',{p_id:p.data.id,p_kind:'hold'});assert.equal(a.data.can_create,true);assert.equal(b.data.can_create,false);
 }finally{await f.pg.close();}
});
test('background reconciliation rejects customer tokens and POST',async()=>{
 const old=process.env.CRON_SECRET;process.env.CRON_SECRET='scheduler-secret';
 try {const a=response();await reconcileMerchantPayments({method:'GET',headers:{authorization:'Bearer customer-token'}},a);assert.equal(a.code,401);
 const b=response();await reconcileMerchantPayments({method:'POST',headers:{authorization:'Bearer scheduler-secret'}},b);assert.equal(b.code,405);
 }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});
