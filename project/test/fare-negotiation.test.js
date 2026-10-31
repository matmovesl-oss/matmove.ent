
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const rider='11111111-1111-4111-8111-111111111111',driver='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',outsider='44444444-4444-4444-8444-444444444444',booking='55555555-5555-4555-8555-555555555555',offer='66666666-6666-4666-8666-666666666666',second='77777777-7777-4777-8777-777777777777';
async function fixture(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);
 create table profiles(id uuid primary key references auth.users(id),role text,kyc_status text,full_name text,is_wallet_frozen boolean default false);
 create table user_roles(profile_id uuid references profiles(id),role text);
 create table wallets(id uuid primary key default gen_random_uuid(),user_id uuid,currency text default 'SLE',is_frozen boolean default false);
 create table bookings(id uuid primary key,rider_id uuid,driver_id uuid,status text,fare_amount numeric,service_type text,pickup_location text,destination_location text,updated_at timestamptz default now());
 create table ride_payments(booking_id uuid primary key,payer_id uuid,driver_id uuid,fare_minor bigint,state text default 'funding');
 insert into auth.users values('${rider}'),('${driver}'),('${other}'),('${outsider}');
 insert into profiles values('${rider}','rider','not_started','Customer',false),('${driver}','driver','approved','Driver One',false),('${other}','driver','approved','Driver Two',false),('${outsider}','rider','approved','Other Customer',false);
 insert into user_roles select id,role from profiles;insert into wallets(user_id) select id from profiles;
 insert into bookings(id,rider_id,status,fare_amount,service_type,pickup_location,destination_location) values('${booking}','${rider}','pending',20,'ride','Pickup','Destination');
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant select,update on bookings to authenticated;grant select on profiles to authenticated;
 grant all on ride_payments to authenticated;
 -- Models the existing trusted prepare RPC without replacing it in the real migration.
 create function prepare_ride_payment(p_booking_id uuid,p_actor_id uuid,p_action text,p_payer_account text default null,p_driver_account text default null,p_escrow_account text default null,p_fee_account text default null)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$declare b public.bookings%rowtype;begin
 select * into b from bookings where id=p_booking_id for update;
 insert into ride_payments(booking_id,payer_id,driver_id,fare_minor) values(b.id,b.rider_id,p_actor_id,round(b.fare_amount*100)::bigint);
 update bookings set driver_id=p_actor_id where id=b.id;
 return jsonb_build_object('bookingId',b.id);end;$$;
 `);
 await pg.exec(await readFile(new URL('../docs/PORTAL_HOME_SETUP.sql',import.meta.url),'utf8'));
 const sql=await readFile(new URL('../docs/RIDE_FARE_NEGOTIATION_SETUP.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
 const session=async(id,role='authenticated')=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await pg.exec('set role '+role);};
 const rpc=async(name,args)=>{const {rows}=await pg.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args);return rows[0].data;};
 const prepare=async actor=>{await session(actor,'service_role');return rpc('prepare_ride_payment',[booking,actor,'accept']);};
 const propose=async(actor=driver,id=offer,minor=2500,version=1)=>{await session(actor);return rpc('matmove_propose_ride_fare',[actor,booking,id,minor,version]);};
 const decide=async(actor=rider,id=offer,decision='accept',version=1)=>{await session(actor);return rpc('matmove_decide_ride_fare',[actor,id,decision,version]);};
 return{pg,session,rpc,prepare,propose,decide};
}

test('Customer confirms the exact proposed fare; only the chosen driver can prepare payment with the stored amount',async()=>{
 const f=await fixture();try{
  await f.propose();await f.propose(other,second,2300);
  const agreement=await f.decide();assert.equal(agreement.status,'accepted');assert.equal(agreement.agreed_version,2);
  await assert.rejects(()=>f.prepare(other),/chosen driver/);
  await f.prepare(driver);await f.session(rider);
  const snap=await f.rpc('matmove_read_ride_fares',[rider,booking]);assert.equal(snap.fareMinor,2500);assert.equal(snap.selectedDriverId,driver);assert.equal(snap.paymentStarted,true);
  await f.pg.exec('reset role');assert.equal((await f.pg.query('select fare_minor from ride_payments')).rows[0].fare_minor,2500);
  await assert.rejects(()=>f.pg.query('update bookings set fare_amount=1 where id=$1',[booking]),/fare is locked/);
 }finally{await f.pg.close();}
});

test('Pending own offers block payment until withdrawn; declined or expired offers never change the original fare',async()=>{
 const f=await fixture();try{
  await f.propose();await assert.rejects(()=>f.prepare(driver),/Withdraw your offer/);
  await f.decide(driver,offer,'withdraw');await f.prepare(driver);
  await f.pg.exec('reset role');assert.equal((await f.pg.query('select fare_minor from ride_payments')).rows[0].fare_minor,2000);
 }finally{await f.pg.close();}
});

test('Browser role cannot forge fare, assign driver, write payment rows, call money RPCs, or read private offer tables',async()=>{
 const f=await fixture();try{
  await f.session(rider);
  await assert.rejects(()=>f.pg.query('update bookings set fare_amount=1 where id=$1',[booking]),/offer-confirmation/);
  await assert.rejects(()=>f.pg.query('update bookings set driver_id=$1 where id=$2',[other,booking]),/payment API/);
  await assert.rejects(()=>f.pg.query('insert into ride_payments(booking_id,payer_id,driver_id,fare_minor) values($1,$2,$3,1)',[booking,rider,driver]),/permission denied/);
  await assert.rejects(()=>f.rpc('prepare_ride_payment',[booking,driver,'accept']),/permission denied/);
  await assert.rejects(()=>f.pg.query('select * from matmove_ride_fare_offers'),/permission denied/);
  await f.session(null,'anon');await assert.rejects(()=>f.rpc('matmove_read_ride_fares',[rider,booking]),/permission denied/);
 }finally{await f.pg.close();}
});

test('Offer keys are idempotent; another customer, another driver, stale version, changed route or expired offer cannot approve a fare',async()=>{
 const f=await fixture();try{
  const first=await f.propose();assert.equal((await f.propose()).id,first.id);
  await assert.rejects(()=>f.propose(driver,offer,2600),/Request key/);
  await assert.rejects(()=>f.propose(driver,second,2600,2),/Fare changed/);
  await assert.rejects(()=>f.decide(outsider),/Only the customer/);
  await assert.rejects(()=>f.decide(other,offer,'withdraw'),/another driver/);
  await f.session(rider);await assert.rejects(()=>f.rpc('matmove_read_ride_fares',[outsider,booking]),/AUTH/);
  await f.session(outsider);await assert.rejects(()=>f.rpc('matmove_read_ride_fares',[outsider,booking]),/access denied/);
  await f.pg.exec('reset role');await assert.rejects(()=>f.pg.query("update bookings set destination_location='Changed' where id=$1",[booking]),/details are locked/);
  await f.pg.query("update matmove_ride_fare_offers set expires_at=now()-interval '1 second' where id=$1",[offer]);
  await assert.rejects(()=>f.decide(),/expired or changed/);
  await f.session(rider);assert.equal((await f.rpc('matmove_read_ride_fares',[rider,booking])).offers[0].status,'expired');
 }finally{await f.pg.close();}
});

test('Freeze or revoked approval blocks mutation and rechecking driver eligibility before customer confirmation',async()=>{
 const f=await fixture();try{
  await f.propose();await f.pg.exec('reset role');await f.pg.query('update wallets set is_frozen=true where user_id=$1',[driver]);
  await assert.rejects(()=>f.propose(driver,second),/Wallet is frozen/);
  await assert.rejects(()=>f.decide(),/driver is no longer available/);
  await f.pg.exec('reset role');await f.pg.query('update wallets set is_frozen=false where user_id=$1',[driver]);await f.pg.query("update profiles set kyc_status='pending' where id=$1",[driver]);
  await assert.rejects(()=>f.propose(driver,second),/Approval is required/);
  await f.pg.exec('reset role');await f.pg.query('update wallets set is_frozen=true where user_id=$1',[rider]);
  await assert.rejects(()=>f.decide(),/Wallet is frozen/);
 }finally{await f.pg.close();}
});

test('An original fare remains payable without negotiation; stale or mismatched payment amounts are rejected',async()=>{
 const f=await fixture();try{
  await f.pg.exec('reset role');await assert.rejects(()=>f.pg.query('insert into ride_payments(booking_id,payer_id,driver_id,fare_minor) values($1,$2,$3,1)',[booking,rider,driver]),/current fare/);
  await f.prepare(driver);await f.pg.exec('reset role');assert.equal((await f.pg.query('select fare_minor from ride_payments')).rows[0].fare_minor,2000);
 }finally{await f.pg.close();}
});
