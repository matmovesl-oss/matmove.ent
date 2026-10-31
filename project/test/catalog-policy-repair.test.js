import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const merchant='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const rider='33333333-3333-4333-8333-333333333333';
const staff='44444444-4444-4444-8444-444444444444';
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const quote=x=>'"'+x.replaceAll('"','""')+'"';

test('audited Storage and scheduled-service repairs preserve ownership, existing data and other policies', async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});
 try {
  const fixture=JSON.parse(await readFile('test/fixtures/catalog-production-policies.json','utf8'));
  await pg.exec(`create role authenticated;create role anon;create role service_role bypassrls;
   create schema auth;create schema storage;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.role() returns text language sql stable as $$select current_user::text$$;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   create table profiles(id uuid primary key,role text);
   insert into profiles values('${merchant}','merchant'),('${other}','merchant'),('${rider}','rider'),('${staff}','merchant');
   create table matmove_staff_access(id uuid,is_active boolean,removed_at timestamptz);
   insert into matmove_staff_access values('${staff}',true,null);
   create function matmove_preferences_role(uuid) returns text language sql security definer as $$select role from profiles where id=$1 and id=auth.uid()$$;
   create table products(id uuid primary key default gen_random_uuid(),merchant_id uuid,name text,price numeric,description text,image_url text,whatsapp_number text,created_at timestamptz default now());
   create table matmove_merchant_payments(id uuid default gen_random_uuid(),merchant_id uuid,items jsonb);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,unique(bucket_id,name));
   alter table storage.objects enable row level security;
   grant usage on schema public,auth,storage to authenticated,anon,service_role;
   grant all on products,storage.objects to authenticated,anon;
  `);
  await pg.exec(await readFile('docs/PRODUCT_CATALOG_SETUP.sql','utf8'));
  // Replace generated fixture policies with every policy from the user's production audit.
  const installed=await pg.query("select policyname from pg_policies where schemaname='storage' and tablename='objects'");
  for(const row of installed.rows) await pg.exec('drop policy '+quote(row.policyname)+' on storage.objects');
  for(const p of fixture.storage_policies) await pg.exec(`create policy ${quote(p.policyname)} on storage.objects as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''}`);
  const repair=await readFile('docs/PRODUCT_PHOTO_POLICY_FIX.sql','utf8');
  const serviceRepair=await readFile('docs/SCHEDULED_SERVICE_FIX.sql','utf8');
  const asUser=async(u,fn,role='authenticated')=>{
   await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[u||'']);await pg.exec('set role '+quote(role));
   try{return await fn();}finally{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub','',false)");}
  };
  const upload=(u,n,separator='/')=>pg.query("insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values('product_images',$1,$2::uuid,$2::text,'{\"mimetype\":\"image/webp\",\"size\":123}')",[u+separator+id(n)+'.webp',u]);
  const policies=()=>pg.query("select policyname,cmd,qual,with_check,roles,permissive from pg_policies where schemaname='storage' and tablename='objects' and policyname<>'matmove_product_image_owner_guard' order by policyname");
  const untouched=(await policies()).rows;
  await t.test('reproduces the actual old guard: slash uploads fail although the current catalog allows them',async()=>{
   await assert.rejects(()=>asUser(merchant,()=>upload(merchant,1)),/row-level security/);
   await asUser(merchant,()=>upload(merchant,2,'-'));
  });
  await t.test('the repaired guard accepts both owned path formats and confirms three photos in a real catalog save',async()=>{
   const result=await pg.exec(repair);assert.equal(result.at(-1).rows[0].both_owned_photo_paths_ready,true);
   for(const n of [1,3]) await asUser(merchant,()=>upload(merchant,n));
   const paths=[merchant+'/'+id(1)+'.webp',merchant+'-'+id(2)+'.webp',merchant+'/'+id(3)+'.webp'];
   const result2=await asUser(merchant,()=>pg.query('select matmove_catalog_save($1,null,$2,$3,$4,$5,$6,$7,true) result',[id(100),'Three photos','2399.00','SLE','Fiber internet','+23277123456',paths]));
   assert.deepEqual(result2.rows[0].result.image_paths,paths);
  });
  await t.test('foreign paths, anonymous callers, riders and active staff cannot upload catalog images',async()=>{
   for(const [actor,target,role]of [[other,merchant,'authenticated'],[rider,rider,'authenticated'],[staff,staff,'authenticated'],[null,merchant,'anon']])
    await assert.rejects(()=>asUser(actor,()=>upload(target,10),role),/row-level security/);
   await asUser(other,()=>upload(other,11));
  });
  await t.test('unrelated bucket policies, overwrite protections, bucket limits and existing image records survive reruns',async()=>{
   const objects=(await pg.query('select * from storage.objects order by name')).rows;
   const bucket=(await pg.query("select * from storage.buckets where id='product_images'")).rows;
   await pg.exec(repair);await pg.exec(repair);
   assert.deepEqual((await policies()).rows,untouched);
   assert.deepEqual((await pg.query('select * from storage.objects order by name')).rows,objects);
   assert.deepEqual((await pg.query("select * from storage.buckets where id='product_images'")).rows,bucket);
   assert.equal((await asUser(merchant,()=>pg.query("update storage.objects set name='overwritten' where bucket_id='product_images' returning id"))).rows.length,0);
   assert.equal((await asUser(merchant,()=>pg.query("delete from storage.objects where bucket_id='product_images' returning id"))).rows.length,0);
   await asUser(merchant,()=>pg.query("insert into storage.objects(bucket_id,name,owner,owner_id) values('matmove-profile-photos',$1,$2::uuid,$2::text)",[merchant+'/avatar.webp',merchant]));
   await assert.rejects(()=>asUser(other,()=>pg.query("insert into storage.objects(bucket_id,name,owner,owner_id) values('matmove-profile-photos',$1,$2::uuid,$2::text)",[merchant+'/foreign.webp',other])),/row-level security/);
   assert.equal((await pg.query("select relrowsecurity from pg_class where oid='storage.objects'::regclass")).rows[0].relrowsecurity,true);
  });
  await t.test('missing merchant restrictions abort the repair without weakening the ownership guard',async()=>{
   const before=(await pg.query("select with_check from pg_policies where policyname='matmove_product_image_owner_guard'")).rows;
   await pg.exec('drop policy matmove_catalog_upload_scope on storage.objects');
   await assert.rejects(()=>pg.exec(repair),/merchant-only catalog guard is missing/);await pg.exec('rollback');
   assert.deepEqual((await pg.query("select with_check from pg_policies where policyname='matmove_product_image_owner_guard'")).rows,before);
   const p=fixture.storage_policies.find(x=>x.policyname==='matmove_catalog_upload_scope');
   await pg.exec(`create policy ${quote(p.policyname)} on storage.objects as ${p.permissive} for ${p.cmd} to ${p.roles.map(quote).join(',')} with check (${p.with_check})`);
  });
  await pg.exec(`create table bookings(id uuid primary key default gen_random_uuid(),service_type text, status text,passenger_count int check(passenger_count between 1 and 3));
   alter table bookings add constraint bookings_service_type_check ${fixture.service_constraint};
   insert into bookings(service_type,status,passenger_count) values('ride','accepted',3),('delivery','completed',1),('truck','pending',1),('bus','cancelled',3);
   alter table bookings enable row level security;
  `);
  await t.test('scheduled requests fail before repair and work afterward, retaining all four legacy services',async()=>{
   const old=(await pg.query('select * from bookings order by id')).rows;
   await assert.rejects(()=>pg.exec("insert into bookings(service_type,status,passenger_count) values('scheduled','pending_admin',3)"),/bookings_service_type_check/);
   const r=await pg.exec(serviceRepair);assert.equal(r.at(-1).rows[0].scheduled_service_ready,true);
   assert.deepEqual((await pg.query('select * from bookings order by id')).rows,old);
   await pg.exec("insert into bookings(service_type,status,passenger_count) values('scheduled','pending_admin',3)");
   await assert.rejects(()=>pg.exec("insert into bookings(service_type,status,passenger_count) values('unknown','pending',1)"),/bookings_service_type_check/);
   await assert.rejects(()=>pg.exec("insert into bookings(service_type,status,passenger_count) values('scheduled','pending_admin',4)"),/check constraint/);
   const all=(await pg.query('select * from bookings order by id')).rows;
   await pg.exec(serviceRepair);assert.deepEqual((await pg.query('select * from bookings order by id')).rows,all);
   assert.equal((await pg.query("select relrowsecurity from pg_class where oid='bookings'::regclass")).rows[0].relrowsecurity,true);
  });
  await t.test('unexpected service constraints stop the migration atomically instead of overwriting newer rules',async()=>{
   await pg.exec("alter table bookings drop constraint bookings_service_type_check;alter table bookings add constraint bookings_service_type_check check(service_type in ('ride','delivery','truck','bus','scheduled','rental'))");
   await assert.rejects(()=>pg.exec(serviceRepair),/differs from the reviewed/);await pg.exec('rollback');
   await pg.exec("insert into bookings(service_type,status,passenger_count) values('rental','pending',1)");
  });
 }finally{await pg.close();}
});
