
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {defaultArcadeSettings,validateArcadeSettings,arcadeEntry,arcadeResult,drawArcadeValues,arcadeOdds} from '../shared/arcade-payment-rules.js';
import {arcadeAction,reconcileArcadeRound,arcadeSnapshot,matchesArcadeReceipt,publicArcadeConfig,reconcileArcades} from '../server/arcade-payments.js';
import {reconcileSpinRound} from '../server/spin-payments.js';
const user='11111111-1111-4111-8111-111111111111',wallet='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',admin='44444444-4444-4444-8444-444444444444',otherWallet='55555555-5555-4555-8555-555555555555';
const request='66666666-6666-4666-8666-666666666666';
const migration=()=>readFile(new URL('../docs/ARCADE_GAMES_SETUP.sql',import.meta.url),'utf8');
async function fixture(){
 const pg=new PGlite();
 try {
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false,date_of_birth date,email text,full_name text);
 create table wallets(id uuid primary key,user_id uuid,currency text,monime_account_id text,metadata jsonb default '{}',is_frozen boolean default false);
 create table admins(id uuid primary key,role text,is_active boolean default true,permissions jsonb default '[]');
 insert into profiles values('${user}','rider','approved',false,'1990-01-01','rider@example.com','Rider'),('${other}','merchant','approved',false,'1990-01-01','merchant@example.com','Merchant');
 insert into wallets(id,user_id,currency,monime_account_id) values('${wallet}','${user}','SLE','fac-user'),('${otherWallet}','${other}','SLE','fac-other');
 insert into admins values('${admin}','super_admin',true,'["games.settings","games.overview","games.players","games.entries","games.winnings","games.recovery"]');
 create function matmove_admin_any(p_keys text[]) returns boolean language sql security definer set search_path=pg_catalog,public as $$select exists(select 1 from admins a where a.id=auth.uid() and a.is_active and exists(select 1 from unnest(p_keys) k where a.permissions ? k))$$;
 create function matmove_admin_can(p_key text) returns boolean language sql security definer set search_path=pg_catalog,public as $$select matmove_admin_any(ARRAY[p_key])$$;
 grant usage on schema public to authenticated,anon;
 `);
 for(const name of ['SPIN_GAME_SETUP.sql','SPIN_TIERS_SETUP.sql','SPIN_SIX_SEGMENTS_SETUP.sql','SPIN_BUNDLES_V2_SETUP.sql'])await pg.exec(await readFile(new URL('../docs/'+name,import.meta.url),'utf8'));
 await pg.exec(await migration());await pg.exec(await migration());
 const rpc=async(name,args={})=>{
  const keys=Object.keys(args),values=keys.map(k=>k==='p_values'?'{'+args[k].join(',')+'}':args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
  const result=await pg.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as data`,values);return result.rows[0].data;
 };
 const db={rpc:async(name,args)=>{try{return {data:await rpc(name,args),error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}},from:table=>{
  const where=[],vals=[];let cols='*',ordering='',lim='';
  const run=async(single)=>{try{const r=await pg.query(`select ${cols} from ${table}${where.length?' where '+where.join(' and '):''}${ordering}${lim}`,vals);if(single&&r.rows.length>1)return {data:null,error:Error('Multiple rows')};return {data:single?r.rows[0]||null:r.rows,error:null};}catch(e){return {data:null,error:e};}};
  const q={select:c=>{cols=c;return q;},eq:(c,v)=>{vals.push(v);where.push(`${c}=$${vals.length}`);return q;},in:(c,v)=>{where.push(`${c} in (${v.map(a=>{vals.push(a);return '$'+vals.length;}).join(',')})`);return q;},or:s=>{const value=s.split('.eq.')[1].split(',')[0];vals.push(value);where.push(`(monime_account_id=$${vals.length} or metadata->>'monime_account_id'=$${vals.length})`);return q;},order:(c,o)=>{ordering=` order by ${c} ${o?.ascending===false?'desc':'asc'}`;return q;},limit:n=>{lim=` limit ${n}`;return q;},maybeSingle:()=>run(true),single:()=>run(true),then:(resolve,reject)=>run(false).then(resolve,reject)};return q;
 }};
 const balances={'fac-user':100000,'fac-other':100000,'fac-spin':1000000},receipts=new Map(),posted=[];let state='completed',wrong=false;
 const apply=r=>{if(r.status==='completed'&&!r.applied){balances[r.sourceFinancialAccount.id]-=r.amount.value;balances[r.destinationFinancialAccount.id]+=r.amount.value;r.applied=true;}};
 const account=id=>({id,currency:'SLE',balance:{available:{currency:'SLE',value:balances[id]}}});
 const provider=async(path,opts)=>{
  if(path.startsWith('financial-accounts/'))return account(path.split('/')[1].split('?')[0]);
  if(opts?.method==='POST'){const b=JSON.parse(opts.body),r={...b,id:'trn-arcade'+(posted.length+1),status:state};posted.push(b);if(wrong)r.destinationFinancialAccount={id:'fac-wrong'};receipts.set(r.id,r);if(!wrong)apply(r);return {...r};}
  const r=receipts.get(path.split('/').pop());if(!r)throw Error('Missing receipt');r.status=state;if(!wrong)apply(r);return {...r};
 };
 const session=async id=>pg.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
 await session(admin);const settings=defaultArcadeSettings();for(const v of Object.values(settings))v.enabled=true;
 const config=await rpc('matmove_arcade_admin_save',{p_expected:1,p_settings:settings});
 // Use the original wheel publisher; this does not bypass the shared check.
 const wheelConfig=(await pg.query('select * from matmove_spin_configs order by id desc limit 1')).rows[0];
 await rpc('matmove_spin_admin_save_bundle',{p_expected:wheelConfig.id,p_enabled:true,p_tiers:wheelConfig.bundle_tiers});
 await session(null);
 const prepare=async(game='fruity',prediction={},key='a'.repeat(64),who=user,treasury=1000000)=>{
  const e=arcadeEntry(game,prediction,settings);
  return rpc('matmove_arcade_prepare',{p_key:key,p_user:who,p_wallet:who===user?wallet:otherWallet,p_config:config.id,p_game:game,p_prediction:e.prediction,p_accepted:e.entryMinor,p_accepted_prize:game==='dice'?e.maximumPrizeMinor:null,p_source:who===user?'fac-user':'fac-other',p_spin:'fac-spin',p_balance:treasury,p_observed:new Date().toISOString()});
 };
 const spinPrepare=async(who=user,treasury=1000000)=>rpc('matmove_spin_prepare_bundle',{p_key:(who===user?'d':'e').repeat(64),p_user:who,p_wallet:who===user?wallet:otherWallet,p_config:(await pg.query('select max(id) id from matmove_spin_configs')).rows[0].id,p_digit:'0',p_source:who===user?'fac-user':'fac-other',p_spin:'fac-spin',p_balance:treasury,p_observed:new Date().toISOString(),p_tier:500});
 const draw=(id,index,values)=>rpc('matmove_arcade_draw',{p_id:id,p_user:user,p_index:index,p_values:values});
 const action=async(body,who=user)=>{
  const profile=(await pg.query('select to_jsonb(p) profile from profiles p where id=$1',[who])).rows[0].profile;const wallets=(await pg.query('select * from wallets where user_id=$1',[who])).rows;
  const res={status(n){this.code=n;return this;},json(data){this.body=data;return this;}};
  await arcadeAction({body,matmove:{db,user:{id:who},profile,wallets}},res,{provider,verifyAccount:async(db,w)=>account(w.monime_account_id),draw:()=>0});return res;
 };
 return {pg,db,rpc,session,prepare,spinPrepare,draw,provider,settings,config,balances,posted,receipts,action,setStatus:s=>state=s,setWrong:v=>wrong=v};
 } catch(error) {await pg.close();throw error;}
}
async function withFixture(fn){const old=process.env.MATMOVE_SPIN_ENABLED,spin=process.env.MONIME_SPIN_ACCOUNT_ID;process.env.MATMOVE_SPIN_ENABLED='true';process.env.MONIME_SPIN_ACCOUNT_ID='fac-spin';let f;try{f=await fixture();await fn(f);}finally{await f?.pg.close();if(old===undefined)delete process.env.MATMOVE_SPIN_ENABLED;else process.env.MATMOVE_SPIN_ENABLED=old;if(spin===undefined)delete process.env.MONIME_SPIN_ACCOUNT_ID;else process.env.MONIME_SPIN_ACCOUNT_ID=spin;}}

test('uniform fruit and number odds, duplicate fruit icons retain separate IDs, and dice quote matches all 36 outcomes',()=>{
 const s=defaultArcadeSettings();assert.equal(arcadeOdds('fruity',s.fruity).probability,1/125000);assert.equal(arcadeOdds('crankling',s.crankling).probability,0.001);
 assert.equal(arcadeResult('fruity',[1,1,1,2],{},s.fruity).prizeMinor,0);assert.equal(arcadeResult('fruity',[49,49,49,49],{},s.fruity).prizeMinor,5000);
 assert.equal(arcadeResult('crankling',[3,3,3],{luckyNumber:5},s.crankling).prizeMinor,0);assert.equal(arcadeResult('crankling',[5,5,5],{luckyNumber:5},s.crankling).prizeMinor,5000);
 for(const comparison of ['above','equal','below'])for(let target=2;target<=12;target++){
  const input={stakeMinor:500,target,comparison};let q;try{q=arcadeEntry('dice',input,s);}catch{continue;}
  let paid=0,wins=0;for(let a=1;a<=6;a++)for(let b=1;b<=6;b++){const r=arcadeResult('dice',[a,b],input,s.dice);paid+=r.prizeMinor;wins+=Number(r.won);}
  assert.equal(wins,q.quote.wins);assert.ok(paid/36<=450);assert.equal(q.quote.payoutMinor,q.maximumPrizeMinor);
 }
 assert.throws(()=>drawArcadeValues('dice',()=>6),/random/);assert.throws(()=>validateArcadeSettings({...s,fruity:{...s.fruity,attempts:4}}),/three/);
});

test('migration reruns preserve settings; browser roles cannot run money RPCs or forge outcomes',()=>withFixture(async f=>{
 await f.pg.exec('set role authenticated');
 await assert.rejects(()=>f.prepare(),/permission denied/);await assert.rejects(()=>f.pg.exec('select * from matmove_arcade_legs'),/permission denied/);
 await f.pg.exec('reset role');assert.equal((await f.pg.query('select count(*) n from matmove_arcade_configs')).rows[0].n,2);
 await assert.rejects(()=>f.pg.exec("update matmove_arcade_configs set settings='{}'"),/cannot be rewritten/);
}));

test('free Fruity Flue pays the customer exactly SLE50 on four matching fruits and never debits an entry',()=>withFixture(async f=>{
 const r=await f.prepare();assert.equal(r.state,'active');assert.equal(f.posted.length,0);
 await f.draw(r.id,1,[9,9,9,9]);const paid=await reconcileArcadeRound(f.db,r.id,f.provider);assert.equal(paid.state,'active');
 assert.equal(f.posted.length,1);assert.equal(f.posted[0].amount.value,5000);assert.equal(f.posted[0].sourceFinancialAccount.id,'fac-spin');assert.equal(f.posted[0].destinationFinancialAccount.id,'fac-user');
 assert.equal(f.balances['fac-user'],105000);assert.equal(f.balances['fac-spin'],995000);
 await f.draw(r.id,1,[1,2,3,4]);await reconcileArcadeRound(f.db,r.id,f.provider);assert.equal(f.posted.length,1);
 const snap=await arcadeSnapshot(f.db,paid);assert.equal(snap.paidMinor,5000);assert.equal(snap.outcomes[0].paymentStatus,'completed');
}));

test('three free attempts use a rolling 24-hour window even after all three are used',()=>withFixture(async f=>{
 const r=await f.prepare();for(let i=1;i<=3;i++)await f.draw(r.id,i,[0,1,2,3]);
 await assert.rejects(()=>f.draw(r.id,4,[1,1,1,1]),/Complete|sequence/);
 await assert.rejects(()=>f.prepare('fruity',{},'b'.repeat(64)),/24 hours/);
 await f.pg.query("update matmove_arcade_rounds set created_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 hour' where id=$1",[r.id]);
 const next=await f.prepare('fruity',{},'b'.repeat(64));assert.notEqual(next.id,r.id);
}));

test('CRANKLING credits only three copies of the PRESELECTED number; exactly three attempts per SLE20 entry',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:5});await reconcileArcadeRound(f.db,r.id,f.provider);assert.equal(f.posted[0].amount.value,2000);
 await f.draw(r.id,1,[3,3,3]);assert.equal(f.posted.length,1);
 await f.draw(r.id,2,[5,5,5]);await reconcileArcadeRound(f.db,r.id,f.provider);
 await f.draw(r.id,3,[5,5,4]);assert.equal(f.posted.length,2);assert.equal(f.balances['fac-user'],103000);
 assert.equal((await f.pg.query('select state from matmove_arcade_rounds where id=$1',[r.id])).rows[0].state,'completed');
 await assert.rejects(()=>f.draw(r.id,4,[5,5,5]),/Complete|sequence/);
}));

test('dice entry and winning are separate exact transfers; SQL recomputes the quoted payout',()=>withFixture(async f=>{
 const prediction={stakeMinor:500,target:7,comparison:'equal'},r=await f.prepare('dice',prediction);
 await reconcileArcadeRound(f.db,r.id,f.provider);const o=await f.draw(r.id,1,[3,4]);assert.equal(o.prize_minor,2700);
 const done=await reconcileArcadeRound(f.db,r.id,f.provider);assert.equal(done.state,'completed');assert.equal(f.posted.length,2);assert.equal(f.balances['fac-user'],102200);
}));

test('pending entry blocks drawings and polls the original receipt without a second debit',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});f.setStatus('processing');await reconcileArcadeRound(f.db,r.id,f.provider);
 await assert.rejects(()=>f.draw(r.id,1,[1,1,1]),/pending payment/);
 f.setStatus('completed');assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'active');assert.equal(f.posted.length,1);
}));

test('lost provider response remains reserved for review and is never automatically resent',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});let posts=0;
 await assert.rejects(()=>reconcileArcadeRound(f.db,r.id,async()=>{posts++;throw Error('Lost response');}),/Lost/);
 const again=await reconcileArcadeRound(f.db,r.id,f.provider);assert.equal(again.state,'review_required');assert.equal(posts,1);assert.equal(f.posted.length,0);
 await assert.rejects(()=>f.prepare('crankling',{luckyNumber:1},'b'.repeat(64)),/existing game/);
}));

test('two claims authorize only one transfer POST, including delayed missing responses',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});const args={p_id:r.id,p_index:0};
 assert.equal((await f.rpc('matmove_arcade_claim',args)).can_create,true);assert.equal((await f.rpc('matmove_arcade_claim',args)).can_create,false);
 await f.pg.query("update matmove_arcade_legs set claimed_at=clock_timestamp()-interval '2 minutes' where round_id=$1",[r.id]);
 assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'review_required');assert.equal(f.posted.length,0);
}));

test('wrong recipient, amount or metadata never activates an entry or marks a prize credited',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});f.setWrong(true);assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'review_required');
 const leg=(await f.pg.query('select * from matmove_arcade_legs where round_id=$1',[r.id])).rows[0],base={id:'trn-x',amount:{currency:'SLE',value:2000},sourceFinancialAccount:{id:'fac-user'},destinationFinancialAccount:{id:'fac-spin'},metadata:{matmoveArcadeRoundId:r.id,arcadeGame:'crankling',attemptIndex:'0'},status:'completed'};
 assert.equal(matchesArcadeReceipt(base,leg,'crankling'),true);assert.equal(matchesArcadeReceipt({...base,amount:{currency:'SLE',value:1999}},leg,'crankling'),false);assert.equal(matchesArcadeReceipt({...base,metadata:{...base.metadata,arcadeGame:'dice'}},leg,'crankling'),false);
}));

test('freeze before entry prevents a debit; freezing after a winning result retains the unpaid prize',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});await f.pg.query('update wallets set is_frozen=true where id=$1',[wallet]);
 assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'failed');assert.equal(f.posted.length,0);
 await f.pg.query('update wallets set is_frozen=false where id=$1',[wallet]);const next=await f.prepare('crankling',{luckyNumber:1},'b'.repeat(64));await reconcileArcadeRound(f.db,next.id,f.provider);
 await f.draw(next.id,1,[1,1,1]);await f.pg.query('update wallets set is_frozen=true where id=$1',[wallet]);
 assert.equal((await reconcileArcadeRound(f.db,next.id,f.provider)).state,'review_required');assert.equal(f.posted.length,1);
}));

test('wheel entries count new-game reserves, and new games count existing wheel reserves',()=>withFixture(async f=>{
 await f.prepare('fruity',{},'a'.repeat(64),user,15000);
 await assert.rejects(()=>f.spinPrepare(other,15000),/unreserved prize funds/);
 // Fresh observation after a completed free game releases its unused reserve.
 await f.pg.exec("update matmove_arcade_rounds set state='completed',updated_at=clock_timestamp()-interval '2 minutes'");
 const w=await f.spinPrepare(other,2000);assert.equal(Number(w.reserve_minor),1000);
 await assert.rejects(()=>f.prepare('fruity',{},'b'.repeat(64),other,15000),/unreserved prize funds/);
}));

test('balance observations predating completed prize payments still count released reservations',()=>withFixture(async f=>{
 const r=await f.prepare('fruity');const observed=new Date().toISOString();
 for(let i=1;i<=3;i++){await f.draw(r.id,i,[1,1,1,1]);await reconcileArcadeRound(f.db,r.id,f.provider);}
 await assert.rejects(()=>f.rpc('matmove_arcade_check_capacity',{p_spin:'fac-spin',p_balance:15000,p_observed:observed,p_capacity:1000}),/unreserved prize funds/);
}));

test('unpatched legacy wheel inserts fail closed instead of bypassing the combined reserve',()=>withFixture(async f=>{
 const def=(await f.pg.query("select pg_get_functiondef('matmove_spin_prepare_bundle(text,uuid,uuid,bigint,text,text,text,bigint,timestamptz,integer)'::regprocedure) d")).rows[0].d;
 await f.pg.exec(def.replace('perform public.matmove_arcade_check_capacity(p_spin,p_balance,p_observed,capacity);',''));
 await assert.rejects(()=>f.spinPrepare(),/Shared treasury checks/);await f.pg.exec(await migration());assert.ok((await f.spinPrepare()).id);
}));

test('entry keys are idempotent, changed predictions conflict and cancellation prevents delayed charges',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});assert.equal((await f.prepare('crankling',{luckyNumber:1})).id,r.id);
 await assert.rejects(()=>f.prepare('crankling',{luckyNumber:2}),/request changed/);
 const key='b'.repeat(64);assert.equal((await f.rpc('matmove_arcade_cancel',{p_key:key,p_user:user})).canceled,true);
 await assert.rejects(()=>f.prepare('fruity',{},key),/canceled/);
 assert.equal((await f.rpc('matmove_arcade_cancel',{p_key:'a'.repeat(64),p_user:user})).roundId,r.id);
}));

test('purchased snapshots survive Admin changes and disabling future purchases',()=>withFixture(async f=>{
 const r=await f.prepare('crankling',{luckyNumber:1});await reconcileArcadeRound(f.db,r.id,f.provider);
 await f.session(admin);const settings=structuredClone(f.settings);settings.crankling.enabled=false;settings.crankling.prizeMinor=9000;
 await f.rpc('matmove_arcade_admin_save',{p_expected:f.config.id,p_settings:settings});await f.session(null);
 const o=await f.draw(r.id,1,[1,1,1]);assert.equal(o.prize_minor,5000);assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'active');
}));

test('quotes are read-only, low user balance blocks entry and exact accepted totals are required',()=>withFixture(async f=>{
 const quote=await f.action({action:'arcade_quote',game:'dice',prediction:{stakeMinor:500,target:7,comparison:'equal'}});assert.equal(quote.body.quote.payoutMinor,2700);assert.equal(f.posted.length,0);
 const body={action:'arcade_enter',game:'dice',prediction:{stakeMinor:500,target:7,comparison:'equal'},requestKey:request,configId:f.config.id,acceptedEntryMinor:500,acceptedPayoutMinor:2700,acceptRules:true};
 await assert.rejects(()=>f.action({...body,acceptedEntryMinor:499}),/accept the current/);
 f.balances['fac-user']=499;await assert.rejects(()=>f.action(body),/too low/);assert.equal(f.posted.length,0);
 f.balances['fac-user']=1000;const entered=await f.action(body);assert.equal(entered.body.round.state,'active');assert.equal(f.posted.length,1);
 const again=await f.action(body);assert.equal(again.body.round.id,entered.body.round.id);assert.equal(f.posted.length,1);
 await assert.rejects(()=>f.action({...body,prediction:{stakeMinor:500,target:8,comparison:'equal'}}),/request changed/);
}));

test('API forbids another player status or draw, ignores supplied outcomes and publishes only sanitized configuration',()=>withFixture(async f=>{
 const r=await f.prepare();await assert.rejects(()=>f.action({action:'arcade_status',roundId:r.id},other),/not found/);
 const result=await f.action({action:'arcade_draw',roundId:r.id,attemptIndex:1,values:[1,2,3,4],prizeMinor:999999});assert.deepEqual(result.body.round.outcomes[0].values,[0,0,0,0]);assert.equal(result.body.round.paidMinor,5000);
 const publicData=await publicArcadeConfig(f.db),serialized=JSON.stringify(publicData);assert.equal(publicData.config.settings.fruity.attempts,3);assert.ok(!serialized.includes('fac-spin')&&!serialized.includes('example.com')&&!serialized.includes('request_key'));
}));

test('granular Admin grants restrict settings, reports and receipt attachment; recovery never resends',()=>withFixture(async f=>{
 await f.session(user);await f.pg.exec('set role authenticated');await assert.rejects(()=>f.rpc('matmove_arcade_admin_report',{p_view:'rounds'}),/not assigned/);await f.pg.exec('reset role');
 const r=await f.prepare('crankling',{luckyNumber:1});let receipt;
 await assert.rejects(()=>reconcileArcadeRound(f.db,r.id,async(path,opts)=>{receipt=await f.provider(path,opts);throw Error('lost');}),/lost/);
 await f.session(admin);await f.pg.exec('set role authenticated');
 await f.rpc('matmove_arcade_admin_receipt',{p_id:r.id,p_index:0,p_provider:receipt.id});await f.pg.exec('reset role');
 assert.equal((await reconcileArcadeRound(f.db,r.id,f.provider)).state,'active');assert.equal(f.posted.length,1);
 const reports=await f.rpc('matmove_arcade_admin_report',{p_view:'entries'});assert.equal(reports.rows[0].status,'completed');assert.equal(reports.rows[0].amount_minor,2000);
 await f.pg.query("update admins set permissions='[\"games.settings\"]' where id=$1",[admin]);
 assert.ok((await f.rpc('matmove_arcade_admin_report',{p_view:'settings'})).config);await assert.rejects(()=>f.rpc('matmove_arcade_admin_report',{p_view:'players'}),/not assigned/);
 await f.pg.query('update admins set is_active=false where id=$1',[admin]);await assert.rejects(()=>f.rpc('matmove_arcade_admin_save',{p_expected:f.config.id,p_settings:f.settings}),/permission required/);
}));

test('background reconciliation requires the server secret and GET, never a browser session token',async()=>{
 const res={status(n){this.code=n;return this;},json(b){this.body=b;return this;}};const old=process.env.CRON_SECRET;process.env.CRON_SECRET='server-only-secret';
 try{await reconcileArcades({method:'POST',headers:{}},res);assert.equal(res.code,405);await reconcileArcades({method:'GET',headers:{authorization:'Bearer browser-token'}},res);assert.equal(res.code,401);}finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});


test('existing one-spin wheel still debits its saved fee and credits its saved prize after shared treasury installation',()=>withFixture(async f=>{
 const r=await f.spinPrepare();assert.equal((await reconcileSpinRound(f.db,r.id,f.provider)).state,'active');
 await f.rpc('matmove_spin_draw_bundle',{p_id:r.id,p_user:user,p_index:1,p_sector:0});
 assert.equal((await reconcileSpinRound(f.db,r.id,f.provider)).state,'completed');
 assert.equal(f.posted.length,2);assert.equal(f.posted[0].amount.value,500);assert.equal(f.posted[1].amount.value,100);assert.equal(f.balances['fac-user'],99600);
}));

test('SQL dice quotes match the displayed JavaScript multiplier for every possible prediction',()=>withFixture(async f=>{
 for(const comparison of ['above','equal','below'])for(let target=2;target<=12;target++){
  const input={stakeMinor:101,target,comparison};let entry;try{entry=arcadeEntry('dice',input,f.settings);}catch{continue;}
  const q=await f.rpc('matmove_arcade_dice_quote',{p_rules:f.settings.dice,p_prediction:input});
  assert.equal(q.multiplierHundredths,entry.quote.multiplierHundredths);assert.equal(q.payoutMinor,entry.maximumPrizeMinor);assert.equal(q.wins,entry.quote.wins);
 }
}));

test('unverified or underage accounts cannot create paid or free games, without provider calls',()=>withFixture(async f=>{
 await f.pg.query("update profiles set kyc_status='not_started' where id=$1",[user]);
 await assert.rejects(()=>f.prepare(),/Verified adult/);
 await assert.rejects(()=>f.action({action:'arcade_enter',game:'fruity',prediction:{},requestKey:request,configId:f.config.id,acceptedEntryMinor:0,acceptRules:true}),/Verify your identity/);
 await f.pg.query("update profiles set kyc_status='approved',date_of_birth=(current_date-interval '10 years')::date where id=$1",[user]);
 await assert.rejects(()=>f.prepare(),/Verified adult/);assert.equal(f.posted.length,0);
}));
