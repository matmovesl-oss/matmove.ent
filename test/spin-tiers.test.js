

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
 const base=f.db.from;
 f.db.from=table=>{const q=base(table);if(table==='wallets')q.or=expression=>q.eq('monime_account_id',expression.match(/monime_account_id\.eq\.([^,]+)/)[1]);return q;};
 const prepare=(tier=500,key='a'.repeat(64),treasury=100000)=>f.db.rpc('matmove_spin_prepare_tier',{p_key:key,p_user:user,p_wallet:wallet,p_config:2,p_digit:'0',p_source:'fac-user',p_spin:'fac-spin',p_balance:treasury,p_observed:new Date().toISOString(),p_tier:tier});
 let available=100000;
 const walletData={id:wallet,user_id:user,currency:'SLE',monime_account_id:'fac-user',is_frozen:false};
 const profile={id:user,role:'rider',kyc_status:'approved',date_of_birth:'1980-01-01',is_wallet_frozen:false};
 const provider=async(path,options)=>path.startsWith('financial-accounts/')?{id:path.includes('fac-spin')?'fac-spin':'fac-user',currency:'SLE',balance:{available:{currency:'SLE',value:100000}}}:f.provider(path,options);
 const verifyAccount=async()=>({id:'fac-user',currency:'SLE',balance:{available:{currency:'SLE',value:available}}});
 const body={action:'spin_enter',tierMinor:500,acceptedEntryMinor:500,configId:2,luckyDigit:'0',acceptRules:true,requestKey:'66666666-6666-4666-8666-666666666666'};
 const invoke=async(extra={},draw=()=>0)=>{const res={status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await spinAction({body:{...body,...extra},matmove:{db:f.db,user:{id:user},profile,wallets:[walletData]}},res,{provider,verifyAccount,draw});return res;};
 return {...f,original:f,prepare,legacyId,invoke,profile,setAvailable:v=>available=v};
}
async function withTier(fn,legacy=false){const old={spin:process.env.MONIME_SPIN_ACCOUNT_ID,escrow:process.env.MONIME_ESCROW_ACCOUNT_ID,enabled:process.env.MATMOVE_SPIN_ENABLED};process.env.MONIME_SPIN_ACCOUNT_ID='fac-spin';process.env.MONIME_ESCROW_ACCOUNT_ID='fac-escrow';process.env.MATMOVE_SPIN_ENABLED='true';const f=await tierFixture(legacy);try{await fn(f);}finally{await f.pg.close();for(const [key,value] of [['MONIME_SPIN_ACCOUNT_ID',old.spin],['MONIME_ESCROW_ACCOUNT_ID',old.escrow],['MATMOVE_SPIN_ENABLED',old.enabled]])if(value===undefined)delete process.env[key];else process.env[key]=value;}}
test('default three-spin tiers have exact 70% expectations and increasing jackpot odds',()=>{
 const tiers=defaultSpinTiers();assert.deepEqual(tiers.map(t=>t.entryMinor),[500,1000,2000]);
 assert.deepEqual(tiers.map(t=>spinOdds(t.sectors).find(o=>o.prizeMinor===5000).probability),[.001,.005,.02]);
 for(const t of tiers){assert.equal(spinEconomics(t.sectors,t.entryMinor).expectedRoundPrizeMinor,t.entryMinor*.7);assert.equal(spinEconomics(t.sectors,t.entryMinor).maximumRoundPrizeMinor,15000);assert.equal(t.sectors.length,21);}
});
test('every published prize can be sampled and boundary indices match probability weights',()=>{
 for(const t of defaultSpinTiers()){let start=0;for(let i=0;i<t.sectors.length;i++){const w=t.sectors[i].weight;assert.equal(sampleSpinSector(t.sectors,()=>start),i);assert.equal(sampleSpinSector(t.sectors,()=>start+w-1),i);start+=w;}assert.equal(start,30000);}
});
test('duplicate, missing and equal-jackpot tiers cannot be published',()=>{
 const t=defaultSpinTiers();assert.throws(()=>validateSpinTiers([t[0],t[0],t[2]]));assert.throws(()=>validateSpinTiers(t.map(x=>({...x,sectors:t[0].sectors}))),/higher/);
});
test('existing profile adulthood is checked without a separate game-access record',()=>{
 const p={date_of_birth:'2008-10-14',kyc_status:'approved'};assert.equal(spinProfileEligibility(p,[],new Date('2026-10-14T00:00:00Z')).eligible,true);assert.equal(spinProfileEligibility({...p,date_of_birth:'2008-10-15'},[],new Date('2026-10-14T00:00:00Z')).eligible,false);assert.equal(spinProfileEligibility({...p,date_of_birth:'2008-02-30'}).eligible,false);assert.equal(spinProfileEligibility({...p,is_wallet_frozen:true}).eligible,false);
});
test('all fee choices charge exactly once and each bundle has exactly three prizes',()=>withTier(async f=>{
 for(const [i,tier] of [500,1000,2000].entries()){const p=await f.prepare(tier,String(i+1).repeat(64));assert.equal(p.error,null);assert.equal(Number(p.data.entry_minor),tier);assert.equal(Number(p.data.reserve_minor),15000);await reconcileSpinRound(f.db,p.data.id,f.provider);for(let index=1;index<=3;index++){await f.draw(p.data.id,index,0);await reconcileSpinRound(f.db,p.data.id,f.provider);}assert.equal((await reconcileSpinRound(f.db,p.data.id,f.provider)).state,'completed');}
 const entries=(await f.pg.query("select amount_minor from matmove_spin_legs where kind='entry' order by amount_minor")).rows.map(r=>Number(r.amount_minor));assert.deepEqual(entries,[500,1000,2000]);assert.equal(f.original.posts,12);assert.equal((await f.pg.query('select count(*) n from matmove_spin_access')).rows[0].n,0);
}));
test('insufficient balance for the selected price never creates an entry or transfer',()=>withTier(async f=>{
 f.setAvailable(1999);await assert.rejects(f.invoke({tierMinor:2000,acceptedEntryMinor:2000}),/SLE 20/);assert.equal(f.original.posts,0);assert.equal((await f.pg.query('select count(*) n from matmove_spin_rounds')).rows[0].n,0);
}));
test('server rejects unsupported prices and stale accepted fees',()=>withTier(async f=>{
 await assert.rejects(f.invoke({tierMinor:1000,acceptedEntryMinor:500}),/Review/);await assert.rejects(f.invoke({tierMinor:999,acceptedEntryMinor:999}),/Choose/);assert.equal(f.original.posts,0);
}));
test('reusing a paid key returns the same bundle and changed price is rejected',()=>withTier(async f=>{
 const a=await f.invoke({tierMinor:2000,acceptedEntryMinor:2000});assert.equal(a.body.round.entryMinor,2000);const b=await f.invoke({tierMinor:2000,acceptedEntryMinor:2000});assert.equal(a.body.round.id,b.body.round.id);assert.equal(f.original.posts,1);
 await assert.rejects(f.invoke({tierMinor:1000,acceptedEntryMinor:1000}),/changed/);assert.equal(f.original.posts,1);
}));
test('first spin can pay SLE 50 in every tier, with no winnings fee',()=>withTier(async f=>{
 for(const [i,tier] of [500,1000,2000].entries()){const p=await f.prepare(tier,String(i+1).repeat(64));await reconcileSpinRound(f.db,p.data.id,f.provider);await f.draw(p.data.id,1,20);await reconcileSpinRound(f.db,p.data.id,f.provider);for(let index=2;index<=3;index++){await f.draw(p.data.id,index,0);await reconcileSpinRound(f.db,p.data.id,f.provider);}}
 const wins=(await f.pg.query("select * from matmove_spin_legs where kind='win' and spin_index=1")).rows;assert.equal(wins.length,3);assert.ok(wins.every(w=>Number(w.amount_minor)===5000&&w.source_account==='fac-spin'&&w.destination_account==='fac-user'));
}));
test('client outcome fields cannot pick the server prize',()=>withTier(async f=>{
 const a=await f.invoke();const b=await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1,sectorIndex:20,prizeMinor:5000},()=>0);assert.equal(b.body.round.receipts.find(r=>r.index===1).amountMinor,100);assert.equal(f.original.posts,2);
}));
test('SLE 150 prize capacity is required before the customer debit',()=>withTier(async f=>{
 const p=await f.prepare(500,'a'.repeat(64),14999);assert.match(p.error.message,/prize reserve/);assert.equal(f.original.posts,0);
}));
test('two customers cannot reserve the same last SLE 150',()=>withTier(async f=>{
 const a=await f.prepare(500,'a'.repeat(64),15000);assert.equal(a.error,null);
 const wallet2='55555555-5555-4555-8555-555555555555';await f.pg.exec(`update profiles set date_of_birth='1980-01-01' where id='${other}';insert into wallets(id,user_id,currency,monime_account_id) values('${wallet2}','${other}','SLE','fac-other');`);
 const b=await f.db.rpc('matmove_spin_prepare_tier',{p_key:'b'.repeat(64),p_user:other,p_wallet:wallet2,p_config:2,p_digit:'0',p_source:'fac-other',p_spin:'fac-spin',p_balance:15000,p_observed:new Date().toISOString(),p_tier:2000});assert.match(b.error.message,/prize reserve/);assert.equal((await f.pg.query('select count(*) n from matmove_spin_rounds')).rows[0].n,1);
}));
test('adult profile, identity status and freeze checks are enforced again by SQL',()=>withTier(async f=>{
 await f.pg.exec(`update profiles set date_of_birth='2020-01-01' where id='${user}'`);let p=await f.prepare();assert.match(p.error.message,/adults/);
 await f.pg.exec(`update profiles set date_of_birth='1980-01-01',kyc_status='pending' where id='${user}'`);p=await f.prepare();assert.match(p.error.message,/identity verification/);
 await f.pg.exec(`update profiles set kyc_status='approved' where id='${user}';update wallets set is_frozen=true where id='${wallet}'`);p=await f.prepare();assert.match(p.error.message,/frozen/);assert.equal(f.original.posts,0);
}));
test('old paid rounds keep their SLE 5 fee, original prizes and SLE 60 reserve',()=>withTier(async f=>{
 const before=(await f.pg.query('select * from matmove_spin_rounds where id=$1',[f.legacyId])).rows[0];assert.equal(Number(before.entry_minor),500);assert.equal(Number(before.reserve_minor),6000);assert.equal(before.sectors.length,100);
 for(let index=1;index<=3;index++){await f.draw(f.legacyId,index,20);await reconcileSpinRound(f.db,f.legacyId,f.provider);}assert.equal(f.original.posts,4);const wins=(await f.pg.query("select * from matmove_spin_legs where kind='win'")).rows;assert.ok(wins.every(w=>Number(w.amount_minor)===2000));
},true));
test('publishing new weights cannot rewrite an already purchased tier',()=>withTier(async f=>{
 const p=await f.prepare(1000);const original=p.data.sectors;
 await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);const changed=defaultSpinTiers();changed[1].sectors[0].digit='99';const saved=await f.db.rpc('matmove_spin_admin_save_tiers',{p_expected:2,p_enabled:true,p_tiers:changed});assert.equal(saved.error,null);assert.equal(Number(saved.data.id),3);
 const after=(await f.pg.query('select sectors from matmove_spin_rounds where id=$1',[p.data.id])).rows[0].sectors;assert.deepEqual(after,original);
}));
test('SQL rejects tier probabilities contradicting the higher-chance claim',()=>withTier(async f=>{
 await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);const t=defaultSpinTiers();t[1].sectors=t[0].sectors;const r=await f.db.rpc('matmove_spin_admin_save_tiers',{p_expected:2,p_enabled:true,p_tiers:t});assert.match(r.error.message,/higher SLE 50 chance/);const bad=defaultSpinTiers();delete bad[0].entryMinor;const invalid=await f.db.rpc('matmove_spin_admin_save_tiers',{p_expected:2,p_enabled:true,p_tiers:bad});assert.match(invalid.error.message,/Each SLE 5, 10 and 20 tier/);
}));
test('quote shows current affordability and three prices without debiting',()=>withTier(async f=>{
 f.setAvailable(999);const r=await f.invoke({action:'spin_config'});assert.deepEqual(r.body.config.tiers.map(t=>t.entryMinor),[500,1000,2000]);assert.equal(r.body.availableMinor,999);assert.equal(r.body.eligibility.eligible,true);assert.equal(f.original.posts,0);
}));
test('browser roles cannot prepare charges or publish tier rules',()=>withTier(async f=>{
 await f.pg.exec(`grant usage on schema public to authenticated;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await assert.rejects(f.pg.query('select matmove_spin_prepare_tier($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',['a'.repeat(64),user,wallet,2,'0','fac-user','fac-spin',15000,new Date().toISOString(),500]),/permission denied/);
 await assert.rejects(f.pg.query('select matmove_spin_admin_save_tiers($1,$2,$3)',[2,true,JSON.stringify(defaultSpinTiers())]),/administrator permission/);
}));
test('reports sum actual tier fees and individual credited winnings without fixed SLE 5 assumptions',()=>withTier(async f=>{
 for(const [i,tier] of [500,1000,2000].entries()){const p=await f.prepare(tier,String(i+1).repeat(64));await reconcileSpinRound(f.db,p.data.id,f.provider);for(let index=1;index<=3;index++){await f.draw(p.data.id,index,0);await reconcileSpinRound(f.db,p.data.id,f.provider);}}
 await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
 const r=await f.db.rpc('matmove_spin_admin_report',{p_view:'players',p_page:1,p_search:'',p_status:'all',p_player:user});assert.equal(r.error,null);assert.equal(r.data.stats.entryReceivedMinor,3500);assert.equal(r.data.stats.winsPaidMinor,900);assert.equal(r.data.rows[0].paid_entries,3);assert.equal(r.data.rows[0].entry_paid_minor,3500);assert.equal(r.data.rows[0].wins_paid_minor,900);
}));
