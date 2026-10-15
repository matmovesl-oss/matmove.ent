
import test from 'node:test';
import assert from 'node:assert/strict';
import { topupQuote } from '../server/topup-fees.js';
import { publicPaymentCode } from '../server/payment-code.js';
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
 const complete={...code,status:'completed',processedPaymentData:{paymentId:'pay-test',amount:code.amount}};assert.equal(publicPaymentCode(complete,context).confirmed,true);assert.equal(publicPaymentCode({...complete,processedPaymentData:{paymentId:'pay-test',amount:{currency:'SLE',value:450}}},context).confirmed,false);
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
