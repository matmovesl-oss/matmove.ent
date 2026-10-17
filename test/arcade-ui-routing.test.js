
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {defaultArcadeSettings} from '../shared/arcade-payment-rules.js';
const user='11111111-1111-4111-8111-111111111111',roundId='22222222-2222-4222-8222-222222222222';
function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return [n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return '';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
const clone=v=>JSON.parse(JSON.stringify(v));
function round(game='dice',state='active') {return {id:roundId,game,state,configId:2,rules:defaultArcadeSettings()[game],prediction:game==='dice'?{stakeMinor:500,target:7,comparison:'above'}:game==='crankling'?{luckyNumber:7}:{},entryMinor:game==='dice'?500:game==='fruity'?0:2000,attemptCount:game==='dice'?1:3,attemptsUsed:0,expiresAt:game==='fruity'?new Date(Date.now()+86400000).toISOString():null,createdAt:new Date().toISOString(),paidMinor:0,error:null,outcomes:[],receipts:[]};}
function envelope(rounds=[]) {const settings=defaultArcadeSettings();for(const v of Object.values(settings))v.enabled=true;return {config:{id:2,settings},moneyEnabled:true,eligibility:{eligible:true,reason:null},availableMinor:100000,balanceError:null,rounds};}
async function uiBundle(controlled=false){
 const dir=await mkdtemp(join(process.cwd(),'.arcade-ui-'));
 try {
  const out=join(dir,'ui.mjs');
  await build({entryPoints:['src/components/ArcadeGames.tsx'],outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',external:controlled?['react/jsx-runtime','lucide-react']:['react','react/*','lucide-react'],plugins:[{name:'ui-fixture',setup(b){
   b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'auth',namespace:'fixture'}));
   b.onResolve({filter:/^@\/components\/SpinGame$/},()=>({path:'spin',namespace:'fixture'}));
   if(controlled)b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?'export const supabase={auth:{getSession:async()=>globalThis.__arcadeAuthResult}};':a.path==='spin'?'export function SpinGame(){return null;}':'export const {useState,useRef,useEffect,useCallback}=globalThis.__arcadeUIHooks;'}));
  }}]});
  return {module:await import(pathToFileURL(out)),close:()=>rm(dir,{recursive:true,force:true})};
 } catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
async function withUI(game,fn,{stored=[],handler}={}){
 const previous={window:globalThis.window,localStorage:globalThis.localStorage,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout};
 const slots=[],effects=[],intervals=new Map(),timeouts=new Map(),saved=new Map(stored),requests=[];let index=0,dirty=true,tree,timerId=0,failWrites=false;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__arcadeUIHooks={
  useState(initial){const i=index++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},
  useRef(initial){const i=index++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useCallback(fn,deps){const i=index++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=index++,old=slots[i];if(!old||changed(old.deps,deps)){const record={deps,cleanup:old?.cleanup};slots[i]=record;effects.push(()=>{record.cleanup?.();record.cleanup=fn();});}},
 };
 globalThis.__arcadeAuthResult={data:{session:{access_token:'owned-token',user:{id:user}}},error:null};
 globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>{if(failWrites)throw Error('Storage blocked');saved.set(k,String(v));},removeItem:k=>saved.delete(k)};
 globalThis.window={setInterval:(cb,ms)=>{const id=++timerId;intervals.set(id,{cb,ms});return id;},clearInterval:id=>intervals.delete(id),setTimeout:(cb,ms)=>{const id=++timerId;timeouts.set(id,{cb,ms});return id;},clearTimeout:id=>timeouts.delete(id)};
 globalThis.document={hidden:false};
 let current=envelope();
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);let result;if(body.action==='arcade_config')result=current;else result=await handler?.(body,{saved,setEnvelope:v=>current=v,requests});return {ok:true,status:200,json:async()=>clone(result||{})};};
 const bundle=await uiBundle(true);
 globalThis.setTimeout=(cb,ms)=>{const id=++timerId;timeouts.set(id,{cb,ms});return id;};
 function render(){index=0;dirty=false;tree=bundle.module.AccountArcade({userId:user,game,onBack(){},onAccount(){}});while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<12;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&i>=3)break;}if(dirty)render();}
 function button(label){const result=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(result,`Missing button: ${label}\n${text(tree)}`);return result;}
 function check(){const checkbox=nodes(tree).find(n=>n.type==='input'&&n.props.type==='checkbox');assert.ok(checkbox);checkbox.props.onChange({target:{checked:true}});render();}
 const h={get tree(){return tree;},get text(){return text(tree);},get saved(){return saved;},get requests(){return requests;},button,check,render,settle,setEnvelope:v=>current=v,setStorageBlocked:v=>failWrites=v,async click(label){const b=button(label);assert.ok(!b.props.disabled,`${label} disabled`);b.props.onClick();await settle();},async tick(ms){for(const t of [...intervals.values()].filter(t=>t.ms===ms))t.cb();await settle();},async finishAnimation(){for(const [id,t] of [...timeouts])if(t.ms===1400){timeouts.delete(id);t.cb();}await settle();}};
 try{await settle();await fn(h);}finally{
  for(const item of slots)item?.cleanup?.();await bundle.close();delete globalThis.__arcadeUIHooks;delete globalThis.__arcadeAuthResult;delete globalThis.document;
  for(const key of ['window','localStorage','fetch','setTimeout']){if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];}
 }
}

test('account Games menu renders all four games and distinguishes account money from free landing demos',async()=>{
 const b=await uiBundle();try{const html=renderToStaticMarkup(React.createElement(b.module.ArcadeGames,{userId:user,onBack(){}}));for(const title of ['MatMove Spin','RICH DICE','Fruity Flue','CRANKLING'])assert.ok(html.includes(title));assert.match(html,/real SLE/);assert.match(html,/virtual credits/);}finally{await b.close();}
});

test('wallet amount stays masked until the eye control is clicked; approval and available funds gate payment',()=>withUI('dice',async h=>{
 assert.match(h.text,/••••••/);assert.doesNotMatch(h.text,/SLE 1000\.00/);
 await h.click(''); // accessible icon-only balance control is the first empty-text button
 assert.match(h.text,/SLE 1000\.00/);
 h.check();assert.equal(h.button('Pay SLE 5.00 — start 1 attempt').props.disabled,false);
 const d=envelope();d.eligibility={eligible:false,reason:'Verify your identity.'};h.setEnvelope(d);await h.tick(15000);
 assert.equal(h.button('Pay SLE 5.00 — start 1 attempt').props.disabled,true);assert.match(h.text,/Verify your identity/);
}));

test('a saved entry precedes the POST, double clicks charge once, and winnings show credited only after receipt completion',()=>{
 let entryCalls=0,drawCalls=0,statusCalls=0,release,active=round();
 return withUI('dice',async h=>{
  h.check();const pay=h.button('Pay SLE 5.00 — start 1 attempt');pay.props.onClick();pay.props.onClick();await h.settle();
  assert.equal(entryCalls,1);assert.ok(h.saved.get(`matmove-arcade-entry:v1:${user}:dice`));
  release();await h.settle();assert.equal(h.saved.has(`matmove-arcade-entry:v1:${user}:dice`),false);
  await h.click('Roll your dice');await h.finishAnimation();assert.equal(drawCalls,1);assert.match(h.text,/payment processing/);assert.doesNotMatch(h.text,/full prize is confirmed credited/);
  await h.tick(5000);assert.equal(statusCalls,1);assert.match(h.text,/full prize is confirmed credited/);assert.match(h.text,/Confirmed credited to your wallet/);assert.equal(entryCalls,1);
 },{handler:async(body,ctx)=>{
  if(body.action==='arcade_enter'){entryCalls++;assert.ok(ctx.saved.get(`matmove-arcade-entry:v1:${user}:dice`));await new Promise(resolve=>release=resolve);ctx.setEnvelope(envelope([active]));return {round:active};}
  if(body.action==='arcade_draw'){drawCalls++;active={...active,state:'win_pending',attemptsUsed:1,outcomes:[{index:1,values:[5,4],prizeMinor:1080,createdAt:new Date().toISOString(),paymentStatus:'processing'}],receipts:[{index:1,kind:'win',amountMinor:1080,providerId:'trn-win',status:'processing',error:null}]};ctx.setEnvelope(envelope([active]));return {round:active};}
  if(body.action==='arcade_status'){statusCalls++;active={...active,state:'completed',paidMinor:1080,outcomes:active.outcomes.map(o=>({...o,paymentStatus:'completed'})),receipts:active.receipts.map(r=>({...r,status:'completed'}))};ctx.setEnvelope(envelope());return {round:active};}
 }});
});

test('lost entry responses keep the key; recovery checks the original request without another entry POST',()=>{
 let entries=0,cancels=0;const r=round();
 return withUI('dice',async h=>{
  h.check();await h.click('Pay SLE 5.00 — start 1 attempt');assert.equal(entries,1);assert.match(h.text,/Resolve your saved entry first/);
  await h.tick(15000);assert.equal(entries,1);assert.ok(h.button('Roll your dice').props.disabled);
  await h.click('Check entry / cancel if unstarted');assert.equal(cancels,1);assert.equal(entries,1);assert.ok(!h.button('Roll your dice').props.disabled);assert.equal(h.saved.size,0);
 },{handler:async(body,ctx)=>{if(body.action==='arcade_enter'){entries++;ctx.setEnvelope(envelope([r]));throw Error('Lost response');}if(body.action==='arcade_cancel'){cancels++;return {round:r};}}});
});

test('an unstarted request can be atomically canceled before a new payment; blocked storage never sends entry',()=>{
 let entries=0;
 return withUI('dice',async h=>{
  h.check();h.setStorageBlocked(true);await h.click('Pay SLE 5.00 — start 1 attempt');assert.equal(entries,0);assert.match(h.text,/Allow browser storage/);
 },{handler:async()=>{entries++;}});
});

test('restored drafts never auto-submit a payment and cancellation clears only that retained key',()=>{
 const key=`matmove-arcade-entry:v1:${user}:dice`,draft={action:'arcade_enter',game:'dice',requestKey:'66666666-6666-4666-8666-666666666666',configId:2,prediction:{stakeMinor:500,target:7,comparison:'above'},acceptedEntryMinor:500,acceptedPayoutMinor:1080,acceptRules:true};let cancels=0;
 return withUI('dice',async h=>{
  assert.equal(h.requests.filter(b=>b.action==='arcade_enter').length,0);assert.match(h.text,/Resolve your saved entry first/);
  await h.click('Check entry / cancel if unstarted');assert.equal(cancels,1);assert.equal(h.saved.has(key),false);assert.match(h.text,/Unstarted entry canceled/);
  assert.equal(h.button('Pay SLE 5.00 — start 1 attempt').props.disabled,true);
 },{stored:[[key,JSON.stringify(draft)]],handler:async b=>{assert.equal(b.action,'arcade_cancel');assert.equal(b.requestKey,draft.requestKey);cancels++;return {canceled:true};}});
});

test('Fruity Flue retains its reset timer after three attempts, then permits a fresh review without restoring the expired round',()=>{
 const r=round('fruity','completed');r.attemptsUsed=3;r.outcomes=[{index:3,values:[0,1,2,3],prizeMinor:0,paymentStatus:'not_applicable',createdAt:new Date().toISOString()}];
 return withUI('fruity',async h=>{
  h.setEnvelope(envelope([r]));await h.tick(15000);assert.match(h.text,/Next free window/);assert.match(h.text,/three attempts are used|free attempts are finished/);
  assert.equal(nodes(h.tree).some(n=>n.type==='button'&&text(n)==='Start my 3 free attempts'),false);
  const expired={...r,expiresAt:new Date(Date.now()-1000).toISOString(),state:'active'};h.setEnvelope(envelope([expired]));await h.tick(15000);
  await h.click('Start a new free window');await h.tick(15000);assert.ok(h.button('Start my 3 free attempts'));assert.equal(h.requests.filter(b=>b.action==='arcade_enter').length,0);
 });
});

test('changing signed-in identity prevents every game request from reaching the server',async()=>{
 const b=await uiBundle();const old=globalThis.fetch;let called=false;globalThis.fetch=()=>{called=true;throw Error('Should not fetch');};
 globalThis.__arcadeAuthResult={data:{session:{access_token:'other-token',user:{id:'other-user'}}},error:null};
 try{await assert.rejects(()=>b.module.arcadeRequest(user,{action:'arcade_enter'}),/sign-in changed/);assert.equal(called,false);}finally{globalThis.fetch=old;delete globalThis.__arcadeAuthResult;await b.close();}
});

async function withRoute(fn){
 const dir=await mkdtemp(join(process.cwd(),'.arcade-route-')),calls=[];
 globalThis.__arcadeRouteCalls=calls;
 try{
  const out=join(dir,'route.mjs');await build({entryPoints:['api/get-live-wallet.js'],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'route-fixtures',setup(b){
   b.onResolve({filter:/\/server\//},a=>({path:a.path.split('/').pop(),namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='wallet-security.js'?`export const dbClient=()=>({});export const protectedWallet=(mode,handler)=>async(req,res)=>{globalThis.__arcadeRouteCalls.push('authenticated:'+mode);req.body=req.body||{};return handler(req,res);};`:a.path==='live-wallet.js'?`export const liveWallet=async()=>{globalThis.__arcadeRouteCalls.push('wallet');return {wallet:true};};`:a.path==='activity-analytics.js'?`export const activityAnalyticsAction=async(req,res)=>{globalThis.__arcadeRouteCalls.push('analytics');return res.status(200).json({analytics:true});};`:a.path==='spin-payments.js'?`export const spinAction=async(req,res)=>{globalThis.__arcadeRouteCalls.push('spin');return res.status(200).json({spin:true});};export const reconcileSpins=async(req,res)=>{globalThis.__arcadeRouteCalls.push('spin-cron');return res.status(200).json({cron:true});};`:`export const arcadeAction=async(req,res)=>{globalThis.__arcadeRouteCalls.push('arcade');return res.status(200).json({arcade:true});};export const publicArcadeConfig=async()=>{globalThis.__arcadeRouteCalls.push('public-read');return {config:{id:1,settings:{}}};};export const reconcileArcades=async(req,res)=>{globalThis.__arcadeRouteCalls.push('arcade-cron');return res.status(200).json({cron:true});};`}));
  }}]});const {default:handler}=await import(pathToFileURL(out));
  const request=async(req)=>{calls.length=0;const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',query:{},...req},res);return res;};await fn(request,calls);
 }finally{delete globalThis.__arcadeRouteCalls;await rm(dir,{recursive:true,force:true});}
}
test('public demo configuration is GET-only and never enters an authenticated payment handler',()=>withRoute(async(request,calls)=>{
 const r=await request({method:'GET',query:{action:'arcade_public'}});assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.deepEqual(calls,['public-read']);
 assert.equal((await request({method:'POST',query:{action:'arcade_public'},body:{action:'arcade_enter'}})).code,405);assert.deepEqual(calls,[]);
}));
test('all arcade actions authenticate once while existing wheel, analytics and wallet routes stay available',()=>withRoute(async(request,calls)=>{
 for(const action of ['arcade_config','arcade_quote','arcade_enter','arcade_cancel','arcade_status','arcade_draw']){await request({body:{action}});assert.deepEqual(calls,['authenticated:read','arcade']);}
 await request({body:{action:'spin_draw'}});assert.deepEqual(calls,['authenticated:read','spin']);
 await request({body:{action:'activity_analytics'}});assert.deepEqual(calls,['authenticated:read','analytics']);
 await request({body:{}});assert.deepEqual(calls,['authenticated:read','wallet']);
}));
test('duplicate query actions and prototype names cannot dispatch games or payments; cron stays separate',()=>withRoute(async(request,calls)=>{
 for(const action of [['arcade_public','arcade_enter'],'unknown','constructor']){assert.equal((await request({query:{action}})).code,400);assert.deepEqual(calls,[]);}
 assert.equal((await request({body:{action:'constructor'}})).code,400);assert.deepEqual(calls,['authenticated:read']);
 await request({method:'GET',query:{action:'arcade_reconcile'}});assert.deepEqual(calls,['arcade-cron']);
 await request({method:'GET',query:{action:'spin_reconcile'}});assert.deepEqual(calls,['spin-cron']);
}));
test('new games preserve the original twelve API files and App connects the shared Games screen without removing KYC locking',async()=>{
 const entries=(await readdir('api')).filter(n=>/\.(js|ts)$/.test(n));assert.equal(entries.length,12);
 const app=await readFile('src/App.tsx','utf8');assert.match(app,/<ArcadeGames key=\{profile\.id\}/);assert.match(app,/KycWorkspace/);assert.match(app,/KycStatusNotice/);assert.match(app,/resume=1/);
});
