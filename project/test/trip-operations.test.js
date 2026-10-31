import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const rider='11111111-1111-4111-8111-111111111111',driver='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',staff='44444444-4444-4444-8444-444444444444';
test('trip requests preserve accepted work, recover original submissions and keep owned Driver history',async t=>{
 const pg=new PGlite();try{
 await pg.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('${rider}'),('${driver}'),('${other}'),('${staff}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false);
 insert into profiles values('${rider}','rider','approved',false),('${driver}','driver','approved',false),('${other}','driver','approved',false),('${staff}','rider','approved',false);
 create table user_roles(profile_id uuid,role text);insert into user_roles select id,role from profiles;
 create table wallets(user_id uuid,currency text,is_frozen boolean default false);insert into wallets select id,'SLE',false from profiles;
 create table matmove_staff_access(id uuid,is_active boolean,removed_at timestamptz);insert into matmove_staff_access values('${staff}',true,null);
 create type booking_state as enum('pending','pending_admin','accepted','in_progress','completed','cancelled');
 create type service_kind as enum('ride','delivery','scheduled');
 create table bookings(id uuid primary key,rider_id uuid,driver_id uuid,status booking_state,fare_amount numeric,service_type service_kind,vehicle_type text,pickup_location text,destination_location text,scheduled_time timestamptz,created_at timestamptz default now(),matmove_pickup_lat float8,matmove_pickup_lng float8,matmove_destination_lat float8,matmove_destination_lng float8);
 create function matmove_preferences_role(uuid) returns text language sql security definer as $$select role from public.profiles where id=$1 and $1=auth.uid()$$;
 create function matmove_dispatch_driver_busy(uuid,uuid) returns boolean language sql security definer as $$select exists(select 1 from public.bookings where driver_id=$1 and id is distinct from $2 and status::text in ('pending','pending_admin','accepted','in_progress'))$$;
 grant usage on schema public,auth to authenticated,anon;grant select on bookings to authenticated;
 `);
 const sql=await readFile('docs/TRIP_OPERATIONS_SETUP.sql','utf8');await pg.exec(sql);
 await pg.exec(`alter table bookings enable row level security;create policy driver_read on bookings for select to authenticated using(rider_id=auth.uid() or matmove_driver_radar_visible(rider_id,driver_id,status::text));`);
 const run=async(id,fn,role='authenticated')=>{await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await pg.exec('set role '+role);try{return await fn();}finally{await pg.exec('reset role');}};
 const details={client_version:1,service_type:'ride',vehicle_type:'car',pickup_location:'Pickup',destination_location:'Destination',fare_amount:'100.00',scheduled_time:null,passenger_count:3,passenger_name:'Guest Rider',pickup_pin:{lat:8.4,lng:-13.2},destination_pin:{lat:8.5,lng:-13.1}};
 const create=async(id=crypto.randomUUID(),patch={},actor=rider)=>run(actor,async()=>{const q=await pg.query('select matmove_create_customer_trip($1,$2) as result',[id,{...details,...patch}]);return q.rows[0].result;});
 let first;
 await t.test('one owned pending request is saved exactly once and changed-key retries cannot create another',async()=>{const id=crypto.randomUUID();first=await create(id);assert.equal(first.passenger_count,3);assert.equal(first.status,'pending');assert.equal((await create(id)).id,id);await assert.rejects(()=>create(id,{fare_amount:'200.00'}),/Original request/);await assert.rejects(()=>create(),/pending request/);await assert.rejects(()=>create(id,{},other),/Customer booking/);});
 await t.test('accepted work remains intact while a second distinct trip can be requested and recovered',async()=>{await pg.query("update bookings set driver_id=$1,status='accepted' where id=$2",[driver,first.id]);const second=await create();assert.notEqual(second.id,first.id);const old=(await pg.query('select * from bookings where id=$1',[first.id])).rows[0];assert.equal(old.driver_id,driver);assert.equal(old.status,'accepted');await pg.query("update bookings set status='cancelled' where id=$1",[second.id]);assert.equal((await create(second.id)).status,'cancelled');});
 await t.test('capacity and map pins are checked by SQL and callers cannot invent staff/customer ownership',async()=>{for(const patch of [{passenger_count:4},{passenger_count:0},{pickup_pin:null},{destination_pin:{lat:100,lng:1}},{client_version:2},{passenger_name:'X'},{fare_amount:'1.001'}])await assert.rejects(()=>create(crypto.randomUUID(),patch));await assert.rejects(()=>create(crypto.randomUUID(),{},staff),/Customer booking/);await assert.rejects(()=>run(rider,()=>pg.query('select * from matmove_customer_trip_requests')),/permission denied/);await assert.rejects(()=>run(null,()=>pg.query('select matmove_create_customer_trip($1,$2)',[crypto.randomUUID(),details]),'anon'),/permission denied/);});
 await t.test('completed and cancelled assigned trips stay visible only to their own Driver',async()=>{await pg.query("update bookings set status='completed' where id=$1",[first.id]);assert.equal((await run(driver,()=>pg.query('select id from bookings'))).rows.length,1);assert.equal((await run(other,()=>pg.query('select id from bookings'))).rows.length,0);await pg.query("update profiles set kyc_status='rejected' where id=$1",[driver]);assert.equal((await run(driver,()=>pg.query('select id from bookings'))).rows.length,1);});
 await t.test('reruns preserve original receipts, fares and passenger details',async()=>{await pg.exec(sql);const row=await create(first.id);assert.equal(row.status,'completed');assert.equal(row.passenger_name,'Guest Rider');assert.equal((await pg.query('select count(*)::int n from matmove_customer_trip_requests')).rows[0].n,2);});
 }finally{await pg.close();}
});
