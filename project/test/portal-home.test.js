

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const rider='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',driver='33333333-3333-4333-8333-333333333333',admin='44444444-4444-4444-8444-444444444444';
async function fixture() {
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key);
 create table profiles(id uuid primary key references auth.users(id),role text);
 create table user_roles(profile_id uuid references profiles(id),role text);
 insert into auth.users values('${rider}'),('${other}'),('${driver}'),('${admin}');
 insert into profiles values('${rider}','rider'),('${other}','merchant'),('${driver}','driver'),('${admin}','rider');
 insert into user_roles values('${rider}','rider'),('${other}','merchant'),('${driver}','driver'),('${admin}','rider'),('${admin}','admin');
 grant usage on schema public,auth to authenticated,anon;`);
 const sql=await readFile(new URL('../docs/PORTAL_HOME_SETUP.sql',import.meta.url),'utf8');
 await pg.exec(sql);await pg.exec(sql);
 const session=async uid=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await pg.exec('set role authenticated');};
 const rpc=async(name,args=[])=>{const {rows}=await pg.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args);return rows[0].data;};
 return {pg,session,rpc};
}

test('Private saved places preserve data on reruns and reject cross-user access, stale edits and invalid coordinates',async()=>{
 const {pg,session,rpc}=await fixture();
 try{
  await session(rider);assert.deepEqual((await rpc('matmove_home_preferences',[rider])).places,[]);
  const place=await rpc('matmove_save_place',[rider,'home','Main Street, Freetown',8.48,-13.23,null]);assert.equal(place.version,1);
  await assert.rejects(()=>rpc('matmove_save_place',[rider,'home','Changed address',8.48,-13.23,null]),/CONFLICT/);
  const changed=await rpc('matmove_save_place',[rider,'home','New Street, Freetown',null,null,1]);assert.equal(changed.version,2);assert.equal(changed.latitude,null);
  await assert.rejects(()=>rpc('matmove_delete_place',[rider,'home',1]),/CONFLICT/);
  await assert.rejects(()=>rpc('matmove_save_place',[rider,'work','Invalid location',95,12,null]),/INVALID/);
  await session(other);assert.deepEqual((await rpc('matmove_home_preferences',[other])).places,[]);
  await assert.rejects(()=>rpc('matmove_home_preferences',[rider]),/AUTH/);
  await assert.rejects(()=>rpc('matmove_save_place',[rider,'home','Cross-user attempt',null,null,2]),/AUTH/);
  await assert.rejects(()=>pg.query('select * from public.matmove_saved_places'),/permission denied/);
  await assert.rejects(()=>pg.query("insert into public.matmove_saved_places(user_id,kind,address) values($1,'work','Bypass')",[other]),/permission denied/);
  await session(rider);assert.equal((await rpc('matmove_home_preferences',[rider])).places[0].address,'New Street, Freetown');
  await pg.exec('reset role');await pg.exec(await readFile(new URL('../docs/PORTAL_HOME_SETUP.sql',import.meta.url),'utf8'));
  await session(rider);assert.equal((await rpc('matmove_home_preferences',[rider])).places[0].version,2);
 }finally{await pg.close();}
});

test('Card references reject full numbers, enforce five-card limit, and can only be read or removed by their owner',async()=>{
 const {pg,session,rpc}=await fixture();
 try{
  await session(rider);
  await assert.rejects(()=>rpc('matmove_save_card_reference',[rider,'Personal','Visa','4111111111111111']),/INVALID/);
  await assert.rejects(()=>rpc('matmove_save_card_reference',[rider,'4111 1111 1111 1111','Visa','1111']),/INVALID/);
  const saved=await rpc('matmove_save_card_reference',[rider,'Personal','Visa','1234']);assert.equal(saved.last_four,'1234');assert.equal(saved.user_id,undefined);
  assert.equal((await rpc('matmove_save_card_reference',[rider,'Repeated','Visa','1234'])).id,saved.id);
  await session(other);assert.equal(await rpc('matmove_delete_card_reference',[other,saved.id]),false);
  await assert.rejects(()=>rpc('matmove_delete_card_reference',[rider,saved.id]),/AUTH/);
  await session(rider);for(const last of ['2000','2001','2002','2003'])await rpc('matmove_save_card_reference',[rider,'Other card','Visa',last]);
  await assert.rejects(()=>rpc('matmove_save_card_reference',[rider,'Extra card','Visa','2004']),/LIMIT/);
  assert.equal((await rpc('matmove_home_preferences',[rider])).cardReferences.length,5);
  assert.equal(await rpc('matmove_delete_card_reference',[rider,saved.id]),true);
  await assert.rejects(()=>pg.query('select * from public.matmove_card_references'),/permission denied/);
  await pg.exec('reset role');const {rows}=await pg.query("select column_name from information_schema.columns where table_name='matmove_card_references' order by ordinal_position");
  assert.deepEqual(rows.map(r=>r.column_name),['id','user_id','nickname','brand','last_four','created_at']);
 }finally{await pg.close();}
});

test('Skipped-KYC customers can save preferences, while drivers cannot add cards and admin or anonymous callers stay denied',async()=>{
 const {pg,session,rpc}=await fixture();
 try{
  await session(rider);assert.equal((await rpc('matmove_home_preferences',[rider])).role,'rider');
  await session(driver);assert.equal((await rpc('matmove_home_preferences',[driver])).role,'driver');
  await assert.rejects(()=>rpc('matmove_save_card_reference',[driver,'Personal','Visa','1234']),/ACCESS/);
  await session(admin);await assert.rejects(()=>rpc('matmove_home_preferences',[admin]),/ACCESS/);
  await pg.exec('reset role;set role anon');await assert.rejects(()=>rpc('matmove_home_preferences',[rider]),/permission denied/);
 }finally{await pg.close();}
});

test('Home navigation retains old ride, KYC and games routes and never initiates card payments',async()=>{
 const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 const home=await readFile(new URL('../src/components/PortalHome.tsx',import.meta.url),'utf8');
 assert.match(app,/activeSection === 'home' && <PortalHome/);
 assert.equal((app.match(/activeSection=\{activeSection === 'ride' \? 'home' : activeSection\}/g)||[]).length,3);
 for(const token of ['ArcadeGames','KycWorkspace','KycStatusNotice','RiderDashboard','DriverDashboard','MerchantDashboard'])assert.ok(app.includes(token));
 assert.match(home,/balanceAvailable === true/);assert.match(home,/wallet\?\.user_id === uid/);
 assert.match(home,/Card payments are not active/);assert.match(home,/Reference only/);
 assert.doesNotMatch(home,/cc-number|cc-csc|p_card_number|p_cvv/);
 assert.doesNotMatch(home,/create-monime-transfer|create-monime-payout|create-monime-checkout/);
 assert.match(home,/p_user_id: uid/);assert.match(home,/mutex\.current/);
 const css=await readFile(new URL('../src/index.css',import.meta.url),'utf8');assert.match(css,/safe-area-inset-bottom/);assert.doesNotMatch(css,/touch-action:\s*none/);
});


test('All three Home screens render masked wallets and loading states before any fetch; card references are limited to rider and merchant UI',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.portal-home-test-'));
 try{
  const out=join(dir,'home.mjs');
  await build({entryPoints:['src/components/PortalHome.tsx'],tsconfig:'tsconfig.app.json',outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',external:['react','react/*','react-dom/*','lucide-react'],plugins:[{name:'home-mock',setup(b){
   b.onResolve({filter:/^@\/lib\/(supabase|apiFetch)$/},args=>({path:args.path,namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase={};export function walletFetch(){throw new Error("No payment or wallet calls during render");}'}));
  }}]});
  const {default:Home}=await import(pathToFileURL(out));
  for(const role of ['rider','driver','merchant']){
   const html=renderToStaticMarkup(React.createElement(Home,{profile:{id:rider,role,first_name:'Richard'},onNavigate(){}}));
   assert.match(html,/Hello, Richard/);assert.match(html,/Balance hidden/);assert.match(html,/Loading saved places/);assert.match(html,/Loading trips/);
   assert.doesNotMatch(html,/No products listed|No trips yet/);assert.match(html,/Load with Mobile Money/);
   if(role==='driver'){assert.match(html,/Driver radar/);assert.doesNotMatch(html,/Payment methods/);}
   else assert.match(html,/Payment methods/);
   if(role==='merchant')assert.match(html,/My business/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Legacy customer profiles without role rows keep preferences; conflicting roles and administrative identities remain denied',async()=>{
 const {pg,session,rpc}=await fixture();try{
  await pg.exec(`delete from user_roles where profile_id='${rider}';`);
  await session(rider);assert.equal((await rpc('matmove_home_preferences',[rider])).role,'rider');
  const saved=await rpc('matmove_save_place',[rider,'home','Legacy Home',8.48,-13.23,null]);assert.equal(saved.kind,'home');
  const card=await rpc('matmove_save_card_reference',[rider,'Personal','Visa','1234']);assert.equal(card.last_four,'1234');
  await pg.exec('reset role');await pg.query("insert into user_roles values($1,'driver')",[rider]);await session(rider);
  await assert.rejects(()=>rpc('matmove_home_preferences',[rider]),/ACCESS/);
  await session(admin);await assert.rejects(()=>rpc('matmove_home_preferences',[admin]),/ACCESS/);
 }finally{await pg.close();}
});
