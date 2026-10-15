

import test from 'node:test';
import assert from 'node:assert/strict';
import { topupQuote } from '../server/topup-fees.js';
import { publicPaymentCode, topupSettlement, encodeTopupQuote, decodeTopupQuote } from '../server/payment-code.js';
import { createPaymentCodeHandler, getPaymentCodeHandler } from '../api/create-wallet-payment-code.js';
const user='11111111-1111-4111-8111-111111111111';
const context={user:{id:user},accountId:'fac-user',minor:500,idempotencyKey:'a'.repeat(64),wallets:[{currency:'SLE',monime_account_id:'fac-user'}]};
const code={id:'code-test',mode:'one_time',financialAccountId:'fac-user',amount:{currency:'SLE',value:500},metadata:{matmoveUserId:user,purpose:'wallet_topup'},ussdCode:'*715*123#',expireTime:'2026-10-15T02:00:00Z',status:'pending'};
const res=()=>({status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
const configured=c=>({MATMOVE_TOPUP_NET_ENABLED:'true',MONIME_TOPUP_FEE_CONFIG:JSON.stringify({confirmed:true,rateBps:0,fixedMinor:50,minimumMinor:0,taxBps:0,rounding:'ceil',...c})});
test('no collection fee is guessed; legacy mode explicitly leaves net unknown',()=>{
 assert.deepEqual(topupQuote(500,{}),{netMode:false,requestedMinor:500,walletCreditMinor:null,feeMinor:null,totalMinor:500,version:'legacy-gross'});
 assert.throws(()=>topupQuote(500,{MATMOVE_TOPUP_NET_ENABLED:'true'}),/confirmed/);
 assert.throws(()=>topupQuote(500,configured({confirmed:false})),/confirmed/);
});
test('confirmed fixed and percentage schedules gross up the mobile payment using integer cents',()=>{
 const fixed=topupQuote(500,configured({}));assert.equal(fixed.totalMinor,550);assert.equal(fixed.walletCreditMinor,500);assert.equal(fixed.feeMinor,50);
 const env=configured({rateBps:150,fixedMinor:0,taxBps:1500});
 for(let net=1;net<20000;net+=17){const q=topupQuote(net,env);const base=Math.ceil(q.totalMinor*150/10000),fee=base+Math.ceil(base*1500/10000);assert.equal(q.totalMinor-fee,net);}
});
test('bad fees and invalid requested amounts fail before collecting',()=>{
 for(const value of [0,-1,1.5,NaN,Infinity,1000000001])assert.throws(()=>topupQuote(value,{}));
 for(const changes of [{rateBps:5001},{minimumMinor:-1},{rounding:'guess'}])assert.throws(()=>topupQuote(500,configured(changes)));
});
test('create is one-time, provider supplied USSD, user-owned destination and fresh logical request keys',async()=>{
 const original=process.env.MATMOVE_TOPUP_NET_ENABLED;process.env.MATMOVE_TOPUP_NET_ENABLED='false';const requests=[];
 try{const provider=async(path,opts)=>{requests.push({path,opts,body:JSON.parse(opts.body)});return {...code};};
 const a=res();await createPaymentCodeHandler({matmove:context,body:{}},a,{provider});
 const b=res();await createPaymentCodeHandler({matmove:{...context,idempotencyKey:'b'.repeat(64)},body:{}},b,{provider});
 assert.notEqual(requests[0].opts.headers['Idempotency-Key'],requests[1].opts.headers['Idempotency-Key']);assert.equal(requests[0].body.mode,'one_time');assert.equal(requests[0].body.financialAccountId,'fac-user');assert.equal(a.body.paymentCode.ussdCode,code.ussdCode);
 }finally{if(original===undefined)delete process.env.MATMOVE_TOPUP_NET_ENABLED;else process.env.MATMOVE_TOPUP_NET_ENABLED=original;}
});
test('same request reuses provider key and completed code requires matched original payment',async()=>{
 const original=process.env.MATMOVE_TOPUP_NET_ENABLED;process.env.MATMOVE_TOPUP_NET_ENABLED='false';const keys=[];
 try{const provider=async(_,opts)=>{keys.push(opts.headers['Idempotency-Key']);return code;};for(let i=0;i<2;i++)await createPaymentCodeHandler({matmove:context,body:{}},res(),{provider});assert.equal(keys[0],keys[1]);
 const complete={...code,status:'completed',processedPaymentData:{paymentId:'pay-test',amount:code.amount}};assert.equal(publicPaymentCode(complete,context).confirmed,true);assert.throws(()=>publicPaymentCode({...complete,processedPaymentData:{paymentId:'pay-test',amount:{currency:'SLE',value:450}}},context),/do not match/);
 const r=res();await getPaymentCodeHandler({matmove:context,body:{paymentCodeId:code.id}},r,{provider:async()=>complete});assert.equal(r.body.paymentCode.confirmed,true);
 }finally{if(original===undefined)delete process.env.MATMOVE_TOPUP_NET_ENABLED;else process.env.MATMOVE_TOPUP_NET_ENABLED=original;}
});
test('cross-user and tampered fee receipts are rejected',()=>{
 assert.throws(()=>publicPaymentCode({...code,financialAccountId:'fac-other'},context),/belong/);
 assert.throws(()=>publicPaymentCode({...code,metadata:{...code.metadata,matmoveTopupQuote:JSON.stringify({netMode:true,walletCreditMinor:500,feeMinor:50,totalMinor:500})}},context),/does not match/);
});
test('exact-credit collection charges accepted gross, preserves quoted credit, and rejects changed totals before any POST',async()=>{
 const original={enabled:process.env.MATMOVE_TOPUP_NET_ENABLED,config:process.env.MONIME_TOPUP_FEE_CONFIG};const env=configured({});process.env.MATMOVE_TOPUP_NET_ENABLED=env.MATMOVE_TOPUP_NET_ENABLED;process.env.MONIME_TOPUP_FEE_CONFIG=env.MONIME_TOPUP_FEE_CONFIG;
 let posts=0;
 try{const q=topupQuote(500);const provider=async(_,opts)=>{posts++;const body=JSON.parse(opts.body);return {...code,amount:body.amount,metadata:body.metadata};};
 await assert.rejects(()=>createPaymentCodeHandler({matmove:context,body:{acceptedTotalMinor:500,quoteVersion:q.version}},res(),{provider}),/Review/);assert.equal(posts,0);
 const response=res();await createPaymentCodeHandler({matmove:context,body:{acceptedTotalMinor:550,quoteVersion:q.version}},response,{provider});assert.equal(posts,1);assert.equal(response.body.paymentCode.amount.value,550);assert.equal(response.body.paymentCode.quote.walletCreditMinor,500);
 }finally{for(const [key,value] of [['MATMOVE_TOPUP_NET_ENABLED',original.enabled],['MONIME_TOPUP_FEE_CONFIG',original.config]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('REGRESSION: normal GET completed response without webhook-only data clears the terminal payment',async()=>{
 const completed={...code,status:'completed',ussdCode:null,expireTime:null};
 const publicCode=publicPaymentCode(completed,context);assert.equal(publicCode.confirmed,true);assert.equal(publicCode.ussdCode,null);
 const calls=[];const provider=async path=>{calls.push(path);if(path.startsWith('payment-codes/'))return completed;return [];};
 const r=res();await getPaymentCodeHandler({matmove:context,body:{paymentCodeId:code.id}},r,{provider});
 assert.equal(r.body.paymentCode.status,'completed');assert.equal(r.body.paymentCode.confirmed,true);assert.equal(r.body.paymentCode.settlement,null);assert.equal(calls.length,2);
});
test('completed receipt lookup failure never turns a completed code back into processing',async()=>{
 const r=res();await getPaymentCodeHandler({matmove:context,body:{paymentCodeId:code.id}},r,{provider:async path=>{if(path.startsWith('payment-codes/'))return {...code,status:'completed'};throw new Error('Ledger delayed');}});assert.equal(r.body.paymentCode.confirmed,true);assert.equal(r.body.paymentCode.settlement,null);
});
test('actual net settlement matches the code owner, account, amount and reference, never another equal-sized payment',async()=>{
 const c={...code,status:'completed',reference:'unique-reference'};
 const receipt={id:'pay-match',status:'completed',reference:c.reference,financialAccountId:c.financialAccountId,amount:c.amount,fees:[{code:'base',amount:{currency:'SLE',value:5}}]};
 const actual=await topupSettlement(c,async()=>[{...receipt,id:'pay-other',reference:'different-reference'},receipt]);assert.deepEqual(actual,{paymentId:'pay-match',feeMinor:5,creditMinor:495});
 assert.equal(await topupSettlement(c,async()=>[{...receipt,financialAccountId:'fac-other'}]),null);
 assert.equal(await topupSettlement(c,async()=>[receipt,{...receipt,id:'pay-second'}]),null);
 assert.equal(await topupSettlement(c,async()=>[{...receipt,fees:undefined}]),null);
 assert.equal(await topupSettlement(c,async()=>[{...receipt,fees:[{amount:{currency:'USD',value:5}}]}]),null);
});
test('1% gross-up covers the exported receiving-side deduction for SLE2 and SLE5',()=>{
 const env=configured({rateBps:100,fixedMinor:0,minimumMinor:0,taxBps:0,rounding:'nearest'});
 assert.deepEqual([200,500,10000].map(n=>{const q=topupQuote(n,env);return [q.walletCreditMinor,q.feeMinor,q.totalMinor];}),[[200,2,202],[500,5,505],[10000,101,10101]]);
 // Alternative provider rounding remains configurable, rather than baked into the UI.
 assert.equal(topupQuote(200,configured({rateBps:100,fixedMinor:0,rounding:'ceil'})).totalMinor,203);
});
test('automatic payout quotes are read-only for rider, driver and merchant; payout fees stay SLE101.58 per SLE100',async()=>{
 const {payoutAction,payoutFees}=await import('../server/payout-payments.js');assert.equal(payoutFees(10000).totalMinor,10158);
 const previous=process.env.MONIME_ESCROW_ACCOUNT_ID;process.env.MONIME_ESCROW_ACCOUNT_ID='fac-escrow';let balanceReads=0;
 try{
 for(const role of ['rider','driver','merchant']){
  const r=res();await payoutAction({body:{action:'quote',amount:'3',currency:'SLE',destinationPhone:'099123456',networkProvider:'afrimoney',idempotencyKey:'11111111-1111-4111-8111-111111111111'},matmove:{db:{rpc(){throw new Error('Quote must not run a money RPC');},from(){throw new Error('Quote must not prepare a withdrawal');}},user:{id:user},profile:{role,kyc_status:'approved',is_wallet_frozen:false},wallets:[{id:'wallet',currency:'SLE',is_frozen:false}]}},r,{verifyAccount:async()=>({id:'fac-user',currency:'SLE',balance:{available:{currency:'SLE',value:10000}}}),provider:async(path,options)=>{assert.equal(options?.method,undefined);assert.match(path,/financial-accounts\/fac-escrow/);balanceReads++;return {id:'fac-escrow',currency:'SLE'};}});
  assert.equal(r.body.quote.totalMinor,305);assert.equal(r.body.quote.affordable,true);
 }
 assert.equal(balanceReads,3);
 }finally{if(previous===undefined)delete process.env.MONIME_ESCROW_ACCOUNT_ID;else process.env.MONIME_ESCROW_ACCOUNT_ID=previous;}
});


test('REGRESSION: exact-credit metadata stays within every Monime key and value limit', async () => {
 const original = {enabled: process.env.MATMOVE_TOPUP_NET_ENABLED, config: process.env.MONIME_TOPUP_FEE_CONFIG};
 const env = configured({rateBps:100,fixedMinor:0,rounding:'nearest'});
 process.env.MATMOVE_TOPUP_NET_ENABLED=env.MATMOVE_TOPUP_NET_ENABLED;
 process.env.MONIME_TOPUP_FEE_CONFIG=env.MONIME_TOPUP_FEE_CONFIG;
 try {
  for (const minor of [1,100,200,500,10000,1000000000]) {
   const quote = topupQuote(minor);
   // The previous JSON object caused the reported provider validation error.
   assert.ok(JSON.stringify(quote).length > 100);
   let posted;
   const response=res();
   await createPaymentCodeHandler({matmove:{...context,minor},body:{acceptedTotalMinor:quote.totalMinor,quoteVersion:quote.version}},response,{provider:async(path,options)=>{
    assert.equal(path,'payment-codes');posted=JSON.parse(options.body);
    assert.ok(Object.keys(posted.metadata).length<=64);
    for(const [key,value] of Object.entries(posted.metadata)) {
     assert.match(key,/^[a-zA-Z0-9_-]{1,64}$/);
     assert.equal(typeof value,'string');assert.ok(value.length<=100, `${key} too long`);
    }
    return {...code,amount:posted.amount,metadata:posted.metadata};
   }});
   assert.equal(posted.financialAccountId,'fac-user');
   assert.equal(posted.amount.value,quote.totalMinor);
   assert.deepEqual(response.body.paymentCode.quote,quote);
  }
 } finally {
  for(const [key,value] of [['MATMOVE_TOPUP_NET_ENABLED',original.enabled],['MONIME_TOPUP_FEE_CONFIG',original.config]])
   if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});

test('compact receipts round-trip and existing object receipts remain readable', () => {
 const quote=topupQuote(200,configured({rateBps:100,fixedMinor:0,rounding:'nearest'}));
 assert.deepEqual(decodeTopupQuote(encodeTopupQuote(quote),quote.totalMinor),quote);
 assert.deepEqual(publicPaymentCode({...code,amount:{currency:'SLE',value:quote.totalMinor},metadata:{...code.metadata,matmoveTopupQuote:JSON.stringify(quote)}},context).quote,quote);
 for(const stored of ['bad-json','[]','[2,200,2,202,"'+quote.version+'"]','[1,200,3,202,"'+quote.version+'"]','[1,200,2,202,"fake"]'])
  assert.throws(()=>decodeTopupQuote(stored,202),/receipt/);
 assert.throws(()=>decodeTopupQuote(encodeTopupQuote(quote),203),/does not match/);
 assert.throws(()=>encodeTopupQuote({...quote,feeMinor:-1}),/does not match/);
});

test('lost POST response keeps the same logical key and never automatically retries or switches payment account', async () => {
 const original={enabled:process.env.MATMOVE_TOPUP_NET_ENABLED,config:process.env.MONIME_TOPUP_FEE_CONFIG};
 const env=configured({rateBps:100,fixedMinor:0,rounding:'nearest'});
 process.env.MATMOVE_TOPUP_NET_ENABLED=env.MATMOVE_TOPUP_NET_ENABLED;
 process.env.MONIME_TOPUP_FEE_CONFIG=env.MONIME_TOPUP_FEE_CONFIG;
 try {
  const quote=topupQuote(context.minor);const keys=[];let receipt;
  const provider=async(path,options)=>{
   keys.push(options.headers['Idempotency-Key']);
   const body=JSON.parse(options.body);
   assert.equal(body.financialAccountId,context.accountId);
   if(!receipt){receipt={...code,amount:body.amount,metadata:body.metadata};throw new Error('Response lost after provider accepted code');}
   return receipt;
  };
  const req={matmove:context,body:{acceptedTotalMinor:quote.totalMinor,quoteVersion:quote.version}};
  await assert.rejects(()=>createPaymentCodeHandler(req,res(),{provider}),/Response lost/);
  assert.equal(keys.length,1);
  const response=res();await createPaymentCodeHandler(req,response,{provider});
  assert.deepEqual(keys,[context.idempotencyKey,context.idempotencyKey]);
  assert.equal(response.body.paymentCode.id,receipt.id);
 } finally {
  for(const [key,value] of [['MATMOVE_TOPUP_NET_ENABLED',original.enabled],['MONIME_TOPUP_FEE_CONFIG',original.config]])
   if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
