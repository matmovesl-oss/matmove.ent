
import test from 'node:test';
import assert from 'node:assert/strict';
import {closePaymentCodeHandler} from '../api/create-wallet-payment-code.js';
import {publicPaymentCode} from '../server/payment-code.js';
const user='11111111-1111-4111-8111-111111111111';
const context={user:{id:user},wallets:[{currency:'SLE',monime_account_id:'fac-user'}]};
const code={id:'code-one',mode:'one_time',enable:true,status:'pending',financialAccountId:'fac-user',amount:{currency:'SLE',value:500},metadata:{purpose:'wallet_topup',matmoveUserId:user},ussdCode:'*715*123#',expireTime:new Date(Date.now()+600000).toISOString()};
const req={matmove:context,body:{operation:'close',paymentCodeId:code.id}};
const response=()=>({status(n){this.code=n;return this;},json(value){this.body=value;return this;}});

test('Close verifies ownership, disables only the requested unused code, and retains its receipt',async()=>{
 const calls=[],res=response();let current={...code};
 const provider=async(path,options)=>{calls.push({path,options});if(options){assert.equal(options.method,'PATCH');assert.deepEqual(JSON.parse(options.body),{enable:false});current={...current,enable:false,ussdCode:null,expireTime:null};}return current;};
 await closePaymentCodeHandler(req,res,{provider});
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.path==='payment-codes/code-one'));
 assert.equal(res.body.paymentCode.closed,true);assert.equal(res.body.paymentCode.ussdCode,null);assert.equal(res.body.paymentCode.confirmed,false);
 await closePaymentCodeHandler(req,response(),{provider});assert.equal(calls.filter(c=>c.options).length,1);
});

test('Completed and processing payments are never patched or reported as cancelled',async()=>{
 for(const status of ['completed','processing']){
  const calls=[],res=response();const provider=async(path,options)=>{calls.push({path,options});if(path.startsWith('payments?'))return[];return{...code,status};};
  await closePaymentCodeHandler(req,res,{provider});assert.equal(calls.filter(c=>c.options).length,0);
  assert.equal(res.body.paymentCode.status,status);assert.equal(res.body.paymentCode.closed,status==='completed');assert.equal(res.body.paymentCode.confirmed,status==='completed');
 }
});

test('A lost disable response is recovered with GET and never creates another payment code',async()=>{
 const calls=[],res=response();let disabled=false;
 const provider=async(path,options)=>{calls.push({path,method:options?.method||'GET'});if(options){disabled=true;throw Error('response lost');}return{...code,enable:!disabled};};
 await closePaymentCodeHandler(req,res,{provider});assert.equal(res.body.paymentCode.closed,true);
 assert.deepEqual(calls.map(c=>c.method),['GET','PATCH','GET']);assert.ok(calls.every(c=>c.path==='payment-codes/code-one'));
});

test('Failed cancellation and a concurrent processing result remain open for recovery',async()=>{
 await assert.rejects(()=>closePaymentCodeHandler(req,response(),{provider:async(_,options)=>options?{...code,enable:true}:code}),/not confirmed/);
 const res=response();await closePaymentCodeHandler(req,res,{provider:async(_,options)=>options?{...code,status:'processing',enable:false}:code});
 assert.equal(res.body.paymentCode.closed,false);assert.equal(res.body.paymentCode.status,'processing');
});

test('Another user, an unrelated wallet, changed receipts and invalid code IDs fail before an unsafe close',async()=>{
 for(const foreign of [{...code,metadata:{...code.metadata,matmoveUserId:'other'}},{...code,financialAccountId:'fac-other'},{...code,id:'different-code'}]){
  let patches=0;await assert.rejects(()=>closePaymentCodeHandler(req,response(),{provider:async(_,options)=>{if(options)patches++;return foreign;}}));assert.equal(patches,0);
 }
 await assert.rejects(()=>closePaymentCodeHandler(req,response(),{provider:async(_,options)=>options?{...code,enable:false,amount:{currency:'SLE',value:900}}:code}),/does not match/);
 let calls=0;await assert.rejects(()=>closePaymentCodeHandler({...req,body:{paymentCodeId:'../other'}},response(),{provider:async()=>{calls++;}}));assert.equal(calls,0);
 assert.equal(publicPaymentCode({...code,status:'processing',enable:false},context).closed,false);
});
