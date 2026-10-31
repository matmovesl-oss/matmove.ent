
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
// pg_cron, pg_net and Vault require hosted extensions. Only those interfaces are
// stubbed here; every MatMove scheduler function below is the actual delivered SQL.
const nonce='11111111-1111-4111-8111-111111111111';
test('Referral scheduler is private, inactive on installation and gated by a no-payment deployed probe',async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema cron;create schema net;create schema vault;
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,active boolean default true,schedule text,command text);
 create function cron.schedule(job_name text,job_schedule text,job_command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(job_name,job_schedule,job_command) returning jobid$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create table vault.decrypted_secrets(name text unique,decrypted_secret text);
 create table net.requests(id bigint generated always as identity primary key,url text,params jsonb,headers jsonb,timeout_milliseconds integer);
 create table net._http_response(id bigint primary key,status_code integer,timed_out boolean default false,content text);
 create function net.http_get(url text,params jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.requests(url,params,headers,timeout_milliseconds) values($1,$2,$3,$4) returning id$$;
 create table matmove_referral_campaign(singleton boolean primary key,payments_enabled boolean,accepting_referrals boolean,treasury_account text);
 insert into matmove_referral_campaign values(true,false,false,null);
 create table matmove_referral_rewards(id uuid default gen_random_uuid(),provider_id text,state text);
 create function matmove_referral_claim(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function matmove_referral_prepare(uuid,text,bigint,timestamptz) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function matmove_referral_record(uuid,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function matmove_referral_defer(uuid,text) returns void language sql as $$select$$;
 grant usage on schema public to anon,authenticated,service_role;
 `);
 const delivered=await readFile('docs/REFERRAL_SCHEDULER_SETUP.sql','utf8');
 const sql=delivered.replace(/^create extension if not exists[^;]+;$/gm,'-- hosted extension interface provided by the fixture');
 const value=async(sql,args=[]) => (await pg.query(sql,args)).rows[0]?.v;
 const tick=()=>value('select matmove_referral_scheduler_tick() v');
 const probe=()=>value('select matmove_referral_scheduler_probe() v');
 const control=enabled=>value('select matmove_referral_scheduler_control($1) v',[enabled]);
 const count=()=>value('select count(*)::integer v from net.requests');
 const reset=async()=>pg.exec("update matmove_referral_scheduler set queued_at=null,request_id=null,probe_at=null;delete from net._http_response;delete from matmove_referral_rewards;update matmove_referral_campaign set payments_enabled=false,treasury_account=null");
 const answer=async(patch={})=>{
  const s=(await pg.query('select * from matmove_referral_scheduler')).rows[0];
  await pg.query('insert into net._http_response(id,status_code,timed_out,content) values($1,$2,$3,$4) on conflict(id) do update set status_code=excluded.status_code,timed_out=excluded.timed_out,content=excluded.content',[s.probe_id,200,false,JSON.stringify({service:'matmove-referrals-v1',challenge:s.probe_nonce,sourceAccount:'fac-referral',schemaReady:true,...patch})]);
 };
 await pg.exec(sql);
 await t.test('installation creates exactly one inactive job and changes no campaign flags',async()=>{
  assert.equal(await value("select active v from cron.job where jobname='matmove-referral-worker-v1'"),false);assert.equal(await value('select enabled v from matmove_referral_scheduler'),false);assert.equal(await tick(),null);assert.equal(await count(),0);assert.equal(await value('select payments_enabled or accepting_referrals v from matmove_referral_campaign'),false);await pg.exec(sql);assert.equal(await value('select count(*)::integer v from cron.job'),1);
 });
 await t.test('browser roles cannot read scheduler state, queue a probe, control or invoke a tick',async()=>{
  for(const role of ['anon','authenticated'])for(const query of ['select * from matmove_referral_scheduler','select matmove_referral_scheduler_probe()','select matmove_referral_scheduler_tick()','select matmove_referral_scheduler_control(true)','select matmove_referral_scheduler_status()']){await pg.exec('set role '+role);try{await assert.rejects(()=>pg.exec(query),/permission denied/);}finally{await pg.exec('reset role');}}
  assert.equal(await count(),0);
 });
 await t.test('missing and invalid Vault secrets cannot queue a request or enable a job',async()=>{
  await assert.rejects(probe);await pg.exec("insert into vault.decrypted_secrets values('matmove_referral_cron_secret','short')");await assert.rejects(probe,/at least 32/);assert.equal(await count(),0);await assert.rejects(()=>control(true),/probe/);
  await pg.query('update vault.decrypted_secrets set decrypted_secret=$1',['test-fixture-secret_1234567890abcdef']);
 });
 await t.test('probe uses a fixed HTTPS destination and a fresh challenge without entering the money worker',async()=>{
  const id=await probe();assert.ok(id);const request=(await pg.query('select * from net.requests order by id desc limit 1')).rows[0];assert.equal(request.url,'https://matmoveent.vercel.app/api/get-live-wallet');assert.equal(request.params.action,'referral_reconcile');assert.equal(request.params.probe,'true');assert.match(request.params.challenge,/^[a-f0-9-]{36}$/);assert.match(request.headers.Authorization,/^Bearer test-fixture-secret/);assert.equal(request.timeout_milliseconds,20000);assert.equal(await probe(),id);assert.equal(await count(),1);assert.equal(await value('select enabled v from matmove_referral_scheduler'),false);
 });
 await t.test('wrong, failed, timed-out or stale probes cannot enable scheduled processing',async()=>{
  for(const patch of [{challenge:nonce},{service:'other'},{schemaReady:false},{sourceAccount:'bad'}]){await answer(patch);await assert.rejects(()=>control(true),/not verified/);}
  await answer();await pg.exec('update net._http_response set status_code=401');await assert.rejects(()=>control(true),/not succeeded/);await pg.exec('update net._http_response set status_code=200,timed_out=true');await assert.rejects(()=>control(true),/not succeeded/);await answer();await pg.exec("update matmove_referral_scheduler set probe_at=now()-interval '1 hour'");await assert.rejects(()=>control(true),/fresh/);
 });
 await t.test('a verified probe enables only the scheduler; source mismatch blocks enabling and disabling always works',async()=>{
  await reset();await probe();await answer();await pg.exec("update matmove_referral_campaign set treasury_account='fac-other'");await assert.rejects(()=>control(true),/does not match/);await pg.exec("update matmove_referral_campaign set treasury_account='fac-referral'");assert.equal(await control(true),true);assert.equal(await value('select active v from cron.job'),true);assert.equal(await value('select payments_enabled v from matmove_referral_campaign'),false);assert.equal(await tick(),null);await pg.exec(sql);assert.equal(await value('select enabled v from matmove_referral_scheduler'),true);assert.equal(await value('select active v from cron.job'),true);assert.equal(await control(false),false);assert.equal(await value('select active v from cron.job'),false);
 });
 await t.test('paused campaigns skip untouched rewards but can reconcile an original known transfer',async()=>{
  await reset();await probe();await answer();await control(true);await pg.exec("insert into matmove_referral_rewards(state) values('pending')");const before=await count();assert.equal(await tick(),null);assert.equal(await count(),before);await pg.exec("insert into matmove_referral_rewards(state,provider_id) values('processing','trn-original')");assert.ok(await tick());const request=(await pg.query('select * from net.requests order by id desc limit 1')).rows[0];assert.deepEqual(request.params,{action:'referral_reconcile'});assert.equal(request.timeout_milliseconds,65000);
 });
 await t.test('in-flight work does not overlap and expired requests never cause direct provider calls',async()=>{
  const before=await count();assert.equal(await tick(),null);assert.equal(await count(),before);await pg.exec("update matmove_referral_scheduler set queued_at=now()-interval '2 minutes'");assert.ok(await tick());assert.equal(await count(),before+1);assert.ok((await pg.query('select url from net.requests')).rows.every(r=>r.url==='https://matmoveent.vercel.app/api/get-live-wallet'));
 });
 await t.test('status exposes only safe health fields and reruns preserve disabled state and secrets',async()=>{
  await control(false);await pg.exec(sql);const status=await value('select matmove_referral_scheduler_status() v');assert.equal(status.enabled,false);assert.equal(status.jobActive,false);assert.equal(status.schedule,'* * * * *');assert.equal(status.secretPresent,true);assert.equal(status.schemaReady,true);assert.doesNotMatch(JSON.stringify(status),/Bearer|test-fixture|challenge|decrypted_secret/);assert.equal(await value('select count(*)::integer v from vault.decrypted_secrets'),1);
 });
 }finally{await pg.close();}
});
