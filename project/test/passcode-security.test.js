
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile} from 'node:fs/promises';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',staff='33333333-3333-4333-8333-333333333333';
test('six-digit passcodes privately migrate and persist rate limits without KYC or money changes',async t=>{
 const pg=new PGlite({extensions:{pgcrypto},postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});
 try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);insert into auth.users values('${uid}'),('${other}'),('${staff}');
 create table profiles(id uuid primary key references auth.users(id),role text,passcode text,kyc_status text,full_name text);
 insert into profiles values('${uid}','rider','0123','approved','Verified Customer'),('${other}','merchant',null,'pending','Merchant'),('${staff}','driver',null,'approved','Staff');
 create table user_roles(profile_id uuid,role text);insert into user_roles select id,role from profiles;
 create table matmove_staff_access(id uuid primary key,is_active boolean,removed_at timestamptz);insert into matmove_staff_access values('${staff}',true,null);
 create table wallets(user_id uuid,balance numeric);insert into wallets values('${uid}',42.50);
 grant usage on schema auth,public to authenticated,anon,service_role;grant select,update on profiles to authenticated;
 `);
 const home=await readFile('docs/PORTAL_HOME_SETUP.sql','utf8');await pg.exec(home.slice(home.indexOf('create or replace function public.matmove_preferences_role('),home.indexOf('create or replace function public.matmove_home_preferences(')));
 const sql=await readFile('docs/PASSCODE_SECURITY_SETUP.sql','utf8');await pg.exec(sql);
 const session=async(id,role='authenticated')=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await pg.exec('set role '+role);};
 const rpc=async(action,pin=null,next=null)=>(await pg.query('select public.matmove_customer_passcode($1,$2,$3) d',[action,pin,next])).rows[0].d;
 await t.test('legacy PIN is salted/hashed once and cleared from the readable profile',async()=>{
 const row=(await pg.query('select * from matmove_customer_passcodes where user_id=$1',[uid])).rows[0];assert.match(row.pin_hash,/^\$2a\$10\$/);assert.equal(row.digits,4);assert.equal((await pg.query('select passcode from profiles where id=$1',[uid])).rows[0].passcode,null);
 await session(uid);const status=await rpc('status');assert.equal(status.digits,4);assert.equal(status.configured,true);assert.equal(status.ok,false);assert.ok(!JSON.stringify(status).includes('0123'));assert.ok(!('pin_hash' in status));
 });
 await t.test('four-digit verification requires a six-digit upgrade and preserves identity and balance',async()=>{
 assert.equal((await rpc('verify','0123')).code,'upgrade_required');await assert.rejects(rpc('change','0123','1234'),/exactly six/);
 const saved=await rpc('change','0123','012345');assert.equal(saved.code,'saved');assert.equal(saved.digits,6);assert.equal(saved.ok,true);
 assert.equal((await rpc('verify','012345')).code,'verified');assert.equal((await rpc('verify','0123')).ok,false);
 await pg.exec('reset role');assert.equal((await pg.query('select kyc_status from profiles where id=$1',[uid])).rows[0].kyc_status,'approved');assert.equal((await pg.query('select balance from wallets where user_id=$1',[uid])).rows[0].balance,'42.50');
 });
 await t.test('five wrong guesses persist a cooldown across status, create and verify calls',async()=>{
 await session(uid);await rpc('verify','012345');for(let i=0;i<5;i++){const r=await rpc('verify','999999');assert.equal(r.ok,false);assert.equal(r.attemptsRemaining,4-i);}
 const blocked=await rpc('verify','012345');assert.equal(blocked.code,'cooldown');assert.equal(blocked.ok,false);assert.ok(blocked.retryAfterSeconds>0);
 assert.equal((await rpc('status')).code,'cooldown');assert.equal((await rpc('create',null,'777777')).code,'cooldown');
 await pg.exec('reset role');assert.equal((await pg.query('select failures from matmove_customer_passcodes where user_id=$1',[uid])).rows[0].failures,5);
 await pg.query("update matmove_customer_passcodes set blocked_until=now()-interval '1 second' where user_id=$1",[uid]);await session(uid);assert.equal((await rpc('verify','012345')).ok,true);assert.equal((await rpc('status')).attemptsRemaining,5);
 });
 await t.test('new setup requires six digits and cannot reset an existing passcode',async()=>{
 await session(other);assert.equal((await rpc('status')).configured,false);await assert.rejects(rpc('create',null,'1234'),/six digits/);
 assert.equal((await rpc('create',null,'654321')).code,'saved');assert.equal((await rpc('create',null,'000000')).code,'already_configured');
 assert.equal((await rpc('change','999999','777777')).ok,false);assert.equal((await rpc('verify','654321')).ok,true);assert.equal((await rpc('change','654321','777777')).code,'saved');assert.equal((await rpc('verify','777777')).ok,true);
 });
 await t.test('private tables, hashing helpers, plaintext writes and anonymous/staff access stay denied',async()=>{
 await assert.rejects(pg.query('select * from matmove_customer_passcodes'),/permission denied/);await assert.rejects(pg.query('update matmove_customer_passcodes set failures=0'),/permission denied/);await assert.rejects(pg.query("select public.matmove_pin_crypt('123456',null)"),/permission denied/);
 await assert.rejects(pg.query('update profiles set passcode=$1 where id=$2',['123456',other]),/Plaintext passcodes are disabled/);
 await session(null,'anon');await assert.rejects(rpc('status'),/permission denied/);await session(staff);await assert.rejects(rpc('status'),/Customer account required/);await session(null);await assert.rejects(rpc('status'),/Sign in/);
 });
 await t.test('reruns preserve hashes and attempt counters; status never claims an unlock',async()=>{
 await session(uid);await rpc('verify','999999');await pg.exec('reset role');const before=(await pg.query('select * from matmove_customer_passcodes where user_id=$1',[uid])).rows[0];await pg.exec(sql);assert.deepEqual((await pg.query('select * from matmove_customer_passcodes where user_id=$1',[uid])).rows[0],before);
 await session(uid);assert.equal((await rpc('status')).ok,false);assert.equal((await rpc('status')).userId,uid);
 });
 }finally{await pg.close();}
});
