
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const merchant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',rider='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const uuid=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const photo=(n=1,u=merchant)=>`${u}/${uuid(n)}.webp`;
test('Product catalog preserves existing listings and secures owned three-image edits, currency and availability',async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB','maintenance_work_mem=8MB']});
 try{
 await pg.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text);insert into profiles values('${merchant}','merchant'),('${other}','merchant'),('${rider}','rider');
 create table matmove_staff_access(id uuid,is_active boolean,removed_at timestamptz);
 create function matmove_preferences_role(uuid) returns text language sql security definer as $$select role from profiles where id=$1 and id=auth.uid()$$;
 create table products(id uuid primary key default gen_random_uuid(),merchant_id uuid,name text,price numeric,description text,image_url text,whatsapp_number text,created_at timestamptz default now());
 insert into products(id,merchant_id,name,price,image_url) values('${id}','${merchant}','Legacy rice',100,'https://example.invalid/old-product.jpg');
 create table matmove_merchant_payments(id uuid default gen_random_uuid(),merchant_id uuid,items jsonb);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table products enable row level security;alter table storage.objects enable row level security;
 create policy old_products_broad on products for all to authenticated,anon using(true) with check(true);
 create policy old_storage_broad on storage.objects for all to authenticated using(true) with check(true);
 grant usage on schema public,auth,storage to authenticated,anon,service_role;
 grant all on products,storage.objects to authenticated,anon;
 `);
 const sql=await readFile('docs/PRODUCT_CATALOG_SETUP.sql','utf8');await pg.exec(sql);await pg.exec(sql);
 const runAs=async(u,fn,role='authenticated')=>{await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[u||'']);await pg.exec('set role '+role);try{return await fn();}finally{await pg.exec('reset role');await pg.exec("select set_config('request.jwt.claim.sub','',false)");}};
 const save=async(patch={})=>{const p={p_id:uuid(10),p_expected:null,p_name:'Rice',p_price:'1000.50',p_currency:'SLE',p_description:'Good rice',p_whatsapp:'+23277123456',p_image_paths:[],p_available:true,...patch};return(await pg.query(`select matmove_catalog_save(${Object.values(p).map((_,i)=>'$'+(i+1)).join(',')}) v`,Object.values(p))).rows[0].v;};
 const upload=async(n=1,u=merchant,metadata={mimetype:'image/webp',size:100})=>pg.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('product_images',$1,$2,$3)",[photo(n,u),u,metadata]);
 await t.test('photo repair restores a pre-existing private catalog bucket without broadening KYC buckets',async()=>{
  await pg.exec("update storage.buckets set public=false where id='product_images'");
  const repair=await readFile('docs/PRODUCT_PHOTO_REPAIR.sql','utf8');await pg.exec(repair);await pg.exec(repair);
  assert.equal((await pg.query("select public from storage.buckets where id='product_images'")).rows[0].public,true);
  await runAs(merchant,()=>upload(900));
  await assert.rejects(()=>runAs(rider,()=>upload(901,rider)),/row-level security/);
 });
 await t.test('reruns preserve legacy price and image while defaulting currency and availability correctly',async()=>{
  const p=(await pg.query('select * from products where id=$1',[id])).rows[0];assert.equal(p.currency,'SLE');assert.equal(p.is_available,true);assert.equal(p.image_url,'https://example.invalid/old-product.jpg');assert.equal(p.price,'100');assert.deepEqual(p.image_paths,[]);assert.equal(p.catalog_version,0);
 });
 await t.test('an owning merchant creates and edits a product with exactly three confirmed owned image paths',async()=>{
  for(let i=1;i<=3;i++)await runAs(merchant,()=>upload(i));
  const p=await runAs(merchant,()=>save({p_image_paths:[photo(1),photo(2),photo(3)]}));assert.equal(p.price,'1000.50');assert.equal(p.currency,'SLE');assert.equal(p.image_paths.length,3);assert.equal(p.catalog_version,'0');
  const edited=await runAs(merchant,()=>save({p_expected:0,p_name:'Updated rice',p_currency:'USD',p_available:false,p_image_paths:[photo(1),photo(2)]}));assert.equal(edited.catalog_version,'1');assert.equal(edited.currency,'USD');assert.equal(edited.is_available,false);assert.equal(edited.image_url,null);
 });
 await t.test('a repeated create recovers its exact saved UUID but changed payloads and stale edits conflict',async()=>{
  const p=await runAs(merchant,()=>save({p_id:uuid(11)}));const again=await runAs(merchant,()=>save({p_id:uuid(11)}));assert.deepEqual(again,p);
  await assert.rejects(()=>runAs(merchant,()=>save({p_id:uuid(11),p_price:'2'})),/different details/);
  await assert.rejects(()=>runAs(merchant,()=>save({p_expected:0})),/changed/);
 });
 await t.test('currency, cents, invalid names and more than three, duplicated or missing uploads are rejected',async()=>{
  for(const patch of [{p_currency:'EUR'},{p_price:'1.001'},{p_price:'0'},{p_name:''},{p_image_paths:[photo(1),photo(1)]},{p_image_paths:[photo(1),photo(2),photo(3),photo(4)]},{p_image_paths:[photo(999)]},{p_image_paths:[null]}])await assert.rejects(()=>runAs(merchant,()=>save({p_id:uuid(30),...patch})),/INVALID/);
 });
 await t.test('forged ownership, invalid metadata and non-owned image paths cannot become product images',async()=>{
  await runAs(other,()=>upload(1,other));await assert.rejects(()=>runAs(merchant,()=>save({p_id:uuid(31),p_image_paths:[photo(1,other)]})),/INVALID/);
  for(const [n,metadata]of [[5,{mimetype:'image/svg+xml',size:100}],[6,{mimetype:'image/webp',size:0}],[7,{mimetype:'image/webp',size:5242881}]]){await runAs(merchant,()=>upload(n,merchant,metadata));await assert.rejects(()=>runAs(merchant,()=>save({p_id:uuid(31),p_image_paths:[photo(n)]})),/INVALID/);}
 });
 await t.test('riders, active staff and anonymous callers cannot save or forge merchant products',async()=>{
  await assert.rejects(()=>runAs(rider,()=>save()),/Merchant/);await assert.rejects(()=>runAs(other,()=>save({p_id:id,p_expected:0})),/owning merchant/);
  await pg.exec(`insert into matmove_staff_access values('${other}',true,null)`);await assert.rejects(()=>runAs(other,()=>save()),/Merchant/);await pg.exec('delete from matmove_staff_access');
  await assert.rejects(()=>runAs(null,()=>save(),'anon'),/permission denied/);
  await pg.exec('grant insert on products to anon');await assert.rejects(()=>runAs(null,()=>pg.query("insert into products(merchant_id,name,price) values($1,'Forged',1)",[merchant]),'anon'),/row-level security/);
 });
 await t.test('old broad grants cannot update or delete another merchant product, forge versions or overwrite photos',async()=>{
  const changed=await runAs(other,()=>pg.query('update products set price=1 where id=$1 returning id',[id]));assert.equal(changed.rows.length,0);const removed=await runAs(other,()=>pg.query('delete from products where id=$1 returning id',[id]));assert.equal(removed.rows.length,0);
  const forged=await runAs(merchant,()=>pg.query('update products set merchant_id=$1 where id=$2 returning id',[other,id]));assert.equal(forged.rows.length,0);
  await runAs(merchant,()=>pg.query('update products set catalog_version=999,name=\'Legacy revised\' where id=$1',[id]));assert.equal((await pg.query('select catalog_version from products where id=$1',[id])).rows[0].catalog_version,0);const versioned=await runAs(merchant,()=>save({p_id:id,p_expected:0}));assert.equal(versioned.catalog_version,'1');
  const updated=await runAs(merchant,()=>pg.query("update storage.objects set metadata='{}' where name=$1 returning id",[photo(1)]));assert.equal(updated.rows.length,0);const deleted=await runAs(merchant,()=>pg.query('delete from storage.objects where name=$1 returning id',[photo(1)]));assert.equal(deleted.rows.length,0);
  await assert.rejects(()=>runAs(rider,()=>upload(9,rider)),/row-level security/);
 });
 await t.test('database guard blocks sold and USD checkouts even when an older payment function is installed',async()=>{
  for(const bad of [null,[]])await assert.rejects(()=>pg.query('insert into matmove_merchant_payments(merchant_id,items) values($1,$2)',[merchant,bad]),/products are required/);
  for(const currency of ['USD','SLE']){await pg.query('update products set currency=$1,is_available=false where id=$2',[currency,id]);await assert.rejects(()=>pg.query('insert into matmove_merchant_payments(merchant_id,items) values($1,$2)',[merchant,[{productId:id}]]),/sold|SLE wallet/);}
  await pg.query("update products set is_available=true,currency='USD' where id=$1",[id]);await assert.rejects(()=>pg.query('insert into matmove_merchant_payments(merchant_id,items) values($1,$2)',[merchant,[{productId:id}]]),/SLE wallet/);
  await pg.query("update products set currency='SLE' where id=$1",[id]);await pg.query('insert into matmove_merchant_payments(merchant_id,items) values($1,$2)',[merchant,[{productId:id}]]);assert.equal((await pg.query('select count(*)::integer n from matmove_merchant_payments')).rows[0].n,1);
 });
 await t.test('product image policies leave unrelated buckets subject to their existing policies',async()=>{
  await runAs(rider,()=>pg.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('unrelated','some-existing-path',$1,'{}')",[rider]));
  const result=await runAs(rider,()=>pg.query("update storage.objects set metadata='{}' where bucket_id='unrelated' returning id"));assert.equal(result.rows.length,1);
 });
 await t.test('rerunning installation preserves merchant edits, sold status and the current version',async()=>{
  const before=(await pg.query('select * from products order by id')).rows;await pg.exec(sql);assert.deepEqual((await pg.query('select * from products order by id')).rows,before);
 });
 }finally{await pg.close();}
});
