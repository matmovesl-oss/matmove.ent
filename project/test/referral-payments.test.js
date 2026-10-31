
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const root='11111111-1111-4111-8111-111111111111',reviewer='22222222-2222-4222-8222-222222222222',source='fac-referral';const uid=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const receipt=(leg,status='completed')=>({id:`trn-${leg.id}`,status,amount:{currency:'SLE',value:100},sourceFinancialAccount:{id:leg.source_account},destinationFinancialAccount:{id:leg.destination_account},metadata:{matmoveReferralRewardId:leg.id,matmoveReferralNewUserId:leg.new_user_id,matmoveReferralKind:leg.kind,matmoveReferralRequestKey:leg.request_key}});
test('Referral money SQL reserves dedicated funds and records only exact authorized receipts',async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table auth.users(id uuid primary key,created_at timestamptz default now());
   create table profiles(id uuid primary key references auth.users(id),role text,kyc_status text,customer_account_started_at timestamptz default now(),phone text,phone_number text,full_name text,first_name text,last_name text,date_of_birth date,is_wallet_frozen boolean default false);
   create table user_roles(profile_id uuid,role text);create table matmove_staff_access(id uuid,is_active boolean,removed_at timestamptz);
   create table wallets(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),currency text,balance numeric default 0,is_frozen boolean default false,monime_account_id text,metadata jsonb default '{}');
   create table kyc_submissions(id uuid default gen_random_uuid(),profile_id uuid,target_role text,status text,reviewer_id uuid);
   grant usage on schema public,auth to authenticated,anon,service_role;
   insert into auth.users(id) values('${root}'),('${reviewer}');
   insert into profiles(id,role,kyc_status,phone,full_name,date_of_birth) values('${root}','rider','approved','+23276000000','Inviting Customer','1980-01-01');
   insert into wallets(user_id,currency,monime_account_id) values('${root}','SLE','fac-root');insert into kyc_submissions(profile_id,target_role,status) values('${root}','rider','approved');
  `);
  await pg.exec(await readFile('docs/PORTAL_HOME_SETUP.sql','utf8'));const onboarding=await readFile('docs/CUSTOMER_ONBOARDING_SETUP.sql','utf8');await pg.exec(onboarding.slice(onboarding.indexOf('create or replace function public.matmove_customer_phone('),onboarding.indexOf('create or replace function public.matmove_customer_me()')));
  await pg.exec(await readFile('docs/REFERRALS_SETUP.sql','utf8'));const sql=await readFile('docs/REFERRAL_PAYMENTS_SETUP.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  await pg.query("insert into matmove_referral_codes(user_id,code) values($1,'MM000000000001')",[root]);
  await pg.exec("update matmove_referral_campaign set accepting_referrals=true,payments_enabled=true,treasury_account='fac-referral',budget_minor=100000");
  const rpc=async(name,args)=>(await pg.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
  const seed=async(n,role='rider')=>{const id=uid(n);await pg.query('insert into auth.users(id) values($1)',[id]);await pg.query("insert into profiles(id,role,kyc_status,phone,full_name,date_of_birth) values($1,$2,'approved',$3,$4,'2000-01-01')",[id,role,`+232${70000000+n}`,`New Customer ${n}`]);await pg.query("insert into wallets(user_id,currency,monime_account_id) values($1,'SLE',$2)",[id,`fac-new${n}`]);await pg.query("insert into kyc_submissions(profile_id,target_role,status,reviewer_id) values($1,$2,'approved',$3)",[id,role,role==='rider'?null:reviewer]);await pg.query("insert into matmove_referrals(new_user_id,referrer_id,code,campaign_version) values($1,$2,'MM000000000001',1)",[id,root]);await pg.query("insert into matmove_referral_rewards(new_user_id,beneficiary_id,kind) values($1,$2,'inviter'),($1,$1,'new_user')",[id,root]);return id;};
  const prepare=(id,balance=100000,observed=new Date().toISOString())=>rpc('matmove_referral_prepare',[id,source,balance,observed]);
  const legs=async id=>(await pg.query('select * from matmove_referral_rewards where new_user_id=$1 order by kind',[id])).rows;
  const claim=id=>rpc('matmove_referral_claim',[id]);const record=(leg,value)=>rpc('matmove_referral_record',[leg.id,value]);
  await t.test('both SLE1 rewards reserve SLE2 once without touching a customer cached balance',async()=>{
   const id=await seed(1);await prepare(id);await prepare(id);const rows=await legs(id);assert.equal(rows.length,2);assert.ok(rows.every(l=>l.reserved_at&&l.source_account===source&&l.amount_minor===100));assert.equal((await pg.query('select sum(balance)::text n from wallets')).rows[0].n,'0');
  });
  await t.test('unapproved KYC, missing driver review and any frozen wallet prevent reserving rewards',async()=>{
   const id=await seed(2,'driver');await pg.query("update profiles set kyc_status='pending' where id=$1",[id]);await assert.rejects(()=>prepare(id),/approved verification/);await pg.query("update profiles set kyc_status='approved' where id=$1",[id]);await pg.query('update kyc_submissions set reviewer_id=null where profile_id=$1',[id]);await assert.rejects(()=>prepare(id),/confirmed KYC/);await pg.query('update kyc_submissions set reviewer_id=$1 where profile_id=$2',[reviewer,id]);await pg.query('update wallets set is_frozen=true where user_id=$1',[root]);await assert.rejects(()=>prepare(id),/unfrozen/);await pg.query('update wallets set is_frozen=false where user_id=$1',[root]);await prepare(id);
  });
  await t.test('bad treasury, stale balance, low funds and budget shortages fail before claims',async()=>{
   const id=await seed(3);await assert.rejects(()=>rpc('matmove_referral_prepare',[id,'fac-root',100000,new Date().toISOString()]),/dedicated/);await assert.rejects(()=>prepare(id,100000,'2000-01-01'),/Refresh/);await assert.rejects(()=>prepare(id,100),/funds/);await pg.exec('update matmove_referral_campaign set budget_minor=1');await assert.rejects(()=>prepare(id),/budget/);await pg.exec('update matmove_referral_campaign set budget_minor=100000');assert.ok((await legs(id)).every(l=>!l.reserved_at&&!l.claimed_at));
  });
  await t.test('only one claim authorizes a POST; a missing response retains the same key for review',async()=>{
   const id=await seed(4);await prepare(id);const [raw]=await legs(id),first=await claim(raw.id),again=await claim(raw.id);assert.equal(first.can_create,true);assert.equal(again.can_create,false);assert.equal(again.state,'review_required');assert.equal(first.request_key,again.request_key);assert.equal((await record(first,null)).state,'review_required');assert.equal((await claim(raw.id)).can_create,false);
   // A genuinely delayed original response can still settle its matching claim.
   assert.equal((await record(first,receipt(first))).state,'completed');
  });
  await t.test('two exact reward receipts credit each beneficiary separately and never downgrade completion',async()=>{
   const id=await seed(5);await prepare(id);for(const raw of await legs(id)){const l=await claim(raw.id);assert.equal((await record(l,receipt(l))).state,'completed');assert.equal((await record(l,receipt(l,'pending'))).state,'completed');assert.equal((await claim(l.id)).can_create,false);}assert.ok((await legs(id)).every(l=>l.state==='completed'));
  });
  await t.test('wrong amount, currency, account or referral metadata is never a credited prize',async()=>{
   const id=await seed(6);await prepare(id);const l=await claim((await legs(id))[0].id);
   for(const mutate of [r=>r.amount.value=200,r=>r.amount.currency='USD',r=>r.destinationFinancialAccount.id='fac-other',r=>r.metadata.matmoveReferralRewardId=uid(99)]){const r=receipt(l);mutate(r);const result=await record(l,r);assert.equal(result.state,'review_required');assert.equal(result.provider_id,null);}assert.equal((await claim(l.id)).can_create,false);
  });
  await t.test('known provider receipts can be polled after a pause/freeze without allowing another transfer',async()=>{
   const id=await seed(7);await prepare(id);const [a,b]=await legs(id),l=await claim(a.id);await record(l,receipt(l,'processing'));await pg.exec('update matmove_referral_campaign set payments_enabled=false');await pg.query('update wallets set is_frozen=true where user_id=$1',[root]);const poll=await claim(a.id);assert.equal(poll.can_create,false);assert.ok(poll.provider_id);await assert.rejects(()=>claim(b.id),/paused/);assert.equal((await record(l,receipt(l))).state,'completed');await pg.exec('update matmove_referral_campaign set payments_enabled=true');await pg.query('update wallets set is_frozen=false where user_id=$1',[root]);
  });
  await t.test('reused verified identity and self-identity matches cannot qualify a new email twice',async()=>{
   const duplicate=await seed(8);await pg.query("update profiles set phone='+23270000001' where id=$1",[duplicate]);await assert.rejects(()=>prepare(duplicate),/already qualified/);
   const self=await seed(9);await pg.query("update profiles set full_name='Inviting Customer',date_of_birth='1980-01-01' where id=$1",[self]);await assert.rejects(()=>prepare(self),/Self-referrals/);
  });
  await t.test('a balance read before completed payouts still reserves those exact amounts against another referral',async()=>{
   await pg.exec('begin');try{
    const first=await seed(10),next=await seed(11);
    const existing=Number((await pg.query("select coalesce(sum(amount_minor),0)::text n from matmove_referral_rewards where reserved_at is not null and state<>'completed'")).rows[0].n);
    await prepare(first,existing+200);const observed=(await pg.query('select clock_timestamp() t')).rows[0].t;
    for(const raw of await legs(first)){const leg=await claim(raw.id);await record(leg,receipt(leg));}
    await pg.exec('savepoint stale_balance');await assert.rejects(()=>prepare(next,existing+200,observed),/funds/);await pg.exec('rollback to savepoint stale_balance');
    assert.ok((await legs(next)).every(l=>!l.reserved_at));
    await prepare(next,existing+200);
   }finally{await pg.exec('rollback');}
  });
  await t.test('changing a reserved destination or freezing either participant prevents a new transfer claim',async()=>{
   const id=await seed(12);await prepare(id);const leg=(await legs(id)).find(l=>l.kind==='new_user');
   await pg.query("update wallets set monime_account_id='fac-changed' where user_id=$1",[id]);await assert.rejects(()=>claim(leg.id),/changed/);
   await pg.query("update wallets set monime_account_id='fac-new12',is_frozen=true where user_id=$1",[id]);await assert.rejects(()=>claim(leg.id),/unfrozen/);
   await pg.query('update wallets set is_frozen=false where user_id=$1',[id]);assert.equal((await claim(leg.id)).can_create,true);
  });
  await t.test('browser sessions cannot execute reward preparation, claiming, receipt recording or inspect identity fingerprints',async()=>{
   await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[root]);await pg.exec('set role authenticated');await assert.rejects(()=>prepare(uid(1)),/permission denied/);await assert.rejects(()=>claim(uid(99)),/permission denied/);await assert.rejects(()=>rpc('matmove_referral_record',[uid(99),{}]),/permission denied/);await assert.rejects(()=>pg.query('select * from matmove_referral_identity_claims'),/permission denied/);await pg.exec('reset role');
  });
  await t.test('reruns preserve pauses and existing receipts, and defer rotates work without releasing reserved money',async()=>{
   await pg.exec('update matmove_referral_campaign set payments_enabled=false');await pg.exec(sql);assert.equal((await pg.query('select payments_enabled from matmove_referral_campaign')).rows[0].payments_enabled,false);const before=(await legs(uid(4)))[0];await rpc('matmove_referral_defer',[uid(4),'Review retained']);const after=(await legs(uid(4)))[0];assert.equal(after.state,before.state);assert.equal(after.provider_id,before.provider_id);assert.ok(after.reserved_at);
  });
 }finally{await pg.close();}
});
