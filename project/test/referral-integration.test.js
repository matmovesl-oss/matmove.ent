
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createReferralApi,referralProvider} from '../server/referral-api.js';
import {processReferral,reconcileReferralBatch} from '../server/referral-payments.js';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const uuid=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const row=(n=1)=>({id:uuid(n),beneficiary_id:id,kind:'inviter',amount_minor:100,currency:'SLE',state:'pending',provider_id:null,created_at:'2026-10-27T10:00:00Z',source_account:'fac-private',destination_account:'fac-owned',request_key:uuid(80),new_user_id:other});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
function fixture(options={}){
 const reads=[],filters=[],calls=[];let created=0;
 const tables={profiles:{id,role:'rider'},user_roles:[{role:'rider'}],matmove_staff_access:null,matmove_referral_rewards:[row()],...options.tables};
 const db={auth:{getUser:async token=>{calls.push(['auth',token]);return options.auth||{data:{user:{id}},error:null};}},from(table){reads.push(table);const q={select(fields){filters.push({table,fields});return q;},eq(k,v){filters.push({table,k,v});return q;},order(){return q;},limit(n){filters.push({table,limit:n});return q;},maybeSingle:()=>Promise.resolve({data:tables[table],error:options.error===table?{}:null}),then(yes,no){return Promise.resolve({data:tables[table],error:options.error===table?{}:null}).then(yes,no);}};return q;}};
 const api=createReferralApi({database:()=>{created++;return db;},provider:()=>{throw Error('Status must never reach provider');},env:{CRON_SECRET:'server-only-test-secret'},reconcile:async(_db,opts)=>{calls.push(['reconcile',opts.env.CRON_SECRET]);return options.result||{checked:1,failed:0};}});
 const status=async patch=>{const res=response();await api.status({method:'POST',query:{},headers:{authorization:'Bearer customer-token'},body:{action:'referral_status',userId:id},...patch},res);return res;};
 const cron=async patch=>{const res=response();await api.reconcile({method:'GET',query:{action:'referral_reconcile'},headers:{authorization:'Bearer server-only-test-secret'},...patch},res);return res;};
 return {api,db,reads,filters,calls,status,cron,get created(){return created;}};
}
test('private status verifies the token and owner, returns only explicit owned display fields and makes no provider request',async()=>{
 const f=fixture(),r=await f.status();assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers.Vary,'Authorization');assert.equal(r.body.userId,id);assert.equal(r.body.hasMore,false);assert.deepEqual(Object.keys(r.body.rewards[0]).sort(),['id','kind','amountMinor','currency','state','createdAt'].sort());assert.equal(r.body.rewards[0].state,'pending');assert.equal(f.reads.includes('wallets'),false);assert.ok(f.filters.some(x=>x.table==='matmove_referral_rewards'&&x.k==='beneficiary_id'&&x.v===id));assert.doesNotMatch(JSON.stringify(r.body),/fac-|request_key|new_user_id|provider_id/);
});
test('missing authentication and cross-user requests cannot read reward history',async()=>{
 for(const patch of [{headers:{}},{body:{action:'referral_status',userId:other}}]){const f=fixture(),r=await f.status(patch);assert.ok([401,403].includes(r.code));assert.equal(f.reads.length,0);}
 const f=fixture({auth:{data:{user:null},error:{}}});assert.equal((await f.status()).code,401);assert.equal(f.reads.length,0);
});
test('customer status rejects GET, query actions, inherited or extra fields before database initialization',async()=>{
 for(const patch of [{method:'GET'},{query:{action:'referral_status'}},{body:{action:'referral_status',actor:other}},{body:Object.create({action:'referral_status'})},{body:[]}]){const f=fixture(),r=await f.status(patch);assert.ok([400,405].includes(r.code));assert.equal(f.created,0);}
});
test('staff, administrative memberships, role conflicts and missing profiles cannot read the customer endpoint',async()=>{
 for(const tables of [{matmove_staff_access:{id,is_active:true,removed_at:null}},{user_roles:[{role:'admin'}]},{profiles:{id,role:'driver'},user_roles:[{role:'rider'}]},{profiles:null}]){const f=fixture({tables});assert.equal((await f.status()).code,403);assert.equal(f.reads.includes('matmove_referral_rewards'),false);}
});
test('unverified and frozen customers can inspect their own reward status without any money eligibility bypass',async()=>{
 for(const role of ['rider','driver','merchant']){const f=fixture({tables:{profiles:{id,role,kyc_status:'pending',is_wallet_frozen:true},user_roles:[{role}]}});assert.equal((await f.status()).code,200);assert.equal(f.calls.some(c=>c[0]==='reconcile'),false);}
});
test('malformed, duplicate or cross-user rows fail the entire response; a completed reward needs a real provider ID',async()=>{
 for(const rows of [[{...row(),beneficiary_id:other}],[row(),row()],[{...row(),amount_minor:200}],[{...row(),state:'completed',provider_id:null}],[{...row(),created_at:'invalid'}]]){const f=fixture({tables:{matmove_referral_rewards:rows}}),r=await f.status();assert.equal(r.code,503);assert.equal(r.body.rewards,undefined);}
 const f=fixture({tables:{matmove_referral_rewards:[{...row(),state:'completed',provider_id:'trn-confirmed'}]}});assert.equal((await f.status()).body.rewards[0].state,'completed');
});
test('history explicitly reports truncation and a failed read never becomes an empty successful list',async()=>{
 const f=fixture({tables:{matmove_referral_rewards:Array.from({length:51},(_,i)=>row(i+1))}}),r=await f.status();assert.equal(r.body.rewards.length,50);assert.equal(r.body.hasMore,true);assert.ok(f.filters.some(x=>x.limit===51));
 const failed=fixture({error:'matmove_referral_rewards'});assert.equal((await failed.status()).code,503);
});
test('cron requires exact server secret and GET; customers, wrong same-length keys and duplicates never initialize storage',async()=>{
 for(const patch of [{method:'POST'},{headers:{}},{headers:{authorization:'Bearer customer-token'}},{headers:{authorization:'Bearer server-only-test-secreX'}},{query:{action:['referral_reconcile','arcade_draw']}},{query:{action:'referral_reconcile',userId:id}}]){const f=fixture(),r=await f.cron(patch);assert.ok([400,401,405].includes(r.code));assert.equal(f.created,0);assert.equal(f.calls.length,0);}
 const f=fixture(),r=await f.cron();assert.equal(r.code,200);assert.deepEqual(r.body,{checked:1,failed:0});assert.equal(f.calls.filter(x=>x[0]==='reconcile').length,1);
});
test('cron failures remain visible as unavailable and never publish partial rewards or sensitive provider errors',async()=>{
 const f=fixture({result:{checked:0,failed:1,private:'hidden'}}),r=await f.cron();assert.equal(r.code,503);assert.deepEqual(r.body,{checked:0,failed:1});
 const api=createReferralApi({env:{CRON_SECRET:'x'},database:()=>{throw Error('private-provider-data');}}),res=response();await api.reconcile({method:'GET',query:{action:'referral_reconcile'},headers:{authorization:'Bearer x'}},res);assert.equal(res.code,503);assert.doesNotMatch(JSON.stringify(res.body),/private-provider-data/);
});
test('background work handles at most one pair and rotates a paused pair without making provider calls',async()=>{
 const log=[],ids=[id,other],rows=ids.map(new_user_id=>({new_user_id,state:'pending'}));
 const db={from(table){const q={select(){return q;},in(){return q;},order(){return q;},limit(){return q;},eq(k,v){q.id=v;return q;},single:async()=>({data:{payments_enabled:false},error:null}),then(resolve,reject){return Promise.resolve({data:q.id?[{...row(1),new_user_id:q.id},{...row(2),new_user_id:q.id}]:rows,error:null}).then(resolve,reject);}};return q;},rpc:async(name,args)=>{log.push([name,args]);return {data:null,error:null};}};
 assert.deepEqual(await reconcileReferralBatch(db,{provider:()=>{throw Error('Paused campaign must not contact provider');}}),{checked:1,failed:0});assert.equal(log.length,1);assert.equal(log[0][1].p_new_user,id);
});
test('a known processing receipt is checked once per pass and never triggers repeated polling or another new transfer',async()=>{
 const leg={...row(),new_user_id:id,source_account:'fac-source',destination_account:'fac-destination',provider_id:'trn-known',claimed_at:'claimed',reserved_at:'reserved',state:'processing'},otherLeg={...row(2),new_user_id:id},calls=[];
 const db={from(){const q={select(){return q;},eq(){return q;},order(){return q;},then(yes,no){return Promise.resolve({data:[leg,otherLeg],error:null}).then(yes,no);}};return q;},rpc:async(name,args)=>({error:null,data:name==='matmove_referral_claim'?{...leg,can_create:false}:leg})};
 const provider=async path=>{calls.push(path);return {id:'trn-known',status:'processing',amount:{currency:'SLE',value:100},sourceFinancialAccount:{id:leg.source_account},destinationFinancialAccount:{id:leg.destination_account},metadata:{matmoveReferralRewardId:leg.id,matmoveReferralNewUserId:id,matmoveReferralKind:leg.kind,matmoveReferralRequestKey:leg.request_key}};};
 assert.equal((await processReferral(db,id,{provider})).processing,true);assert.deepEqual(calls,['internal-transfers/trn-known']);
});
test('referral provider uses bounded requests and trusted credentials, rejecting nonallowlisted paths before fetch',async()=>{
 const prior=globalThis.fetch,old={MONIME_API_KEY:process.env.MONIME_API_KEY,MONIME_SPACE_ID:process.env.MONIME_SPACE_ID,MONIME_ENVIRONMENT:process.env.MONIME_ENVIRONMENT};
 Object.assign(process.env,{MONIME_API_KEY:'mon_test_fixture',MONIME_SPACE_ID:'space-fixture',MONIME_ENVIRONMENT:'test'});const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({result:{id:'trn-fixture'}})};};
 try{await referralProvider('internal-transfers',{method:'POST',headers:{Authorization:'spoofed','Monime-Space-Id':'spoofed','Idempotency-Key':'stable'},body:'{}'});assert.equal(calls[0].options.headers.Authorization,'Bearer mon_test_fixture');assert.equal(calls[0].options.headers['Monime-Space-Id'],'space-fixture');assert.equal(calls[0].options.headers['Idempotency-Key'],'stable');assert.ok(calls[0].options.signal instanceof AbortSignal);await assert.rejects(()=>referralProvider('../accounts'));assert.equal(calls.length,1);}
 finally{globalThis.fetch=prior;for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('integration retains exactly twelve API filenames and keeps public demo, wallet and reconciliation routes separate',async()=>{
 assert.equal((await readdir('api')).filter(n=>/\.(js|ts)$/.test(n)).length,12);const source=await readFile('api/get-live-wallet.js','utf8');assert.match(source,/referral_reconcile/);assert.match(source,/referral_status/);assert.match(source,/maxDuration:60/);assert.match(source,/protectedWallet\('read'/);assert.match(source,/arcade_public/);
});
test('connection probe echoes only its authenticated challenge and never invokes provider or reward reconciliation',async()=>{
 const calls=[],secret='fixture-secret_0123456789abcdefghijkl';
 const api=createReferralApi({env:{CRON_SECRET:secret,MONIME_REFERRAL_ACCOUNT_ID:'fac-referral',MONIME_SPIN_ACCOUNT_ID:'fac-spin',MONIME_API_KEY:'fixture-configured',MONIME_SPACE_ID:'fixture-space',MONIME_ENVIRONMENT:'live'},database:()=>({rpc:async name=>{calls.push(name);return{data:true,error:null};}}),provider:()=>{throw Error('Probe must not contact provider');},reconcile:()=>{throw Error('Probe must not process rewards');}});
 const r=response();await api.reconcile({method:'GET',query:{action:'referral_reconcile',probe:'true',challenge:id},headers:{authorization:`Bearer ${secret}`}},r);
 assert.equal(r.code,200);assert.deepEqual(r.body,{service:'matmove-referrals-v1',challenge:id,sourceAccount:'fac-referral',schemaReady:true});assert.deepEqual(calls,['matmove_referral_scheduler_ready']);assert.doesNotMatch(JSON.stringify(r.body),/fixture-secret|fixture-configured|fixture-space/);
});
test('bad probe queries, browser tokens and absent production configuration cannot initialize payment work',async()=>{
 const secret='fixture-secret_0123456789abcdefghijkl';
 for(const query of [{action:'referral_reconcile',probe:'false',challenge:id},{action:'referral_reconcile',probe:'true'},{action:'referral_reconcile',challenge:id},{action:'referral_reconcile',probe:['true','true'],challenge:id},{action:'referral_reconcile',probe:'true',challenge:id,recipient:other}]){
  let initialized=0;const api=createReferralApi({env:{CRON_SECRET:secret},database:()=>{initialized++;throw Error('not allowed');}}),r=response();await api.reconcile({method:'GET',query,headers:{authorization:`Bearer ${secret}`}},r);assert.equal(r.code,400);assert.equal(initialized,0);
 }
 for(const env of [{CRON_SECRET:secret},{CRON_SECRET:secret,MONIME_API_KEY:'fixture',MONIME_SPACE_ID:'fixture',MONIME_ENVIRONMENT:'test'}]){
  let initialized=0;const api=createReferralApi({env,database:()=>{initialized++;throw Error('not allowed');}}),r=response();await api.reconcile({method:'GET',query:{action:'referral_reconcile',probe:'true',challenge:id},headers:{authorization:`Bearer ${secret}`}},r);assert.equal(r.code,503);assert.equal(initialized,0);
 }
});
test('a missing scheduler schema never reports a successful connection probe',async()=>{
 const secret='fixture-secret_0123456789abcdefghijkl';
 for(const result of [{data:false},{error:{message:'private database exception'}}]){
  const api=createReferralApi({env:{CRON_SECRET:secret,MONIME_REFERRAL_ACCOUNT_ID:'fac-referral',MONIME_API_KEY:'fixture',MONIME_SPACE_ID:'fixture',MONIME_ENVIRONMENT:'live'},database:()=>({rpc:async()=>result}),provider:()=>{throw Error('not allowed');}}),r=response();await api.reconcile({method:'GET',query:{action:'referral_reconcile',probe:'true',challenge:id},headers:{authorization:`Bearer ${secret}`}},r);assert.equal(r.code,503);assert.doesNotMatch(JSON.stringify(r.body),/private database exception/);
 }
});
