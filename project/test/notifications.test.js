
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const owner='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',rider='33333333-3333-4333-8333-333333333333',driver='44444444-4444-4444-8444-444444444444',merchant='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666';
const key=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
test('In-app messages enforce sender permissions and customer privacy without changing money or KYC',async t=>{
 const db=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${staff}'),('${rider}'),('${driver}'),('${merchant}'),('${other}');
 create table profiles(id uuid primary key references auth.users(id),role text,kyc_status text);
 insert into profiles values('${owner}','admin','approved'),('${staff}','rider','approved'),('${rider}','rider','pending'),('${driver}','driver','pending'),('${merchant}','merchant','rejected'),('${other}','rider','approved');
 create table user_roles(profile_id uuid,role text);insert into user_roles values('${owner}','admin'),('${staff}','rider'),('${rider}','rider'),('${driver}','driver'),('${merchant}','merchant'),('${other}','rider');
 create table wallets(user_id uuid,balance numeric);insert into wallets values('${rider}',42.50);
 create table matmove_staff_access(id uuid primary key,is_owner boolean,is_active boolean,permissions jsonb,removed_at timestamptz);
 insert into matmove_staff_access values('${owner}',true,true,'[]',null),('${staff}',false,true,'["customers"]',null);
 grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await readFile('docs/PORTAL_HOME_SETUP.sql','utf8'));const sql=await readFile('docs/NOTIFICATIONS_SETUP.sql','utf8');await db.exec(sql);await db.exec(sql);
 const session=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`);};
 const send=async(n,audience='all',target=null,title='MatMove update',body='Please review your account.',dest='account')=>(await db.query('select matmove_admin_send_notification($1,$2,$3,$4,$5,$6) v',[key(n),audience,target,title,body,dest])).rows[0].v;
 const inbox=async(before=null)=>(await db.query('select matmove_notifications($1) v',[before])).rows[0].v;
 const mark=async(id,through=false)=>(await db.query('select matmove_notification_read($1,$2) v',[id,through])).rows[0].v;
 await t.test('owner broadcasts to existing customers including skipped and rejected KYC, without staff or approval changes',async()=>{
  await session(owner);const receipt=await send(1);assert.equal(receipt.sender_id,owner);assert.equal(receipt.recipient_count,4);
  await session(rider);const page=await inbox();assert.equal(page.user_id,rider);assert.equal(page.unread_count,'1');assert.equal(page.items[0].body,'Please review your account.');assert.equal(page.items[0].sender_id,undefined);assert.equal(page.items[0].target_id,undefined);
  await db.exec('reset role');assert.equal((await db.query('select balance from wallets')).rows[0].balance,'42.50');assert.equal((await db.query('select kyc_status from profiles where id=$1',[rider])).rows[0].kyc_status,'pending');
 });
 await t.test('matching retries reuse the receipt; changed payload fails without a second send',async()=>{
  await session(owner);const a=await send(1),b=await send(1);assert.equal(a.id,b.id);await assert.rejects(()=>send(1,'all',null,'Changed'),/CONFLICT/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from matmove_notification_messages')).rows[0].n,1);
 });
 await t.test('role and individual targeting reach only intended accounts',async()=>{
  await session(owner);assert.equal((await send(2,'driver')).recipient_count,1);assert.equal((await send(3,'user',merchant)).recipient_count,1);
  await session(rider);assert.equal((await inbox()).items.length,1);await session(driver);assert.equal((await inbox()).items.length,2);await session(merchant);assert.equal((await inbox()).items.length,2);
 });
 await t.test('customer governance alone cannot send; the separate assignment is rechecked after revocation',async()=>{
  await session(staff);await assert.rejects(()=>send(4),/assignment required/);
  await db.exec('reset role');await db.query('update matmove_staff_access set permissions=$1 where id=$2',['["notifications"]',staff]);await session(staff);assert.equal((await send(4,'rider')).recipient_count,2);
  await db.exec('reset role');await db.query('update matmove_staff_access set is_active=false,removed_at=now() where id=$1',[staff]);await session(staff);await assert.rejects(()=>send(5),/assignment required/);await assert.rejects(()=>db.query('select matmove_admin_notification_history()'),/assignment required/);
 });
 await t.test('customers cannot send, inspect other inboxes, or write notification tables directly',async()=>{
  await session(rider);await assert.rejects(()=>send(6),/assignment required/);
  for(const q of ['select * from matmove_notification_messages','select * from matmove_notification_inbox',`insert into matmove_notification_inbox(message_id,user_id) values('${key(1)}','${driver}')`])await assert.rejects(()=>db.exec(q),/permission denied/);
  await assert.rejects(()=>db.query('select matmove_notification_customer($1)',[driver]),/permission denied/);
  const own=(await inbox()).items[0].id;await session(driver);await assert.rejects(()=>mark(own),/does not belong/);
  await session(null,'anon');await assert.rejects(inbox,/permission denied/);await assert.rejects(()=>send(6),/permission denied/);
 });
 await t.test('read state is private, idempotent and mark-all stops at the observed inbox bound',async()=>{
  await session(rider);const page=await inbox();assert.equal((await mark(page.items[0].id)).changed,1);assert.equal((await mark(page.items[0].id)).changed,0);
  await session(owner);await send(7,'rider');await session(rider);await mark(page.observed_max_id,true);assert.equal((await inbox()).unread_count,'1');
  await session(driver);assert.equal((await inbox()).unread_count,'2');
 });
 await t.test('numeric paging spans more than two pages without gaps or lexical ID ordering',async()=>{
  await session(owner);for(let n=20;n<83;n++)await send(n,'user',rider);
  await session(rider);let before=null,ids=[];for(let n=0;n<10;n++){const p=await inbox(before);ids.push(...p.items.map(i=>i.id));before=p.next_before;if(!before)break;}
  assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,66);assert.deepEqual(ids,[...ids].sort((a,b)=>Number(b)-Number(a)));assert.ok(ids.every(i=>typeof i==='string'));
 });
 await t.test('invalid content, audience, destination or staff targets fail before sending',async()=>{
  await session(owner);await assert.rejects(()=>send(90,'all',driver),/INVALID/);await assert.rejects(()=>send(91,'user',owner),/existing customer/);await assert.rejects(()=>send(92,'all',null,' '),/INVALID/);await assert.rejects(()=>send(93,'all',null,'Title','x'.repeat(2001)),/INVALID/);await assert.rejects(()=>send(94,'all',null,'Title','Body','https://bad.example'),/INVALID/);
 });
 await t.test('new accounts do not inherit old broadcasts; reruns preserve messages and read state',async()=>{
  await db.exec('reset role');const fresh='77777777-7777-4777-8777-777777777777';await db.exec(`insert into auth.users values('${fresh}');insert into profiles values('${fresh}','rider','pending');`);await session(fresh);assert.equal((await inbox()).items.length,0);
  await db.exec('reset role');await db.exec(sql);await session(rider);assert.equal((await inbox()).items.length,30);assert.equal((await inbox()).unread_count,'64');
  await session(owner);const history=(await db.query('select matmove_admin_notification_history() v')).rows[0].v;assert.equal(history.actor_id,owner);assert.equal(history.items.length,50);
 });
 }finally{await db.close();}
});
