
import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
const rider='11111111-1111-4111-8111-111111111111',driver='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',booking='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('active trip locations enforce participant privacy, explicit sharing sessions and immutable pins',async t=>{
 const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);insert into auth.users values('${rider}'),('${driver}'),('${other}');
 create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false);insert into profiles values('${rider}','rider','approved',false),('${driver}','driver','approved',false),('${other}','driver','approved',false);
 create table user_roles(profile_id uuid,role text);insert into user_roles select id,role from profiles;
 create table wallets(user_id uuid,is_frozen boolean default false);insert into wallets(user_id) values('${rider}'),('${driver}'),('${other}');
 create table matmove_staff_access(id uuid primary key,is_active boolean,removed_at timestamptz);
 create table bookings(id uuid primary key,rider_id uuid,driver_id uuid,status text,fare_amount numeric);insert into bookings values('${booking}','${rider}','${driver}','accepted',25);
 grant usage on schema auth,public to authenticated,anon,service_role;grant select,update on bookings to authenticated;
 `);
 const home=await readFile('docs/PORTAL_HOME_SETUP.sql','utf8');await pg.exec(home.slice(home.indexOf('create or replace function public.matmove_preferences_role('),home.indexOf('create or replace function public.matmove_home_preferences(')));
 const sql=await readFile('docs/ACTIVE_TRIP_LOCATION_SETUP.sql','utf8');await pg.exec(sql);
 const session=async(id,role='authenticated')=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await pg.exec('set role '+role);};
 const rpc=async(action='read',key=null,lat=null,lng=null,accuracy=null,observed=null)=>(await pg.query('select matmove_trip_location($1,$2,$3,$4,$5,$6,$7) d',[booking,action,lat,lng,accuracy,observed,key])).rows[0].d;
 const publish=key=>rpc('publish',key,8.48,-13.23,12,new Date().toISOString());let key;
 await t.test('pins are validated and immutable, while legacy requests remain nullable',async()=>{
 await pg.query("insert into bookings(id,rider_id,driver_id,status,fare_amount,matmove_pickup_lat,matmove_pickup_lng,matmove_destination_lat,matmove_destination_lng) values(gen_random_uuid(),$1,$2,'accepted',20,8.48,-13.23,8.49,-13.24)",[rider,driver]);
 await assert.rejects(pg.query('update bookings set matmove_pickup_lat=91 where id=$1',[booking]),/invalid coordinates/);
 await assert.rejects(pg.query('update bookings set matmove_pickup_lat=8.48,matmove_pickup_lng=-13.23 where id=$1',[booking]),/cannot be rewritten/);
 await session(rider);const row=await rpc();assert.equal(row.pickup,null);assert.equal(row.position,null);assert.equal(row.locationState,'waiting');
 });
 await t.test('unassigned drivers, anonymous callers and active staff cannot inspect GPS',async()=>{
 await session(other);await assert.rejects(rpc(),/private to the assigned active trip/);await assert.rejects(rpc('clear',crypto.randomUUID()),/sharing driver/);
 await session(null,'anon');await assert.rejects(rpc(),/permission denied/);
 await pg.exec('reset role');await pg.query('insert into matmove_staff_access values($1,true,null)',[driver]);await session(driver);await assert.rejects(rpc(),/participants only/);await pg.exec('reset role');await pg.query('delete from matmove_staff_access where id=$1',[driver]);
 });
 await t.test('only the assigned approved driver can start a sharing session and publish accurate recent GPS',async()=>{
 await session(rider);await assert.rejects(rpc('start'),/assigned driver/);
 await session(driver);await assert.rejects(publish(crypto.randomUUID()),/sharing stopped/);const started=await rpc('start');key=started.shareKey;assert.ok(key);assert.equal(started.position,null);
 const position=await publish(key);assert.equal(position.locationState,'fresh');assert.equal(position.position.lat,8.48);assert.equal(position.position.lng,-13.23);
 await session(rider);const read=await rpc();assert.equal(read.position.lat,8.48);assert.ok(!('shareKey' in read));await assert.rejects(publish(key),/assigned driver/);
 });
 await t.test('invalid, inaccurate, stale and future GPS cannot overwrite a valid reading',async()=>{
 await session(driver);
 for(const [lat,lng,accuracy,observed]of[[91,0,10,new Date()],[8.48,-13.23,500,new Date()],[8.48,-13.23,10,new Date(Date.now()-120000)],[8.48,-13.23,10,new Date(Date.now()+120000)]])await assert.rejects(rpc('publish',key,lat,lng,accuracy,observed.toISOString()),/recent, accurate/);
 assert.equal((await rpc()).position.lat,8.48);
 });
 await t.test('older samples cannot supersede newer samples and stale coordinates are hidden',async()=>{
 await pg.exec('reset role');const old=(await pg.query('select * from matmove_trip_positions')).rows[0];await session(driver);
 await rpc('publish',key,8.49,-13.25,10,new Date(Date.now()-30000).toISOString());assert.equal((await rpc()).position.lat,8.48);
 await pg.exec('reset role');await pg.query("update matmove_trip_positions set received_at=now()-interval '46 seconds' where booking_id=$1",[booking]);await session(rider);const stale=await rpc();assert.equal(stale.position,null);assert.equal(stale.locationState,'stale');assert.ok(old.observed_at);
 });
 await t.test('stop revokes delayed publishes, and old cleanup cannot cancel a newer sharing session',async()=>{
 await session(driver);await rpc('clear',key);await assert.rejects(publish(key),/sharing stopped/);assert.equal((await rpc()).position,null);
 const next=(await rpc('start')).shareKey;await rpc('clear',key);assert.equal((await publish(next)).locationState,'fresh');key=next;
 });
 await t.test('revoked driver approval or a wallet freeze denies publishing without changing fare',async()=>{
 await pg.exec('reset role');await pg.query('update wallets set is_frozen=true where user_id=$1',[driver]);await session(driver);await assert.rejects(publish(key),/unfrozen/);
 await pg.exec('reset role');await pg.query('update wallets set is_frozen=false where user_id=$1',[driver]);await pg.query("update profiles set kyc_status='pending' where id=$1",[driver]);await session(driver);await assert.rejects(publish(key),/approval/);
 await pg.exec('reset role');await pg.query("update profiles set kyc_status='approved' where id=$1",[driver]);assert.equal((await pg.query('select fare_amount from bookings where id=$1',[booking])).rows[0].fare_amount,'25');
 });
 await t.test('direct browser table access is denied and reruns preserve the current sharing session',async()=>{
 await session(driver);await assert.rejects(pg.query('select * from matmove_trip_positions'),/permission denied/);await assert.rejects(pg.query('select * from matmove_trip_sharing'),/permission denied/);
 await pg.exec('reset role');await pg.exec(sql);await session(driver);assert.equal((await publish(key)).locationState,'fresh');
 });
 await t.test('readiness query is read-only and confirms all six installed protections',async()=>{
 await pg.exec('reset role');const result=await pg.exec(await readFile('docs/ACTIVE_TRIP_LOCATION_READINESS.sql','utf8'));assert.ok(Object.values(result[0].rows[0]).every(v=>v===true));
 });
 await t.test('completion clears positions and leases, forbidding further reads or late publishes',async()=>{
 await pg.exec('reset role');await pg.query("update bookings set status='completed' where id=$1",[booking]);assert.equal((await pg.query('select count(*)::int n from matmove_trip_positions where booking_id=$1',[booking])).rows[0].n,0);assert.equal((await pg.query('select count(*)::int n from matmove_trip_sharing where booking_id=$1',[booking])).rows[0].n,0);
 await session(rider);await assert.rejects(rpc(),/private to the assigned active trip/);await session(driver);await assert.rejects(publish(key),/private to the assigned active trip/);
 });
 }finally{await pg.close();}
});
