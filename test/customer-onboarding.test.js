
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {assertAllowed,authorize} from '../server/wallet-security.js';
import {normalizeCustomerPhone,resolveCustomerRole,customerCapabilities} from '../shared/customer-access.js';
const rider='11111111-1111-4111-8111-111111111111',driver='22222222-2222-4222-8222-222222222222',merchant='33333333-3333-4333-8333-333333333333',admin='44444444-4444-4444-8444-444444444444';
const sql=()=>readFile(new URL('../docs/CUSTOMER_ONBOARDING_SETUP.sql',import.meta.url),'utf8');
async function fixture(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create type user_role as enum('rider','driver','merchant','admin','corporate');
 create type kyc_status as enum('draft','submitted','under_review','approved','rejected');
 create table profiles(id uuid primary key references auth.users(id),first_name text,last_name text,phone text unique,email text unique,date_of_birth date,nationality text,country text default 'Sierra Leone',residential_address text,city text,kyc_status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now(),full_name text,phone_number text,address text,role text check(role in ('rider','driver','merchant','admin','corporate')),vehicle_type text,plate_number text,driver_license_no text,business_name text,business_type text,tax_id text,id_card_url text,selfie_url text,license_doc_url text,business_doc_url text,operating_region text,id_card_back_url text,passcode text,is_wallet_frozen boolean not null default false);
 create table user_roles(profile_id uuid references profiles(id),role user_role,created_at timestamptz default now(),primary key(profile_id,role));
 create table kyc_submissions(id uuid primary key default gen_random_uuid(),profile_id uuid references profiles(id),target_role user_role,status kyc_status default 'draft',rejection_reason text,submitted_at timestamptz,reviewed_at timestamptz,reviewer_id uuid,created_at timestamptz default now());
 create table kyc_documents(id uuid primary key default gen_random_uuid(),submission_id uuid references kyc_submissions(id),document_type text not null,storage_path text not null,file_name text,file_size_bytes bigint,created_at timestamptz default now());
 create table wallets(id uuid primary key default gen_random_uuid(),user_id uuid,currency text,balance numeric default 0,is_frozen boolean default false,monime_account_id text);
 create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
 create table test_staff_assignments(id uuid primary key,is_active boolean,permissions jsonb);
 insert into test_staff_assignments values('${admin}',true,'["kyc"]');
 create function matmove_admin_any(p_sections text[]) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.test_staff_assignments a where a.id=auth.uid() and a.is_active and exists(select 1 from unnest(p_sections) s where a.permissions ? s))$$;

 create function ensure_matmove_wallets(p_id uuid) returns void language plpgsql security definer as $$begin insert into wallets(user_id,currency) select p_id,c from unnest(array['SLE','USD']) c where not exists(select 1 from wallets w where w.user_id=p_id and w.currency=c);end;$$;
 insert into auth.users(id,email) values('${rider}','rider@example.com'),('${driver}','driver@example.com'),('${merchant}','merchant@example.com'),('${admin}','admin@example.com');
 insert into profiles(id,email) select id,email from auth.users;
 insert into user_roles(profile_id,role) values('${rider}','rider'),('${admin}','admin');
 update profiles set role='admin' where id='${admin}';

 -- Exact legacy trigger supplied from the live database.
 create table admins(id uuid primary key);
 insert into admins values('${admin}');
 create function prevent_unauthorized_profile_role_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $legacy$
 declare v_caller_id uuid;
 begin
  v_caller_id:=auth.uid();
  if v_caller_id is null then
   if new.role is distinct from old.role then raise exception 'Profile role changes require authorized administration';end if;
   return new;
  end if;
  if new.role is not distinct from old.role then return new;end if;
  if not exists(select 1 from public.admins a where a.id=v_caller_id) then raise exception 'Profile role changes require Admin authorization';end if;
  return new;
 end;
 $legacy$;
 create trigger prevent_unauthorized_profile_role_change before update of role on profiles for each row execute function prevent_unauthorized_profile_role_change();
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant all on profiles,user_roles,kyc_submissions,kyc_documents to authenticated;
 `);
 await assert.rejects(()=>pg.query("update profiles set role='rider' where id=$1",[rider]),/Profile role changes require authorized administration/);
 const migration=await sql();await pg.exec(migration);await pg.exec(migration);
 const session=async id=>pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 const rpc=async(name,args=[])=>{const r=await pg.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args.map(v=>Array.isArray(v)||v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].data;};
 const files=async(id,types)=>{const docs=[];for(const type of types){const path=`${id}/${type}.jpg`;await pg.query("insert into storage.objects values('kyc-documents',$1,$2) on conflict do nothing",[path,JSON.stringify({size:1234,mimetype:'image/jpeg'})]);docs.push({document_type:type,storage_path:path,file_name:type+'.jpg',file_size_bytes:1});}return docs;};
 return {pg,session,rpc,files};
}
async function withDb(fn){const f=await fixture();try{await fn(f);}finally{await f.pg.close();}}
const details=(phone='+23276000001')=>({firstName:'Test',lastName:'Member',dateOfBirth:'1990-01-01',phone,residentialAddress:'10 Freetown Road',country:'Sierra Leone'});

test('actual schema supports account setup without KYC, preserves Auth email, synchronizes roles and provisions empty wallets',()=>withDb(async f=>{
 await f.session(rider);const s=await f.rpc('matmove_save_customer_account',['rider','76 000 001']);
 assert.deepEqual(s.roles,['rider']);assert.equal(s.user.email,'rider@example.com');assert.equal(s.user.phone,'+23276000001');assert.equal(s.kycStatus,'not_started');
 const p=(await f.pg.query('select * from profiles where id=$1',[rider])).rows[0];assert.equal(p.role,'rider');assert.equal(customerCapabilities(p).load,true);assert.throws(()=>assertAllowed(p,[],'payout'),/Verify your identity/);assert.throws(()=>assertAllowed(p,[],'transfer'),/Verify your identity/);
 assert.equal((await f.pg.query('select * from wallets where user_id=$1',[rider])).rows.length,2);
 assert.equal((await f.pg.query('select * from kyc_submissions')).rows.length,0);
 await f.rpc('matmove_save_customer_account',['rider','+23276000001']);assert.equal((await f.pg.query('select * from wallets where user_id=$1',[rider])).rows.length,2);
}));

test('role selection cannot create admin access, switch an assigned role, or convert an administrative profile',()=>withDb(async f=>{
 await f.session(rider);await assert.rejects(()=>f.rpc('matmove_save_customer_account',['admin','+23276000001']),/Choose rider/);await assert.rejects(()=>f.rpc('matmove_save_customer_account',['driver','+23276000001']),/already assigned/);
 await f.session(admin);await assert.rejects(()=>f.rpc('matmove_save_customer_account',['rider','+23276000004']),/Administrative/);
 await f.pg.exec(`set role anon`);await assert.rejects(()=>f.rpc('matmove_save_customer_account',['rider','+23276000001']),/permission denied/);
}));

test('rider completion checks owned real uploads, uses storage size and approves once without duplicate documents',()=>withDb(async f=>{
 await f.session(rider);const docs=await f.files(rider,['identity_front','identity_back','selfie']);
 const result=await f.rpc('matmove_submit_customer_kyc',['rider',details(),docs]);assert.equal(result.kyc_status,'approved');
 const p=(await f.pg.query('select * from profiles where id=$1',[rider])).rows[0];assert.equal(p.kyc_status,'approved');assert.equal(p.id_card_url,`${rider}/identity_front.jpg`);assert.equal(p.id_card_back_url,`${rider}/identity_back.jpg`);assert.equal(p.selfie_url,`${rider}/selfie.jpg`);assert.doesNotThrow(()=>assertAllowed(p,[],'transfer'));
 assert.deepEqual((await f.pg.query('select distinct file_size_bytes from kyc_documents')).rows,[{file_size_bytes:1234}]);
 await f.rpc('matmove_submit_customer_kyc',['rider',details(),docs]);assert.equal((await f.pg.query('select * from kyc_documents')).rows.length,3);
}));

test('missing, cross-user or incomplete uploads cannot approve a rider and failures roll back account changes',()=>withDb(async f=>{
 await f.session(rider);const docs=await f.files(rider,['identity_front','identity_back','selfie']);
 await assert.rejects(()=>f.rpc('matmove_submit_customer_kyc',['rider',details(),docs.slice(0,2)]),/selfie/);
 await assert.rejects(()=>f.rpc('matmove_submit_customer_kyc',['rider',details(),[{...docs[0],storage_path:`${driver}/front.jpg`},...docs.slice(1)]]),/belonging/);
 await f.pg.query("delete from storage.objects where name=$1",[docs[0].storage_path]);await assert.rejects(()=>f.rpc('matmove_submit_customer_kyc',['rider',details(),docs]),/could not be verified/);
 assert.notEqual((await f.pg.query('select kyc_status from profiles where id=$1',[rider])).rows[0].kyc_status,'approved');assert.equal((await f.pg.query('select * from kyc_submissions')).rows.length,0);
}));

test('drivers and merchants may finish onboarding but all wallet movement remains pending Admin approval',()=>withDb(async f=>{
 for(const [id,role,phone,types] of [[driver,'driver','+23276000002',['drivers_license_front','selfie']],[merchant,'merchant','+23276000003',['business_document','selfie']]]){
  await f.session(id);const docs=await f.files(id,types);const result=await f.rpc('matmove_submit_customer_kyc',[role,details(phone),docs]);assert.equal(result.kyc_status,'submitted');
  const p=(await f.pg.query('select * from profiles where id=$1',[id])).rows[0];assert.equal(customerCapabilities(p).dashboard,true);assert.doesNotThrow(()=>assertAllowed(p,[],'read'));
  for(const action of ['load','create','payout','transfer'])assert.throws(()=>assertAllowed(p,[],action),/Approval pending/);
  await f.pg.query("update profiles set kyc_status='approved' where id=$1",[id]);p.kyc_status='approved';assert.doesNotThrow(()=>assertAllowed(p,[],'load'));
 }
}));

test('browser writes cannot forge verification, customer roles or approval receipts',()=>withDb(async f=>{
 await f.session(rider);await f.rpc('matmove_save_customer_account',['rider','+23276000001']);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.pg.query("update profiles set kyc_status='approved' where id=$1",[rider]),/authorized server/);
 await assert.rejects(()=>f.pg.query("update profiles set role='driver' where id=$1",[rider]),/authorized server/);
 await assert.rejects(()=>f.pg.query("insert into user_roles values($1,'driver',now())",[rider]),/permission denied/);
 await assert.rejects(()=>f.pg.query("insert into kyc_submissions(profile_id,status) values($1,'approved')",[rider]),/permission denied/);
 await f.pg.exec('reset role');await f.pg.query('update profiles set is_wallet_frozen=true where id=$1',[rider]);
 const p=(await f.pg.query('select * from profiles where id=$1',[rider])).rows[0];assert.throws(()=>assertAllowed(p,[],'load'),e=>e.status===423);
}));

test('phone normalization and role resolution reject ambiguous identities and preserve explicit customer membership',()=>{
 assert.equal(normalizeCustomerPhone('076 000 001'),'+23276000001');assert.equal(normalizeCustomerPhone('23276000001'),'+23276000001');
 assert.throws(()=>normalizeCustomerPhone('+232467998'));
 assert.equal(resolveCustomerRole({role:null},[{role:'rider'}]),'rider');assert.equal(resolveCustomerRole({role:'admin'},[{role:'rider'}]),null);assert.equal(resolveCustomerRole({role:'driver'},[{role:'rider'}]),null);
});

test('wallet API reads trusted customer membership and blocks unverified transfers before any provider call',async()=>{
 const db={auth:{getUser:async token=>{assert.equal(token,'token');return {data:{user:{id:rider}},error:null};}},from(table){const rows=table==='user_roles'?[{role:'rider'}]:[];const q={select(){return this;},eq(){return this;},single:async()=>({data:{id:rider,role:null,kyc_status:'not_started',is_wallet_frozen:false},error:null}),then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return q;}};
 const request=()=>({method:'POST',headers:{authorization:'Bearer token'},body:{}});
 const context=await authorize(request(),'read',{db});assert.equal(context.profile.role,'rider');
 await assert.rejects(()=>authorize(request(),'transfer',{db}),e=>e.status===403&&e.code==='KYC_REQUIRED');
 assert.doesNotThrow(()=>assertAllowed({role:'rider',kyc_status:'not_started'},[],'purchase'));
});


test('existing Admin approval flow preserves document links and synchronizes the reviewed business submission',()=>withDb(async f=>{
 await f.session(driver);const docs=await f.files(driver,['drivers_license_front','selfie']);
 const result=await f.rpc('matmove_submit_customer_kyc',['driver',details('+23276000002'),docs]);
 assert.equal((await f.pg.query('select license_doc_url from profiles where id=$1',[driver])).rows[0].license_doc_url,`${driver}/drivers_license_front.jpg`);
 await f.session(admin);await f.pg.exec('set role authenticated');
 await f.pg.query("update profiles set kyc_status='approved' where id=$1",[driver]);
 const submission=(await f.pg.query('select * from kyc_submissions where id=$1',[result.kyc_submission_id])).rows[0];
 await assert.rejects(()=>f.pg.query('update profiles set kyc_status=null where id=$1',[driver]),/assigned KYC reviewer/);
 assert.equal(submission.status,'approved');assert.equal(submission.reviewer_id,admin);assert.ok(submission.reviewed_at);
 await assert.rejects(()=>f.pg.query("update profiles set role='merchant' where id=$1",[driver]),/authorized server/);
 await assert.rejects(()=>f.pg.query('update profiles set is_wallet_frozen=true where id=$1',[driver]),/authorized server/);
 await f.pg.query("update profiles set kyc_status='resubmission_required' where id=$1",[driver]);
 const rejected=(await f.pg.query('select * from kyc_submissions where id=$1',[result.kyc_submission_id])).rows[0];assert.equal(rejected.status,'rejected');assert.match(rejected.rejection_reason,/Resubmission required/);
}));

test('deactivated or unassigned staff cannot approve KYC, and a skipped KYC record cannot be approved from the old screen',()=>withDb(async f=>{
 await f.session(driver);await f.rpc('matmove_submit_customer_kyc',['driver',details('+23276000002'),await f.files(driver,['drivers_license_front','selfie'])]);
 await f.session(admin);await f.pg.query("update test_staff_assignments set permissions='[]' where id=$1",[admin]);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.pg.query("update profiles set kyc_status='approved' where id=$1",[driver]),/assigned KYC reviewer/);
 await f.pg.exec('reset role');await f.pg.query("update test_staff_assignments set permissions=$1::jsonb,is_active=false where id=$2",[JSON.stringify(["kyc"]),admin]);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.pg.query("update profiles set kyc_status='approved' where id=$1",[driver]),/assigned KYC reviewer/);
 await f.pg.exec('reset role');await f.pg.query('update test_staff_assignments set is_active=true where id=$1',[admin]);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.pg.query("update profiles set kyc_status='approved' where id=$1",[merchant]),/submitted verification record/);
}));


test('legacy role trigger accepts secured onboarding with a real browser role and blocks direct changes, even for a legacy admin row',()=>withDb(async f=>{
 await f.session(driver);await f.pg.exec('set role authenticated');
 const result=await f.rpc('matmove_save_customer_account',['driver','+23276000002']);assert.deepEqual(result.roles,['driver']);
 await assert.rejects(()=>f.rpc('matmove_save_customer_account',['merchant','+23276000002']),/already assigned/);
 await assert.rejects(()=>f.pg.query("update profiles set role='admin' where id=$1",[driver]),/authorized server/);
 await f.session(admin);
 await assert.rejects(()=>f.pg.query("update profiles set role='merchant' where id=$1",[driver]),/authorized server/);
 await f.pg.exec('reset role');
 const guard=(await f.pg.query("select prosecdef from pg_proc where oid='public.prevent_unauthorized_profile_role_change()'::regprocedure")).rows[0];assert.equal(guard.prosecdef,false);
 // Isolate the legacy guard to confirm it is safe even without the second onboarding guard.
 await f.pg.exec('alter table profiles disable trigger matmove_customer_protect_approval;set role authenticated');
 await assert.rejects(()=>f.pg.query("update profiles set role='merchant' where id=$1",[driver]),/authorized server function/);
 await f.pg.query('update profiles set role=role where id=$1',[driver]);
 await f.pg.exec('reset role;alter table profiles enable trigger matmove_customer_protect_approval');
}));
