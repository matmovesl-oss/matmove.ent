


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
test('six equal segments match requested prizes; duplicate cash values allowed',()=>{
 const t=defaultSixTiers();assert.deepEqual(t.map(x=>x.sectors.slice(0,4).map(s=>s.prizeMinor)),[[1000,2000,100,300],[500,2000,200,400],[1500,2500,300,400]]);
 for(const x of t){for(let i=0;i<6;i++)assert.equal(sampleSix(x.sectors,()=>i),i);assert.deepEqual([0,1,2,3,4].map(n=>sampleSix(x.sectors,()=>n,true)),[0,1,2,3,5]);}
 t[2].sectors[3].prizeMinor=300;assert.equal(validateSixTiers(t)[2].sectors[3].prizeMinor,300);
 assert.equal(sixEconomics(t[0].sectors,500).expectedPrizeMinor,680);
});
test('fixed outcomes and equal chances cannot be silently changed',()=>{
 const t=defaultSixTiers();t[0].sectors[4].kind='cash';assert.throws(()=>validateSixTiers(t));
 const u=defaultSixTiers();u[0].sectors[0].weight=2;assert.throws(()=>validateSixTiers(u));
});
test('cash ends game after one full prize; repeated requests never pay twice',()=>withTier(async f=>{
 const a=await f.invoke();assert.equal(a.body.round.mode,'six_v1');const id=a.body.round.id;
 const b=await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>0);assert.equal(b.body.round.state,'completed');assert.equal(b.body.round.paidMinor,1000);assert.equal(f.original.posts,2);
 await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>3);assert.equal(f.original.posts,2);
 const bad=await next(f,id,2,0);assert.match(bad.error.message,/Complete|bonus/i);
}));
test('no-prize outcome ends game without a fake zero transfer',()=>withTier(async f=>{
 const a=await f.invoke();const b=await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1},()=>5);
 assert.equal(b.body.round.state,'completed');assert.equal(b.body.round.paidMinor,0);assert.equal(b.body.round.receipts[1].kind,'lose');assert.equal(f.original.posts,1);
}));
test('one bonus gives one free final spin, no extra charge and no chain',()=>withTier(async f=>{
 const a=await f.invoke();const id=a.body.round.id;const bonus=await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>4);assert.equal(bonus.body.round.state,'active');assert.equal(f.original.posts,1);
 const repeated=await next(f,id,1,0);assert.equal(repeated.data.kind,'again');assert.equal(f.original.posts,1);
 const chain=await next(f,id,2,4);assert.match(chain.error.message,/another bonus/);
 const win=await f.invoke({action:'spin_draw',roundId:id,spinIndex:2},()=>1);assert.equal(win.body.round.state,'completed');assert.equal(win.body.round.paidMinor,2000);assert.equal(f.original.posts,2);
 const third=await next(f,id,3,0);assert.ok(third.error);
}));
test('bonus can end without winnings and cannot require another fee',()=>withTier(async f=>{
 const a=await f.invoke();const id=a.body.round.id;await f.invoke({action:'spin_draw',roundId:id,spinIndex:1},()=>4);const b=await f.invoke({action:'spin_draw',roundId:id,spinIndex:2},()=>4);assert.equal(b.body.round.state,'completed');assert.equal(b.body.round.receipts[2].kind,'lose');assert.equal(f.original.posts,1);
}));
test('reserve equals maximum single prize, not old three-prize capacity',()=>withTier(async f=>{
 const no=await f.prepare(500,'a'.repeat(64),1999);assert.ok(no.error);
 const ok=await f.prepare(500,'b'.repeat(64),2000);assert.equal(ok.error,null);assert.equal(Number(ok.data.reserve_minor),2000);
}));
test('admin edits future fees and prizes; purchased config immutable',()=>withTier(async f=>{
 const p=await f.prepare();assert.equal(p.error,null);const tiers=defaultSixTiers();tiers[0].entryMinor=700;tiers[0].sectors[0].prizeMinor=400;
 await f.pg.exec(`set request.jwt.claim.sub='${admin}'`);const saved=await f.db.rpc('matmove_spin_admin_save_six',{p_expected:3,p_enabled:true,p_tiers:tiers});assert.equal(saved.error,null);
 const r=(await f.pg.query('select * from matmove_spin_rounds where id=$1',[p.data.id])).rows[0];assert.equal(Number(r.entry_minor),500);assert.equal(r.sectors[0].prizeMinor,1000);
 const quote=await f.invoke({action:'spin_config'});assert.equal(quote.body.config.tiers[0].entryMinor,700);
 const conflict=await f.db.rpc('matmove_spin_admin_save_six',{p_expected:3,p_enabled:true,p_tiers:tiers});assert.ok(conflict.error);
}));
test('SQL validates admin config and browser cannot change money outcomes',()=>withTier(async f=>{
 const t=defaultSixTiers();t[0].sectors[5].prizeMinor=100;const invalid=await f.db.rpc('matmove_spin_validate_six',{p_tiers:t});assert.ok(invalid.error);
 await f.pg.exec('set role authenticated');const draw=await next(f,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,0);assert.equal(draw.error.code,'42501');await assert.rejects(f.pg.exec('select * from matmove_spin_outcomes'),/permission denied/);
}));
test('paid legacy three-spin round keeps full sequence',()=>withTier(async f=>{
 const id=f.legacyId;for(let i=1;i<=3;i++){const d=await f.draw(id,i,0);assert.equal(d.error,null);await reconcileSpinRound(f.db,id,f.provider);}assert.equal((await reconcileSpinRound(f.db,id,f.provider)).state,'completed');
},true));
test('wallet freeze blocks new draw before recording outcome',()=>withTier(async f=>{
 const a=await f.invoke();await f.pg.exec(`update wallets set is_frozen=true where id='${wallet}'`);const d=await next(f,a.body.round.id,1,0);assert.ok(d.error);assert.equal((await f.pg.query('select count(*) n from matmove_spin_outcomes')).rows[0].n,0);
}));
test('cached old client cannot prepare three-spin game on six config',()=>withTier(async f=>{
 const p=await f.db.rpc('matmove_spin_prepare_tier',{p_key:'d'.repeat(64),p_user:user,p_wallet:wallet,p_config:3,p_digit:'0',p_source:'fac-user',p_spin:'fac-spin',p_balance:100000,p_observed:new Date().toISOString(),p_tier:500});assert.ok(p.error);
}));

test('direct backend prize overwrite rejected; new published version updates all clients',()=>withTier(async f=>{
 const t=defaultSixTiers();t[0].sectors[0].prizeMinor=1200;
 await assert.rejects(f.pg.query('update matmove_spin_configs set six_tiers=$1 where id=3',[JSON.stringify(t)]),/new configuration version/);
}));
test('noncash outcomes are visible in admin reports without fake payments',()=>withTier(async f=>{
 const a=await f.invoke();await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1},()=>5);
 await f.pg.exec(`set request.jwt.claim.sub='${admin}'`);const report=await f.db.rpc('matmove_spin_admin_outcomes',{p_page:1});assert.equal(report.error,null);assert.equal(report.data.rows[0].kind,'lose');assert.equal(report.data.rows[0].payment_status,'no_transfer');assert.equal(Number(report.data.rows[0].entry_minor),500);
}));
test('pending prize holds game until receipt confirms; no repeat provider POST',()=>withTier(async f=>{
 const a=await f.invoke();f.setStatus('pending');const b=await f.invoke({action:'spin_draw',roundId:a.body.round.id,spinIndex:1},()=>0);assert.equal(b.body.round.state,'win_pending');assert.equal(f.original.posts,2);
 const repeat=await next(f,a.body.round.id,2,0);assert.ok(repeat.error);f.setStatus('completed');const c=await f.invoke({action:'spin_status',roundId:a.body.round.id});assert.equal(c.body.round.state,'completed');assert.equal(f.original.posts,2);
}));
