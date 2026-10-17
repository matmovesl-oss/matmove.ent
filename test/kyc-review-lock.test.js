

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
 await pg.exec(await readFile(new URL('../docs/KYC_REVIEW_LOCK_SETUP.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../docs/KYC_REVIEW_LOCK_SETUP.sql',import.meta.url),'utf8'));
 await pg.exec(`alter table profiles enable row level security;
 create policy owner_read on profiles for select to authenticated using(id=auth.uid() or public.matmove_admin_any(ARRAY['kyc']::text[]));
 create policy owner_update on profiles for update to authenticated using(id=auth.uid() or public.matmove_admin_any(ARRAY['kyc']::text[])) with check(id=auth.uid() or public.matmove_admin_any(ARRAY['kyc']::text[]));`);
 const session=async id=>pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
 const rpc=async(name,args=[])=>{const r=await pg.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args.map(v=>Array.isArray(v)||v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].data;};
 const files=async(id,types)=>{const docs=[];for(const type of types){const path=`${id}/${type}.jpg`;await pg.query("insert into storage.objects values('kyc-documents',$1,$2) on conflict do nothing",[path,JSON.stringify({size:1234,mimetype:'image/jpeg'})]);docs.push({document_type:type,storage_path:path,file_name:type+'.jpg',file_size_bytes:1});}return docs;};
 return {pg,session,rpc,files};
}
async function withDb(fn){const f=await fixture();try{await fn(f);}finally{await f.pg.close();}}
const details=(phone='+23276000001')=>({firstName:'Test',lastName:'Member',dateOfBirth:'1990-01-01',phone,residentialAddress:'10 Freetown Road',country:'Sierra Leone'});


async function submitted(f,id=driver,role='driver',phone='+23276000002') {
 await f.session(id);
 const docs=await f.files(id,role==='driver'?['drivers_license_front','selfie']:['business_document','selfie']);
 const result=await f.rpc('matmove_submit_customer_kyc',[role,details(phone),docs]);
 const p=(await f.pg.query('select * from profiles where id=$1',[id])).rows[0];
 return {result,docs,version:Number(p.kyc_review_version)};
}
async function review(f,id,submission,version,decision,reason='') {
 return f.rpc('matmove_review_customer_kyc',[id,submission,version,decision,reason]);
}

test('approved identity cannot be edited or resubmitted; unchanged account restore and PIN changes still work',()=>withDb(async f=>{
 await f.session(rider);const docs=await f.files(rider,['identity_front','identity_back','selfie']);await f.rpc('matmove_submit_customer_kyc',['rider',details(),docs]);
 await f.pg.exec('set role authenticated');
 for(const [column,value] of [['first_name','Changed'],['full_name','Changed Name'],['phone','+23276000999'],['residential_address','Changed Road'],['date_of_birth','1992-01-01']]) {
  await assert.rejects(()=>f.pg.query(`update profiles set ${column}=$1 where id=$2`,[value,rider]),/LOCKED:/);
 }
 await f.pg.query('update profiles set passcode=$1 where id=$2',['1234',rider]);
 const restored=await f.rpc('matmove_save_customer_account',['rider','76000001']);assert.equal(restored.kycStatus,'approved');
 await assert.rejects(()=>f.rpc('matmove_save_customer_account',['rider','76000999']),/LOCKED:/);
 await assert.rejects(()=>f.rpc('matmove_submit_customer_kyc',['rider',details(),docs]),/LOCKED:/);
 const d=await f.rpc('matmove_customer_kyc_draft');assert.equal(d.locked,true);assert.equal(d.payload,null);
}));

test('approved identity lock also applies inside a definer function called by that customer',()=>withDb(async f=>{
 await f.session(rider);await f.rpc('matmove_submit_customer_kyc',['rider',details(),await f.files(rider,['identity_front','identity_back','selfie'])]);
 await f.pg.exec(`create function test_definer_edit() returns void language sql security definer as $$update profiles set first_name='Overwritten' where id=auth.uid()$$;grant execute on function test_definer_edit() to authenticated;set role authenticated;`);
 await assert.rejects(()=>f.rpc('test_definer_edit'),/LOCKED:/);
}));

test('private drafts resume the same step without overwriting the submitted profile and reject stale versions',()=>withDb(async f=>{
 await f.session(driver);await f.rpc('matmove_save_customer_account',['driver','76000002']);await f.pg.exec('set role authenticated');
 const payload={ob_role:'driver',ob_personal:{firstName:'Unfinished',dateOfBirth:'1990-01-01'},ob_docs:{license_doc:{id:`${driver}/licence.jpg`,status:'uploaded'}}};
 const first=await f.rpc('matmove_save_kyc_draft',[0,'documents',payload]);assert.equal(first.version,1);
 const loaded=await f.rpc('matmove_customer_kyc_draft');assert.equal(loaded.step,'documents');assert.equal(loaded.payload.ob_personal.firstName,'Unfinished');
 assert.equal((await f.pg.query('select first_name from profiles where id=$1',[driver])).rows[0].first_name,null);
 await f.rpc('matmove_save_kyc_draft',[1,'selfie',payload]);
 await assert.rejects(()=>f.rpc('matmove_save_kyc_draft',[1,'personal',{ob_role:'driver'}]),/CONFLICT:/);
 assert.equal((await f.rpc('matmove_customer_kyc_draft')).version,2);
}));

test('draft access is owned by the signed-in user and browser table writes and unsupported fields stay denied',()=>withDb(async f=>{
 await f.session(driver);await f.rpc('matmove_save_customer_account',['driver','76000002']);await f.pg.exec('set role authenticated');
 await f.rpc('matmove_save_kyc_draft',[0,'personal',{ob_role:'driver',ob_personal:{firstName:'Private'}}]);
 await assert.rejects(()=>f.rpc('matmove_save_kyc_draft',[1,'personal',{ob_role:'merchant'}]),/FORBIDDEN:/);
 await assert.rejects(()=>f.rpc('matmove_save_kyc_draft',[1,'documents',{ob_docs:{id:{id:`${merchant}/other.jpg`}}}]),/own account/);
 await assert.rejects(()=>f.rpc('matmove_save_kyc_draft',[1,'personal',{password:'not allowed'}]),/Unsupported/);
 await assert.rejects(()=>f.pg.query('delete from matmove_kyc_drafts'),/permission denied/);
 await f.session(merchant);await f.rpc('matmove_save_customer_account',['merchant','76000003']);
 assert.equal((await f.pg.query('select * from matmove_kyc_drafts')).rows.length,0);
 assert.deepEqual((await f.rpc('matmove_customer_kyc_draft')).payload,{});
 await f.pg.exec('reset role;set role anon');await assert.rejects(()=>f.rpc('matmove_customer_kyc_draft'),/permission denied/);
}));

test('Admin rejection saves the exact private reason, review version and audit event atomically',()=>withDb(async f=>{
 const s=await submitted(f);await f.session(admin);await f.pg.exec('set role authenticated');
 const reason='Your driving licence is blurred. Upload a clear front image.';
 const result=await review(f,driver,s.result.kyc_submission_id,s.version,'rejected',reason);assert.equal(result.reason,reason);
 const p=(await f.pg.query('select * from profiles where id=$1',[driver])).rows[0];assert.equal(p.kyc_rejection_reason,reason);assert.equal(p.kyc_reviewed_by,admin);assert.equal(Number(p.kyc_review_version),s.version+1);
 const receipt=(await f.pg.query('select * from kyc_submissions where id=$1',[s.result.kyc_submission_id])).rows[0];assert.equal(receipt.rejection_reason,reason);
 assert.equal((await f.pg.query('select * from matmove_kyc_review_events')).rows.length,1);
 await assert.rejects(()=>review(f,driver,s.result.kyc_submission_id,s.version,'approved'),/CONFLICT:/);
 assert.equal((await f.pg.query('select * from matmove_kyc_review_events')).rows.length,1);
 await f.session(driver);assert.equal((await f.rpc('matmove_customer_kyc_draft')).reason,reason);
 await f.session(merchant);assert.equal((await f.pg.query('select * from profiles where id=$1',[driver])).rows.length,0);
 assert.equal((await f.pg.query('select * from matmove_kyc_review_events')).rows.length,0);
}));

test('empty reasons, unassigned staff, stale submission IDs and direct browser decisions fail before changing status',()=>withDb(async f=>{
 const s=await submitted(f);await f.session(admin);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>review(f,driver,s.result.kyc_submission_id,s.version,'rejected',' '),/rejection reason/);
 await assert.rejects(()=>review(f,driver,merchant,s.version,'approved'),/latest submitted/);
 await assert.rejects(()=>f.pg.query("update profiles set kyc_status='rejected' where id=$1",[driver]),/secure KYC submission/);
 await assert.rejects(()=>f.pg.query("update profiles set kyc_rejection_reason='Invented' where id=$1",[driver]),/secure KYC submission/);
 await f.pg.exec('reset role');await f.pg.query("update test_staff_assignments set is_active=false where id=$1",[admin]);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>review(f,driver,s.result.kyc_submission_id,s.version,'approved'),/KYC review access/);
 await f.pg.exec('reset role');assert.equal((await f.pg.query('select kyc_status from profiles where id=$1',[driver])).rows[0].kyc_status,'submitted');
 assert.equal((await f.pg.query('select * from matmove_kyc_review_events')).rows.length,0);
}));

test('corrected resubmission clears the prior rejection, commits complete details and invalidates the old Admin screen',()=>withDb(async f=>{
 const s=await submitted(f);await f.session(admin);await review(f,driver,s.result.kyc_submission_id,s.version,'resubmission_required','Upload your current driving licence.');
 await f.session(driver);await f.pg.exec('set role authenticated');
 await f.rpc('matmove_save_kyc_draft',[0,'review',{ob_role:'driver',ob_personal:{firstName:'Corrected'}}]);
 const corrected=await f.rpc('matmove_submit_customer_kyc',['driver',{...details('+23276000002'),firstName:'Corrected'},s.docs]);
 assert.notEqual(corrected.kyc_submission_id,s.result.kyc_submission_id);
 const p=(await f.pg.query('select * from profiles where id=$1',[driver])).rows[0];assert.equal(p.first_name,'Corrected');assert.equal(p.kyc_status,'submitted');assert.equal(p.kyc_rejection_reason,null);
 assert.equal((await f.pg.query('select * from matmove_kyc_drafts')).rows.length,0);
 await f.session(admin);await assert.rejects(()=>review(f,driver,s.result.kyc_submission_id,s.version+1,'approved'),/CONFLICT:/);
}));

test('approval while a customer has a draft deletes that draft and forbids later saves and identity changes',()=>withDb(async f=>{
 const s=await submitted(f);await f.session(driver);await f.rpc('matmove_save_kyc_draft',[0,'personal',{ob_role:'driver',ob_personal:{firstName:'Draft'}}]);
 await f.session(admin);const result=await review(f,driver,s.result.kyc_submission_id,s.version,'approved');assert.equal(result.status,'approved');
 await f.session(driver);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.rpc('matmove_save_kyc_draft',[1,'personal',{ob_role:'driver'}]),/LOCKED:/);
 await assert.rejects(()=>f.pg.query("update profiles set first_name='Draft' where id=$1",[driver]),/LOCKED:/);
 assert.equal((await f.rpc('matmove_customer_kyc_draft')).locked,true);
 assert.equal((await f.pg.query('select * from matmove_kyc_drafts')).rows.length,0);
}));

test('missing uploaded evidence cannot be approved and Admin queue omits the customer PIN',()=>withDb(async f=>{
 const s=await submitted(f);await f.pg.query('delete from storage.objects where name=$1',[s.docs[0].storage_path]);
 await f.session(admin);await f.pg.exec('set role authenticated');
 await assert.rejects(()=>review(f,driver,s.result.kyc_submission_id,s.version,'approved'),/missing from storage/);
 const queue=await f.rpc('matmove_admin_kyc_queue');const entry=queue.find(row=>row.profile_id===driver);
 assert.equal(entry.submission_id,s.result.kyc_submission_id);assert.equal('passcode' in entry.profile,false);
 await f.session(driver);await assert.rejects(()=>f.rpc('matmove_admin_kyc_queue'),/KYC review access/);
}));


test('approved customers see a locked workspace instead of editable KYC; unapproved forms wait for owned draft confirmation', async () => {
 const {build}=await import('esbuild');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');
 const {pathToFileURL}=await import('node:url');
 const React=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const dir=await mkdtemp(join(process.cwd(),'.kyc-lock-ui-'));
 try {
  const out=join(dir,'workspace.mjs');
  await build({entryPoints:['src/pages/OnboardingPages.tsx'],tsconfig:'tsconfig.app.json',outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',external:['react','react/*','react-dom/*','lucide-react'],plugins:[{name:'workspace-fixture',setup(b){
   b.onResolve({filter:/^@\/context\/AuthContext$/},()=>({path:'auth',namespace:'fixture'}));
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'fixture'}));
   b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='auth'?'export const useAuth=()=>globalThis.__kycWorkspaceAuth;':args.path==='db'?'export const supabase={};':'export const useNavigate=()=>()=>{};export const useLocation=()=>({pathname:"/onboarding/personal",search:""});export const Link=()=>null;'}));
  }}]});
  const {KycWorkspace}=await import(pathToFileURL(out));
  globalThis.__kycWorkspaceAuth={session:{user:{id:rider},roles:['rider'],kycStatus:'approved'}};
  const render=()=>renderToStaticMarkup(React.createElement(KycWorkspace,null,React.createElement('input',{name:'editable-identity'})));
  const locked=render();assert.match(locked,/Verified identity — locked/);assert.match(locked,/Contact MatMove/);assert.doesNotMatch(locked,/editable-identity|Save &amp; lock/);
  globalThis.__kycWorkspaceAuth.session.kycStatus='not_started';
  const pending=render();assert.match(pending,/Loading your verification draft/);assert.doesNotMatch(pending,/editable-identity/);
 } finally {delete globalThis.__kycWorkspaceAuth;await rm(dir,{recursive:true,force:true});}
});
