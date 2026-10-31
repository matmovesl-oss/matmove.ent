
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
test('five prizes use equal sectors and show the actual expected margin',()=>{
 assert.equal(spinOdds(five).reduce((s,o)=>s+o.probability,0),1);
 assert.equal(spinEconomics(five).maximumRoundPrizeMinor,6000);
 assert.throws(()=>validateSpinSectors(five.slice(1)),/between/);
 assert.throws(()=>validateSpinSectors([...five,{digit:'0',prizeMinor:100}]),/unique/);
 assert.throws(()=>validateSpinSectors(five.map(s=>({...s,prizeMinor:100}))),/five/);
});
test('complete entry and three prizes send only four transfers; repeats cannot pay twice',()=>withFixture(async f=>{
 const p=await f.prepare();assert.equal(p.error,null);const id=p.data.id;
 assert.equal((await reconcileSpinRound(f.db,id,f.provider)).state,'active');
 for(let i=1;i<=3;i++){const d=await f.draw(id,i,20);assert.equal(d.error,null);await reconcileSpinRound(f.db,id,f.provider);}
 const r=await reconcileSpinRound(f.db,id,f.provider);assert.equal(r.state,'completed');assert.equal(f.posts,4);
 const wins=(await f.pg.query("select * from matmove_spin_legs where kind='win'")).rows;
 assert.equal(wins.length,3);assert.ok(wins.every(w=>Number(w.amount_minor)===2000&&w.source_account==='fac-spin'&&w.destination_account==='fac-user'));
 const repeat=await f.draw(id,3,1);assert.equal(repeat.data.sector_index,20);await reconcileSpinRound(f.db,id,f.provider);assert.equal(f.posts,4);
}));
test('the first spin can win the largest advertised prize',()=>withFixture(async f=>{
 const p=await f.prepare();await reconcileSpinRound(f.db,p.data.id,f.provider);const d=await f.draw(p.data.id,1,20);assert.equal(Number(d.data.amount_minor),2000);
}));
test('round config snapshot stays fixed after admin publishes different digits',()=>withFixture(async f=>{
 const p=await f.prepare();await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
 const saved=await f.db.rpc('matmove_spin_admin_save',{p_expected:1,p_enabled:true,p_sectors:five});assert.equal(saved.error,null);
 await reconcileSpinRound(f.db,p.data.id,f.provider);const d=await f.draw(p.data.id,1,20);assert.equal(Number(d.data.amount_minor),2000);assert.equal(d.data.digit,'20');
}));
test('two transfer claims authorize one POST and missing responses are not retried',()=>withFixture(async f=>{
 const p=await f.prepare();const a=await f.db.rpc('matmove_spin_claim',{p_id:p.data.id,p_index:0});const b=await f.db.rpc('matmove_spin_claim',{p_id:p.data.id,p_index:0});assert.equal(a.data.can_create,true);assert.equal(b.data.can_create,false);
 await f.pg.exec("update matmove_spin_legs set claimed_at=now()-interval '2 minutes'");await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(f.posts,0);const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');
}));
test('lost POST response retains round for review and never resends entry',()=>withFixture(async f=>{
 const p=await f.prepare();let posts=0;await assert.rejects(reconcileSpinRound(f.db,p.data.id,async()=>{posts++;throw new Error('lost response');}));
 const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');assert.equal(posts,1);assert.equal(f.posts,0);
}));
test('pending entry polls the original receipt before any spin',()=>withFixture(async f=>{
 const p=await f.prepare();f.setStatus('processing');await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(f.posts,1);
 const d=await f.draw(p.data.id,1,20);assert.match(d.error.message,/Complete/);
 f.setStatus('completed');assert.equal((await reconcileSpinRound(f.db,p.data.id,f.provider)).state,'active');assert.equal(f.posts,1);assert.equal(f.gets,1);
}));
test('wrong destination receipt never activates or credits the game',()=>withFixture(async f=>{
 const p=await f.prepare();f.setWrong(true);const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');assert.equal(f.posts,1);
}));
test('freeze before entry blocks provider calls',()=>withFixture(async f=>{
 const p=await f.prepare();await f.pg.exec(`update wallets set is_frozen=true where id='${wallet}'`);const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'failed');assert.equal(f.posts,0);
}));
test('prize capacity must be funded before receiving any entry fee',()=>withFixture(async f=>{
 const p=await f.prepare('a'.repeat(64),5999);assert.match(p.error.message,/more prize funds/);assert.equal(f.posts,0);assert.equal((await f.pg.query('select count(*) n from matmove_spin_rounds')).rows[0].n,0);
}));
test('duplicate entry key returns original; changed digit conflicts',()=>withFixture(async f=>{
 const a=await f.prepare();const b=await f.prepare();assert.equal(a.data.id,b.data.id);
 const r=await f.pg.query('select matmove_spin_prepare($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['a'.repeat(64),user,wallet,1,'10','fac-user','fac-spin',100000,new Date().toISOString()]).then(()=>null,e=>e);assert.match(r.message,/Entry request changed/);
}));
test('canceling an unstarted key is atomic and prevents a delayed debit',()=>withFixture(async f=>{
 const canceled=await f.db.rpc('matmove_spin_cancel_entry',{p_key:'a'.repeat(64),p_user:user});assert.equal(canceled.data.canceled,true);const p=await f.prepare();assert.match(p.error.message,/canceled/);assert.equal(f.posts,0);
}));
test('cancel request for an existing entry returns its receipt instead of clearing it',()=>withFixture(async f=>{
 const p=await f.prepare();const canceled=await f.db.rpc('matmove_spin_cancel_entry',{p_key:'a'.repeat(64),p_user:user});assert.equal(canceled.data.canceled,false);assert.equal(canceled.data.roundId,p.data.id);
}));
test('browser roles cannot run money RPCs or edit tables; non-admin cannot configure game',()=>withFixture(async f=>{
 await f.pg.exec(`grant usage on schema public to authenticated;select set_config('request.jwt.claim.sub','${user}',false);set role authenticated;`);
 await assert.rejects(f.pg.query('select matmove_spin_draw($1,$2,$3,$4)',[user,user,1,20]),/permission denied/);
 await assert.rejects(f.pg.exec('select * from matmove_spin_legs'),/permission denied/);
 await assert.rejects(f.pg.query('select matmove_spin_admin_save($1,$2,$3)',[1,true,JSON.stringify(five)]),/administrator permission/);
}));
test('status requests cannot access another player and reconciliation rejects browser tokens',()=>withFixture(async f=>{
 const p=await f.prepare();const res={status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
 await assert.rejects(spinAction({body:{action:'spin_status',roundId:p.data.id},matmove:{db:f.db,user:{id:other}}},res),/not found/);
 const old=process.env.CRON_SECRET;process.env.CRON_SECRET='scheduler';try{await reconcileSpins({method:'GET',headers:{authorization:'Bearer customer'}},res);assert.equal(res.code,401);}finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
}));
test('receipt matcher rejects amount or provider changes',()=>{
 const leg={round_id:'game-1',spin_index:0,amount_minor:500,source_account:'fac-user',destination_account:'fac-spin',provider_id:'trn-1'};
 const result={id:'trn-1',metadata:{matmoveSpinRoundId:'game-1',spinIndex:'0'},amount:{value:500,currency:'SLE'},sourceFinancialAccount:{id:'fac-user'},destinationFinancialAccount:{id:'fac-spin'},status:'completed'};
 assert.ok(matchesSpinReceipt(result,leg));assert.equal(matchesSpinReceipt({...result,id:'trn-2'},leg),false);assert.equal(matchesSpinReceipt({...result,amount:{value:1,currency:'SLE'}},leg),false);
});

test('freeze after entry retains the paid round without drawing or sending a prize',()=>withFixture(async f=>{
 const p=await f.prepare();await reconcileSpinRound(f.db,p.data.id,f.provider);
 await f.pg.exec(`update wallets set is_frozen=true where id='${wallet}'`);
 const d=await f.draw(p.data.id,1,20);assert.match(d.error.message,/Wallet frozen/);assert.equal(f.posts,1);
 const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'active');
}));
test('disabling future entries does not change or cancel purchased spins',()=>withFixture(async f=>{
 const p=await f.prepare();await reconcileSpinRound(f.db,p.data.id,f.provider);await f.pg.exec('update matmove_spin_configs set enabled=false');
 const d=await f.draw(p.data.id,1,20);assert.equal(d.error,null);await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(f.posts,2);
}));
test('a daily entry limit blocks a third round and the game cannot draw a fourth spin',()=>withFixture(async f=>{
 for(const key of ['a','b']){const p=await f.prepare(key.repeat(64));assert.equal(p.error,null);await reconcileSpinRound(f.db,p.data.id,f.provider);for(let i=1;i<=3;i++){await f.draw(p.data.id,i,0);await reconcileSpinRound(f.db,p.data.id,f.provider);}const fourth=await f.draw(p.data.id,4,20);assert.match(fourth.error.message,/current payment/);}
 const p=await f.prepare('c'.repeat(64));assert.match(p.error.message,/daily game entry limit/);assert.equal(f.posts,8);
}));
test('an attached existing receipt is verified without a second POST',()=>withFixture(async f=>{
 const p=await f.prepare();f.setStatus('processing');await reconcileSpinRound(f.db,p.data.id,f.provider);
 await f.pg.exec(`update matmove_spin_legs set status='review_required';update matmove_spin_rounds set state='review_required';select set_config('request.jwt.claim.sub','${admin}',false);`);
 const receipt=await f.db.rpc('matmove_spin_admin_receipt',{p_id:p.data.id,p_index:0,p_provider:'trn-1'});assert.equal(receipt.error,null);
 f.setStatus('completed');const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'active');assert.equal(f.posts,1);assert.equal(f.gets,1);
}));
test('failed prize remains owed and blocks new paid rounds',()=>withFixture(async f=>{
 const p=await f.prepare();await reconcileSpinRound(f.db,p.data.id,f.provider);await f.draw(p.data.id,1,20);f.setStatus('failed');const r=await reconcileSpinRound(f.db,p.data.id,f.provider);assert.equal(r.state,'review_required');
 const next=await f.prepare('b'.repeat(64));assert.match(next.error.message,/existing game/);assert.equal(f.posts,2);
 await f.pg.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);const report=await f.db.rpc('matmove_spin_admin_snapshot',{});assert.equal(Number(report.data.winsOwedMinor),2000);assert.equal(Number(report.data.reservedMinor),6000);
}));
