
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const root='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333';
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
test('Referral setup creates private codes and exactly one immutable attribution, with no money movement',async t=>{
 const db=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table auth.users(id uuid primary key,created_at timestamptz not null default clock_timestamp());
  create table profiles(id uuid primary key references auth.users(id),role text,kyc_status text,customer_account_started_at timestamptz default clock_timestamp(),email text,phone text);
  create table user_roles(profile_id uuid,role text);create table matmove_staff_access(id uuid primary key,is_active boolean,removed_at timestamptz);
  create table wallets(user_id uuid,balance numeric,currency text);insert into wallets values('${root}',42.50,'SLE');
  grant usage on schema public,auth to authenticated,anon;
  insert into auth.users values('${root}',now()-interval '30 days'),('${second}',now()-interval '30 days'),('${admin}',now()-interval '30 days');
  insert into profiles(id,role,kyc_status,email,phone) values('${root}','rider','not_started','root@example.com','+23276000000'),('${second}','merchant','pending','merchant@example.com','+23277000000'),('${admin}','driver','pending','staff@example.com','+23278000000');
  insert into matmove_staff_access values('${admin}',true,null);
  `);
  await db.exec(await readFile('docs/PORTAL_HOME_SETUP.sql','utf8'));const sql=await readFile('docs/REFERRALS_SETUP.sql','utf8');await db.exec(sql);await db.exec(sql);
  const session=async user=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');};
  const create=async(user,role='rider',status='not_started',old=false)=>{await db.exec('reset role');await db.query("insert into auth.users(id,created_at) values($1,clock_timestamp()-case when $2 then interval '30 days' else interval '0 seconds' end)",[user,old]);await db.query('insert into profiles(id,role,kyc_status,email) values($1,$2,$3,$4)',[user,role,status,`customer${user}@example.com`]);await session(user);};
  const code=async()=> (await db.query('select matmove_referral_my_code() v')).rows[0].v;
  const me=async()=> (await db.query('select matmove_referrals_me() v')).rows[0].v;
  const bind=async c=>(await db.query('select matmove_referral_register($1) v',[c])).rows[0].v;
  let rootCode,otherCode;
  await t.test('campaign is initially paused; all three customer roles keep one code and no money is credited',async()=>{
   await session(root);assert.equal((await me()).code,null);rootCode=(await code()).code;assert.match(rootCode,/^MM[A-F0-9]{12}$/);assert.equal((await code()).code,rootCode);assert.equal((await me()).campaign.accepting,false);assert.equal((await me()).credited_minor,'0');
   await session(second);otherCode=(await code()).code;await assert.rejects(()=>bind(rootCode),/PAUSED/);
   await create(id(1),'driver');assert.match((await code()).code,/^MM/);
  });
  await t.test('new signup attribution captures the inviter and two pending SLE1 rewards exactly once',async()=>{
   await db.exec('reset role');await db.exec('update matmove_referral_campaign set accepting_referrals=true where singleton');await create(id(2));
   assert.equal((await bind(rootCode.toLowerCase())).recorded,true);assert.equal((await bind(rootCode)).recorded,true);await assert.rejects(()=>bind(otherCode),/already recorded/);
   const summary=await me();assert.equal(summary.registered_with_code,true);assert.equal(summary.pending_minor,'100');assert.equal(summary.credited_minor,'0');
   await db.exec('reset role');const rewards=(await db.query('select amount_minor,currency,kind,state from matmove_referral_rewards where new_user_id=$1 order by kind',[id(2)])).rows;
   assert.equal(rewards.length,2);assert.ok(rewards.every(r=>r.amount_minor===100&&r.currency==='SLE'&&r.state==='pending'));
  });
  await t.test('old accounts, completed verification, self referrals and missing codes are ineligible',async()=>{
   await session(second);await assert.rejects(()=>bind(rootCode),/new account setup/);await create(id(3),'merchant','approved');await assert.rejects(()=>bind(rootCode),/before verification/);
   await create(id(4));const own=(await code()).code;await assert.rejects(()=>bind(own),/own referral/);await assert.rejects(()=>bind('MM000000000000'),/unavailable/);await assert.rejects(()=>bind('bad code'),/valid MatMove/);
  });
  await t.test('reciprocal and longer circular referral chains are rejected without adding reward rows',async()=>{
   await create(id(5));const e=(await code()).code;await create(id(6));const f=(await code()).code;await bind(e);await session(id(5));await assert.rejects(()=>bind(f),/circular/);
   await create(id(7));const g=(await code()).code;await session(id(5));await bind(g);await session(id(7));await assert.rejects(()=>bind(f),/circular/);
  });
  await t.test('customer RPCs reveal only owned totals; staff, anonymous and direct table writes are denied',async()=>{
   await session(root);const summary=await me();assert.equal(summary.invited_count,'1');assert.ok(!JSON.stringify(summary).includes(id(2)));assert.ok(!JSON.stringify(summary).includes('example.com'));
   for(const name of ['matmove_referral_campaign','matmove_referral_codes','matmove_referrals','matmove_referral_rewards'])await assert.rejects(()=>db.query(`select * from ${name}`),/permission denied/);
   await assert.rejects(()=>db.exec("update matmove_referral_rewards set state='completed',provider_id='fake'"),/permission denied/);await assert.rejects(()=>db.query('select matmove_referral_customer($1)',[root]),/permission denied/);
   await session(admin);await assert.rejects(me,/Customer account/);await db.exec('reset role;set role anon');await assert.rejects(me,/permission denied/);
  });
  await t.test('only a completed reward with a provider receipt counts as credited; each beneficiary has separate totals',async()=>{
   await db.exec('reset role');await assert.rejects(()=>db.exec("update matmove_referral_rewards set state='completed' where kind='inviter'"),/check constraint/);
   await db.query("update matmove_referral_rewards set state='completed',provider_id='trn-test-confirmed-referral' where new_user_id=$1 and kind='inviter'",[id(2)]);await session(root);assert.equal((await me()).credited_minor,'100');assert.equal((await me()).pending_minor,'0');
   await session(id(2));assert.equal((await me()).credited_minor,'0');assert.equal((await me()).pending_minor,'100');
   await db.exec('reset role');await db.query("update matmove_referral_rewards set state='review_required' where new_user_id=$1 and kind='new_user'",[id(2)]);await session(id(2));assert.equal((await me()).review_count,'1');assert.equal((await me()).credited_minor,'0');
  });
  await t.test('reruns preserve paused campaign, attribution, receipts and customer wallet balances',async()=>{
   await db.exec('reset role');await db.exec('update matmove_referral_campaign set accepting_referrals=false');await db.exec(sql);await session(root);assert.equal((await code()).code,rootCode);assert.equal((await me()).campaign.accepting,false);assert.equal((await me()).credited_minor,'100');
   await db.exec('reset role');assert.equal((await db.query('select balance::text n from wallets where user_id=$1',[root])).rows[0].n,'42.50');assert.equal((await db.query('select count(*)::int n from matmove_referrals where new_user_id=$1',[id(2)])).rows[0].n,1);
  });
 }finally{await db.close();}
});
