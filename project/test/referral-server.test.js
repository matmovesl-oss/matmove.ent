
import test from 'node:test';
import assert from 'node:assert/strict';
import {processReferral,runReferralLeg,reconcileReferralBatch} from '../server/referral-payments.js';
import {referralTransfer,referralBalance,referralTreasuryId,matchesReferralReceipt} from '../server/referral-rules.js';
const uid=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const env={MONIME_REFERRAL_ACCOUNT_ID:'fac-referral',MONIME_SPIN_ACCOUNT_ID:'fac-spin',MONIME_ESCROW_ACCOUNT_ID:'fac-escrow'};
function fixture(){
 const events=[],rewards=['inviter','new_user'].map((kind,i)=>({id:uid(i+10),new_user_id:uid(2),beneficiary_id:uid(i+1),kind,amount_minor:100,currency:'SLE',request_key:uid(i+20),state:'pending',provider_id:null,claimed_at:null,reserved_at:null}));
 const campaign={payments_enabled:true,treasury_account:'fac-referral'};
 const participants={new_user_id:uid(2),inviter:{user_id:uid(1),wallet_id:uid(30),account_id:'fac-inviter'},new_user:{user_id:uid(2),wallet_id:uid(31),account_id:'fac-new'}};
 let eligibilityError=null,receiptStatus='completed',failPost=false,wrongReceipt=false;
 const db={from(table){const q={select(){return q;},eq(){return q;},order(){return q;},in(){return q;},limit(){return q;},single:async()=>({data:structuredClone(campaign)}),then(resolve,reject){return Promise.resolve({data:structuredClone(rewards)}).then(resolve,reject);}};return q;},async rpc(name,args){
  events.push({name,args});const r=rewards.find(x=>x.id===args.p_reward);
  if(name==='matmove_referral_participants')return eligibilityError?{error:{message:eligibilityError}}:{data:structuredClone(participants)};
  if(name==='matmove_referral_prepare'){for(const l of rewards){l.source_account=args.p_source;l.destination_account=l.kind==='inviter'?'fac-inviter':'fac-new';l.reserved_at='reserved';}return {data:{reserved:true}};}
  if(name==='matmove_referral_claim'){
   if(['completed','failed'].includes(r.state)||r.provider_id)return {data:{...r,can_create:false}};
   if(r.claimed_at){r.state='review_required';return {data:{...r,can_create:false}};}
   if(!r.reserved_at)return {error:{message:'CONFLICT: Reserve first.'}};
   r.claimed_at='claimed';r.state='processing';return {data:{...r,can_create:true}};
  }
  if(name==='matmove_referral_record'){const receipt=args.p_receipt;if(!receipt)r.state='review_required';else{r.provider_id=receipt.id;r.state=['completed','failed'].includes(receipt.status)?receipt.status:'processing';}return {data:{...r}};}
  if(name==='matmove_referral_defer')return {data:null};
  throw Error(name);
 }};
 const provider=async(path,options)=>{
  events.push({path,options});
  if(path.startsWith('financial-accounts/')){const id=path.slice('financial-accounts/'.length).split('?')[0];return {id,currency:'SLE',balance:{available:{currency:'SLE',value:10000}}};}
  if(options?.method==='POST'){
   if(failPost)throw Error('Response lost');const body=JSON.parse(options.body);return {id:`trn-${body.metadata.matmoveReferralRewardId}`,status:receiptStatus,...body,...(wrongReceipt?{amount:{currency:'SLE',value:999}}:{})};
  }
  const leg=rewards.find(l=>`internal-transfers/${l.provider_id}`===path);
  return {id:leg.provider_id,status:receiptStatus,...JSON.parse(referralTransfer(leg).body)};
 };
 return {db,provider,events,rewards,campaign,participants,setEligibility:v=>eligibilityError=v,setPostFailure:v=>failPost=v,setStatus:v=>receiptStatus=v,setWrong:v=>wrongReceipt=v};
}
test('server reserves both exact SLE1 transfers before posting and preserves distinct original request keys',async()=>{
 const f=fixture();assert.deepEqual(await processReferral(f.db,uid(2),{env,provider:f.provider}),{newUserId:uid(2),completed:2,reviewRequired:false});
 const posts=f.events.filter(x=>x.options?.method==='POST');assert.equal(posts.length,2);
 assert.ok(f.events.findIndex(x=>x.name==='matmove_referral_prepare')<f.events.findIndex(x=>x.options?.method==='POST'));
 for(const [i,post] of posts.entries()){const b=JSON.parse(post.options.body);assert.deepEqual(b.amount,{currency:'SLE',value:100});assert.equal(b.sourceFinancialAccount.id,env.MONIME_REFERRAL_ACCOUNT_ID);assert.equal(b.destinationFinancialAccount.id,i===0?'fac-inviter':'fac-new');assert.equal(post.options.headers['Idempotency-Key'],`matmove-referral:${f.rewards[i].request_key}`);assert.equal(b.metadata.matmoveReferralRewardId,f.rewards[i].id);}
 await processReferral(f.db,uid(2),{env,provider:f.provider});assert.equal(f.events.filter(x=>x.options?.method==='POST').length,2);
});
test('concurrent workers require separate SQL claims and authorize only one POST per reward',async()=>{
 const f=fixture();await f.db.rpc('matmove_referral_prepare',{p_source:'fac-referral'});await Promise.all([runReferralLeg(f.db,uid(10),f.provider),runReferralLeg(f.db,uid(10),f.provider)]);assert.equal(f.events.filter(x=>x.options?.method==='POST').length,1);
});
test('lost POST response retains review and a second processing attempt never posts either reward again',async()=>{
 const f=fixture();f.setPostFailure(true);await assert.rejects(()=>processReferral(f.db,uid(2),{env,provider:f.provider}),/Response lost/);assert.equal(f.rewards[0].state,'review_required');const key=f.rewards[0].request_key;
 f.setPostFailure(false);assert.equal((await processReferral(f.db,uid(2),{env,provider:f.provider})).reviewRequired,true);assert.equal(f.events.filter(x=>x.options?.method==='POST').length,1);assert.equal(f.rewards[0].request_key,key);assert.equal(f.rewards[1].claimed_at,null);
});
test('paused campaigns poll known original receipts without starting the other reward',async()=>{
 const f=fixture();await f.db.rpc('matmove_referral_prepare',{p_source:'fac-referral'});f.setStatus('processing');await runReferralLeg(f.db,uid(10),f.provider);f.campaign.payments_enabled=false;f.setStatus('completed');
 const result=await processReferral(f.db,uid(2),{env,provider:f.provider});assert.equal(result.paused,true);assert.equal(f.rewards[0].state,'completed');assert.equal(f.events.filter(x=>x.options?.method==='POST').length,1);assert.ok(f.events.some(x=>x.path===`internal-transfers/${f.rewards[0].provider_id}`));
});
test('KYC rejection, wrong treasury and wrong recipient currency stop before any new POST',async()=>{
 for(const mode of ['kyc','treasury','recipient']){
  const f=fixture();if(mode==='kyc')f.setEligibility('FORBIDDEN: Complete verification.');if(mode==='treasury')f.campaign.treasury_account='fac-other';
  const provider=async(path,options)=>{const r=await f.provider(path,options);return mode==='recipient'&&path==='financial-accounts/fac-new'?{...r,currency:'USD'}:r;};
  await assert.rejects(()=>processReferral(f.db,uid(2),{env,provider}));assert.equal(f.events.filter(x=>x.options?.method==='POST').length,0);assert.equal(f.rewards.some(x=>x.reserved_at),false);
 }
});
test('wrong transfer receipt never reaches SQL as a confirmed payment',async()=>{
 const f=fixture();f.setWrong(true);const result=await processReferral(f.db,uid(2),{env,provider:f.provider});assert.equal(result.completed,0);assert.equal(result.reviewRequired,true);assert.ok(f.events.filter(x=>x.name==='matmove_referral_record').every(x=>x.args.p_receipt===null));
});
test('failed original provider transfer remains terminal and is never automatically sent again',async()=>{
 const f=fixture();f.setStatus('failed');const r=await processReferral(f.db,uid(2),{env,provider:f.provider});assert.equal(r.reviewRequired,true);await processReferral(f.db,uid(2),{env,provider:f.provider});assert.equal(f.events.filter(x=>x.options?.method==='POST').length,2);
});
test('queue deduplicates beneficiaries and rotates ineligible work without moving money',async()=>{
 const f=fixture();f.setEligibility('FORBIDDEN: Both customers need approved verification and unfrozen wallets.');assert.deepEqual(await reconcileReferralBatch(f.db,{env,provider:f.provider}),{checked:1,failed:0});assert.equal(f.events.filter(x=>x.name==='matmove_referral_defer').length,1);assert.equal(f.events.filter(x=>x.options?.method==='POST').length,0);
});
test('strict money helpers reject shared treasury, stale identity fields, unsafe balances and mismatched receipts',()=>{
 assert.throws(()=>referralTreasuryId({...env,MONIME_REFERRAL_ACCOUNT_ID:'fac-spin'}));assert.throws(()=>referralBalance({id:'fac-referral',currency:'SLE',balance:{available:{currency:'SLE',value:'100'}}},'fac-referral'));
 const f=fixture(),leg={...f.rewards[0],source_account:'fac-referral',destination_account:'fac-inviter'};const body=JSON.parse(referralTransfer(leg).body),r={...body,id:'trn-good',status:'completed'};assert.equal(matchesReferralReceipt(r,leg),true);
 for(const field of ['id','new_user_id','request_key'])assert.throws(()=>referralTransfer({...leg,[field]:'invalid'}));assert.throws(()=>referralTransfer({...leg,kind:'other'}));assert.equal(matchesReferralReceipt({...r,amount:{currency:'SLE',value:'100'}},leg),false);assert.equal(matchesReferralReceipt({...r,id:'trn-other'},{...leg,provider_id:'trn-good'}),false);
});

test('capacity and paused SQL conditions rotate without a provider debit or a false worker failure',async()=>{
 for(const message of ['CAPACITY: Referral campaign budget is insufficient.','CAPACITY: Referral funds are reserved or insufficient. Rewards remain pending.','PAUSED: Referral payments are paused.','FORBIDDEN: A confirmed KYC approval is required for both customers.']){
  const f=fixture();f.setEligibility(message);const before=f.rewards.map(r=>({...r}));
  assert.deepEqual(await reconcileReferralBatch(f.db,{env,provider:f.provider}),{checked:1,failed:0});assert.equal(f.events.filter(x=>x.options?.method==='POST').length,0);assert.deepEqual(f.rewards,before);assert.equal(f.events.filter(x=>x.name==='matmove_referral_defer').length,1);
 }
});
test('identity abuse, changed reservations and arbitrary forbidden errors stay visible as failed checks',async()=>{
 for(const message of ['FORBIDDEN: This referral identity has already qualified. Review required.','FORBIDDEN: Referral identity needs review. Self-referrals are not eligible.','CONFLICT: Reserved referral accounts changed. Review the original payments.','FORBIDDEN: Unexpected access failure.']){
  const f=fixture();f.setEligibility(message);assert.deepEqual(await reconcileReferralBatch(f.db,{env,provider:f.provider}),{checked:0,failed:1});assert.equal(f.events.filter(x=>x.options?.method==='POST').length,0);
 }
});
test('a real provider failure and a failed queue rotation are never treated as ordinary waiting',async()=>{
 const f=fixture();f.setPostFailure(true);assert.deepEqual(await reconcileReferralBatch(f.db,{env,provider:f.provider}),{checked:0,failed:1});assert.equal(f.events.filter(x=>x.options?.method==='POST').length,1);assert.equal(f.rewards[0].state,'review_required');
 const g=fixture();g.setEligibility('CAPACITY: Referral campaign budget is insufficient.');const original=g.db.rpc;g.db.rpc=async(name,args)=>name==='matmove_referral_defer'?{error:{message:'database unavailable'}}:original(name,args);assert.deepEqual(await reconcileReferralBatch(g.db,{env,provider:g.provider}),{checked:0,failed:1});assert.equal(g.events.filter(x=>x.options?.method==='POST').length,0);
});
test('scheduler status verifies the deployed challenge and never exposes a source from stale or malformed probe data',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{readFile}=await import('node:fs/promises');const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});
 try{
  await pg.exec(`create schema cron;create schema net;create schema vault;
   create table matmove_referral_scheduler(singleton boolean,enabled boolean,request_id bigint,queued_at timestamptz,probe_id bigint,probe_nonce uuid,probe_at timestamptz);
   insert into matmove_referral_scheduler values(true,true,null,null,1,'${uid(90)}',now());
   create table cron.job(jobid bigint,active boolean,schedule text,jobname text);insert into cron.job values(1,true,'* * * * *','matmove-referral-worker-v1');
   create table net._http_response(id bigint,status_code integer,timed_out boolean,content text);
   create table vault.decrypted_secrets(name text);insert into vault.decrypted_secrets values('matmove_referral_cron_secret');
   create function matmove_referral_scheduler_ready() returns boolean language sql as $$select true$$;`);
  const sql=await readFile('docs/REFERRAL_SCHEDULER_SETUP.sql','utf8'),start=sql.indexOf('create or replace function public.matmove_referral_scheduler_status()'),end=sql.indexOf('revoke all on function public.matmove_referral_scheduler_ready()',start);
  assert.ok(start>=0&&end>start);await pg.exec(sql.slice(start,end));
  const valid={service:'matmove-referrals-v1',challenge:uid(90),schemaReady:true,sourceAccount:'fac-referral'};
  await pg.query('insert into net._http_response values(1,200,false,$1)',[JSON.stringify(valid)]);
  const status=async()=>(await pg.query('select matmove_referral_scheduler_status() v')).rows[0].v;
  assert.equal((await status()).probeVerified,true);assert.equal((await status()).probeSource,'fac-referral');
  for(const content of [JSON.stringify({...valid,challenge:uid(91)}),JSON.stringify({...valid,sourceAccount:'invalid'}),JSON.stringify({...valid,schemaReady:false}),'not json']){
   await pg.query('update net._http_response set content=$1',[content]);const v=await status();assert.equal(v.probeVerified,false);assert.equal(v.probeSource,null);
  }
  await pg.query('update net._http_response set content=$1',[JSON.stringify(valid)]);await pg.exec("update matmove_referral_scheduler set probe_at=now()-interval '31 minutes'");assert.equal((await status()).probeVerified,false);await pg.exec('update matmove_referral_scheduler set probe_at=now();update net._http_response set status_code=401');assert.equal((await status()).probeVerified,false);await pg.exec('update net._http_response set status_code=200,timed_out=true');assert.equal((await status()).probeVerified,false);assert.doesNotMatch(JSON.stringify(await status()),/challenge|Bearer/);
 }finally{await pg.close();}
});
