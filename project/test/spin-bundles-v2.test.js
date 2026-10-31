



import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {spinOdds,spinEconomics,validateSpinSectors} from '../shared/spin-rules.js';
import {runSpinLeg,reconcileSpinRound,spinAction,reconcileSpins,matchesSpinReceipt} from '../server/spin-payments.js';
const user='11111111-1111-4111-8111-111111111111', wallet='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333', admin='44444444-4444-4444-8444-444444444444';
const five=[100,500,1000,1500,2000].map((prizeMinor,i)=>({digit:String(i),prizeMinor}));
async function fixture(){
 const pg=new PGlite();
 await pg.exec(`create role anon; create role authenticated; create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false);
 create table wallets(id uuid primary key,user_id uuid,currency text,monime_account_id text,metadata jsonb default '{}',is_frozen boolean default false);
 create table admins(id uuid primary key,role text,is_active boolean default true,permissions jsonb default '[]');
 insert into profiles values('${user}','rider','approved',false),('${other}','rider','approved',false);
 insert into wallets(id,user_id,currency,monime_account_id) values('${wallet}','${user}','SLE','fac-user');
 insert into admins(id,role) values('${admin}','super_admin');`);
 await pg.exec(await readFile(new URL('../docs/SPIN_GAME_SETUP.sql',import.meta.url),'utf8'));
 await pg.exec(`update matmove_spin_configs set enabled=true;insert into matmove_spin_access(user_id,verified_adult,approved) values('${user}',true,true);`);
 const db={rpc:async(name,args)=>{try{const values=Object.values(args).map(v=>Array.isArray(v)?JSON.stringify(v):v);const r=await pg.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) data`,values);return {data:r.rows[0].data,error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}},from:table=>{
  const conditions=[],values=[];let ordering='',lim='';
  const run=async(single)=>{try{const r=await pg.query(`select * from ${table}${conditions.length?' where '+conditions.join(' and '):''}${ordering}${lim}`,values);return {data:single?r.rows[0]||null:r.rows,error:null};}catch(e){return {data:null,error:e};}};
  const q={select:()=>q,eq:(col,value)=>{values.push(value);conditions.push(`${col}=$${values.length}`);return q;},in:(col,list)=>{conditions.push(`${col} in (${list.map(v=>{values.push(v);return '$'+values.length;}).join(',')})`);return q;},or:()=>q,order:(col,opts)=>{ordering=` order by ${col} ${opts?.ascending===false?'desc':'asc'}`;return q;},limit:n=>{lim=` limit ${n}`;return q;},single:()=>run(true),maybeSingle:()=>run(true),then:(resolve,reject)=>run(false).then(resolve,reject)};return q;
 }};
 let status='completed',wrong=false,posts=0,gets=0;const receipts=new Map();
 const provider=async(path,options)=>{
  if(options?.method==='POST'){posts++;const body=JSON.parse(options.body);const result={...body,id:'trn-'+posts,status};if(wrong)result.destinationFinancialAccount={id:'fac-wrong'};receipts.set(result.id,result);return result;}
  gets++;const result=receipts.get(path.split('/').pop());return {...result,status};
 };
 const prepare=(key='a'.repeat(64),treasury=100000)=>db.rpc('matmove_spin_prepare',{p_key:key,p_user:user,p_wallet:wallet,p_config:1,p_digit:'5',p_source:'fac-user',p_spin:'fac-spin',p_balance:treasury,p_observed:new Date().toISOString()});
 const draw=(id,index,sector)=>db.rpc('matmove_spin_draw',{p_id:id,p_user:user,p_index:index,p_sector:sector});
 return {pg,db,prepare,draw,provider,setStatus:v=>status=v,setWrong:v=>wrong=v,get posts(){return posts;},get gets(){return gets;}};
}
async function withFixture(fn){const f=await fixture();try{await fn(f);}finally{await f.pg.close();}}

import {defaultSpinTiers,validateSpinTiers,sampleSpinSector,spinProfileEligibility} from '../shared/spin-rules.js';
async function tierFixture(legacy=false){
 const f=await fixture();let legacyId=null;
 if(legacy){const p=await f.prepare();legacyId=p.data.id;await reconcileSpinRound(f.db,legacyId,f.provider);}
 await f.pg.exec(`alter table profiles add column date_of_birth date;update profiles set date_of_birth='1980-01-01' where id='${user}';`);
 await f.pg.exec(await readFile(new URL('../docs/SPIN_TIERS_SETUP.sql',import.meta.url),'utf8'));
 await f.pg.exec('update matmove_spin_configs set enabled=true where id=2;delete from matmove_spin_access;');
 await f.pg.exec(await readFile(new URL('../docs/SPIN_SIX_SEGMENTS_SETUP.sql',import.meta.url),'utf8'));
 await f.pg.exec('update matmove_spin_configs set enabled=true where id=3');
 const base=f.db.from;
 f.db.from=table=>{const q=base(table);if(table==='wallets')q.or=expression=>q.eq('monime_account_id',expression.match(/monime_account_id\.eq\.([^,]+)/)[1]);return q;};
 const prepare=(tier=500,key='a'.repeat(64),treasury=100000)=>f.db.rpc('matmove_spin_prepare_six',{p_key:key,p_user:user,p_wallet:wallet,p_config:3,p_digit:'0',p_source:'fac-user',p_spin:'fac-spin',p_balance:treasury,p_observed:new Date().toISOString(),p_tier:tier});
 let available=100000;
 const walletData={id:wallet,user_id:user,currency:'SLE',monime_account_id:'fac-user',is_frozen:false};
 const profile={id:user,role:'rider',kyc_status:'approved',date_of_birth:'1980-01-01',is_wallet_frozen:false};
 const provider=async(path,options)=>path.startsWith('financial-accounts/')?{id:path.includes('fac-spin')?'fac-spin':'fac-user',currency:'SLE',balance:{available:{currency:'SLE',value:100000}}}:f.provider(path,options);
 const verifyAccount=async()=>({id:'fac-user',currency:'SLE',balance:{available:{currency:'SLE',value:available}}});
 const body={action:'spin_enter',tierMinor:500,acceptedEntryMinor:500,configId:3,luckyDigit:'0',acceptRules:true,requestKey:'66666666-6666-4666-8666-666666666666'};
 const invoke=async(extra={},draw=()=>0)=>{const res={status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await spinAction({body:{...body,...extra},matmove:{db:f.db,user:{id:user},profile,wallets:[walletData]}},res,{provider,verifyAccount,draw});return res;};
 return {...f,original:f,prepare,legacyId,invoke,profile,setAvailable:v=>available=v};
}
async function withTier(fn,legacy=false){const old={spin:process.env.MONIME_SPIN_ACCOUNT_ID,escrow:process.env.MONIME_ESCROW_ACCOUNT_ID,enabled:process.env.MATMOVE_SPIN_ENABLED};process.env.MONIME_SPIN_ACCOUNT_ID='fac-spin';process.env.MONIME_ESCROW_ACCOUNT_ID='fac-escrow';process.env.MATMOVE_SPIN_ENABLED='true';const f=await tierFixture(legacy);try{await fn(f);}finally{await f.pg.close();for(const [key,value] of [['MONIME_SPIN_ACCOUNT_ID',old.spin],['MONIME_ESCROW_ACCOUNT_ID',old.escrow],['MATMOVE_SPIN_ENABLED',old.enabled]])if(value===undefined)delete process.env[key];else process.env[key]=value;}}

import {defaultSixTiers,validateSixTiers,sampleSix,sixEconomics} from '../shared/six-spin-rules.js';
const next=(f,id,index,sector)=>f.db.rpc('matmove_spin_draw_six',{p_id:id,p_user:user,p_index:index,p_sector:sector});

import {defaultBundleTiers,validateBundleTiers,sampleBundle,bundleEconomics} from '../shared/bundle-spin-rules.js';
async function withBundle(fn,legacy=false){return withTier(async f=>{
 await f.pg.exec(`create function public.matmove_admin_can(section text) returns boolean language sql as $$ select auth.uid()='${admin}'::uuid and section='games.settings' $$;`);
 await f.pg.exec(await readFile(new URL('../docs/SPIN_BUNDLES_V2_SETUP.sql',import.meta.url),'utf8'));
 await f.pg.exec('update matmove_spin_configs set enabled=true where id=4');
 const invoke=(extra={},draw=()=>0)=>f.invoke({configId:4,...extra},draw);
 await fn({...f,invoke});
},legacy);}
const bundleDraw=(f,id,index,sector)=>f.db.rpc('matmove_spin_draw_bundle',{p_id:id,p_user:user,p_index:index,p_sector:sector});
test('latest prizes have 5, 6, 5 equal sectors and every fee buys ONE spin',()=>{
 const tiers=defaultBundleTiers();assert.deepEqual(tiers.map(t=>t.paidSpins),[1,1,1]);
 assert.deepEqual(tiers.map(t=>t.sectors.map(s=>s.prizeMinor)),[[100,300,1000,500,0],[500,700,1500,400,2000,0],[1500,1800,1200,2500,2000]]);
 assert.deepEqual(tiers.map(bundleEconomics).map(e=>e.expectedPrizeMinor),[475,850,1800]);
 assert.deepEqual(tiers.map(bundleEconomics).map(e=>e.maximumPrizeMinor),[1000,2000,2500]);
 for(const t of tiers)for(let i=0;i<t.sectors.length;i++)assert.equal(sampleBundle(t.sectors,()=>i),i);
 assert.deepEqual([0,1,2,3].map(i=>sampleBundle(tiers[0].sectors,()=>i,true)),[0,1,2,3]);
 tiers[1].paidSpins=2;assert.throws(()=>validateBundleTiers(tiers));
});
test('one paid spin for each fee credits exact cash and blocks a second draw',()=>withBundle(async f=>{
 for(const [i,fee] of [500,1000,2000].entries()){
 const a=await f.invoke({tierMinor:fee,acceptedEntryMinor:fee,requestKey:`66666666-6666-4666-8666-66666666666${i}`});const id=a.body.round.id;assert.equal(a.body.round.mode,'bundle_v2');assert.equal(a.body.round.spinCount,1);
 const b=await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>0);assert.equal(b.body.round.state,'completed');assert.equal(b.body.round.paidMinor,[100,500,1500][i]);
 const bad=await bundleDraw(f,id,2,0);assert.ok(bad.error);
 const posts=f.original.posts;await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>1);assert.equal(f.original.posts,posts);
 }
}));
test('SLE5 bonus grants one free final cash spin and no extra debit',()=>withBundle(async f=>{
 const a=await f.invoke();const id=a.body.round.id;
 const b=await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>4);assert.equal(b.body.round.bonusPending,true);assert.equal(b.body.round.state,'active');assert.equal(f.original.posts,1);
 const bad=await bundleDraw(f,id,2,4);assert.match(bad.error.message,/another bonus/);
 const c=await f.invoke({action:'spin_draw',roundId:id,spinIndex:2},()=>2);assert.equal(c.body.round.state,'completed');assert.equal(c.body.round.paidMinor,1000);assert.equal(f.original.posts,2);
 assert.ok((await bundleDraw(f,id,3,0)).error);
}));
test('SLE10 no-prize ends game without a zero-value provider transfer',()=>withBundle(async f=>{
 const a=await f.invoke({tierMinor:1000,acceptedEntryMinor:1000});const b=await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1},()=>5);
 assert.equal(b.body.round.state,'completed');assert.equal(b.body.round.paidMinor,0);assert.equal(f.original.posts,1);
}));
test('pending prize remains owed and provider receipt is polled, never resent',()=>withBundle(async f=>{
 const a=await f.invoke();f.setStatus('pending');const b=await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1},()=>3);assert.equal(b.body.round.state,'win_pending');assert.equal(b.body.round.paidMinor,0);
 const posts=f.original.posts;f.setStatus('completed');const c=await f.invoke({action:'spin_status',roundId:a.body.round.id});assert.equal(c.body.round.state,'completed');assert.equal(c.body.round.paidMinor,500);assert.equal(f.original.posts,posts);
}));
test('new migration is rerunnable and preserves old paid game rules',()=>withBundle(async f=>{
 const before=await f.pg.query('select count(*) n from matmove_spin_configs');await f.pg.exec(await readFile(new URL('../docs/SPIN_BUNDLES_V2_SETUP.sql',import.meta.url),'utf8'));assert.equal((await f.pg.query('select count(*) n from matmove_spin_configs')).rows[0].n,before.rows[0].n);
 assert.equal((await f.invoke({action:'spin_status',roundId:f.legacyId})).body.round.mode,'legacy');
},true));
test('future prize edits do not change a purchased wheel; only settings staff can publish',()=>withBundle(async f=>{
 const a=await f.invoke();const t=defaultBundleTiers();t[0].sectors[0].prizeMinor=900;
 const args={p_expected:4,p_enabled:true,p_tiers:t};let result=await f.db.rpc('matmove_spin_admin_save_bundle',args);assert.match(result.error.message,/FORBIDDEN/);
 await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);result=await f.db.rpc('matmove_spin_admin_save_bundle',args);assert.equal(result.error,null);
 const snapshot=await f.invoke({action:'spin_status',roundId:a.body.round.id});assert.equal(snapshot.body.round.sectors[0].prizeMinor,100);
 await assert.rejects(()=>f.pg.query('update matmove_spin_configs set bundle_tiers=$1 where id=4',[JSON.stringify(t)]),/new configuration/);
}));
test('unfunded prize capacity and frozen wallets block entry, browsers cannot call money RPCs',()=>withBundle(async f=>{
 await f.pg.exec('set role authenticated');await assert.rejects(()=>f.pg.query('select matmove_spin_draw_bundle($1,$2,1,0)',['77777777-7777-4777-8777-777777777777',user]),/permission denied/);await f.pg.exec('reset role');
 await f.pg.exec(`update wallets set is_frozen=true where id='${wallet}'`);
 await assert.rejects(()=>f.invoke(),/frozen/i);assert.equal(f.original.posts,0);
}));
