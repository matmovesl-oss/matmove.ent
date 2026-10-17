
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {StaticRouter} from 'react-router-dom';
import {FRUITS,secureDraw,fruityOutcome,cranklingOutcome,diceQuote,diceOutcome,fruityWindow,takeFruityAttempt,FRUITY_PERIOD_MS} from '../shared/arcade-rules.js';
const draw=values=>{let i=0;return maximum=>{const v=values[i++];assert.ok(v>=0&&v<maximum);return v;};};
test('all 50 fruit identities are distinct and only four identical fruit identities win',()=>{
 assert.equal(FRUITS.length,50);assert.equal(new Set(FRUITS.map(f=>f.name)).size,50);
 assert.equal(fruityOutcome(draw([49,49,49,49])).prizeMinor,5000);
 assert.equal(fruityOutcome(draw([0,0,0,1])).prizeMinor,0);
 // Matching artwork is not enough: the named fruit must be identical.
 const a=FRUITS.findIndex(f=>f.name==='Orange'),b=FRUITS.findIndex(f=>f.name==='Tangerine');
 assert.equal(FRUITS[a].icon,FRUITS[b].icon);assert.equal(fruityOutcome(draw([a,a,a,b])).prizeMinor,0);
});
test('CRANKLING requires the chosen number on all three reels, including boundaries 1 and 10',()=>{
 assert.equal(cranklingOutcome(5,draw([4,4,4])).prizeMinor,5000);
 assert.equal(cranklingOutcome(5,draw([6,6,6])).prizeMinor,0);
 assert.equal(cranklingOutcome(5,draw([4,4,3])).prizeMinor,0);
 assert.equal(cranklingOutcome(1,draw([0,0,0])).prizeMinor,5000);
 assert.equal(cranklingOutcome(10,draw([9,9,9])).prizeMinor,5000);
 for(const n of [0,11,1.5,NaN])assert.throws(()=>cranklingOutcome(n));
});
test('two dice retain their 36 equally likely combinations and payout includes the stake',()=>{
 const above=diceQuote(1000,7,'above'),equal=diceQuote(1000,7,'equal');
 assert.equal(above.wins,15);assert.equal(above.multiplierHundredths,216);assert.equal(above.payoutMinor,2160);
 assert.equal(equal.wins,6);assert.equal(equal.multiplierHundredths,540);assert.equal(equal.payoutMinor,5400);
 for(const mode of ['above','equal','below'])for(let target=2;target<=12;target++){
  let q;try{q=diceQuote(1000,target,mode);}catch{assert.ok(mode==='above'&&target===12||mode==='below'&&target===2);continue;}
  let winners=0,totalPrizes=0;
  for(let a=0;a<6;a++)for(let b=0;b<6;b++){
   const result=diceOutcome(1000,target,mode,draw([a,b]));
   if(result.prizeMinor){winners++;totalPrizes+=result.prizeMinor;}
  }
  assert.equal(winners,q.wins);assert.ok(totalPrizes/(36*1000)<=0.9+1e-12);
 }
 assert.throws(()=>diceQuote(0,7,'above'));assert.throws(()=>diceQuote(2001,7,'above'));
});
test('Fruity Flue has three attempts in one window beginning on the first play and resetting at 24 hours',()=>{
 const first=1_000_000;
 const a=takeFruityAttempt(null,first),b=takeFruityAttempt(a,first+1000),c=takeFruityAttempt(b,first+5000);
 assert.equal(c.startedAt,first);assert.equal(c.used,3);
 assert.throws(()=>takeFruityAttempt(c,first+FRUITY_PERIOD_MS-1),/three demo attempts/);
 const fresh=takeFruityAttempt(c,first+FRUITY_PERIOD_MS);
 assert.deepEqual(fresh,{startedAt:first+FRUITY_PERIOD_MS,used:1});
 assert.deepEqual(fruityWindow({startedAt:Infinity,used:0},first),{startedAt:0,used:0});
});
test('browser randomness rejects out-of-range results rather than introducing modulo bias',()=>{
 let calls=0;
 assert.equal(secureDraw(50,v=>{v[0]=calls++===0?0xffffffff:49;}),49);
 assert.equal(calls,2);
 assert.throws(()=>secureDraw(0));assert.throws(()=>secureDraw(1.5));
 assert.throws(()=>fruityOutcome(()=>50));
});
test('all four landing demos precede the transport hero and import no account, provider or payment code',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.arcade-test-'));
 try{
  const out=join(dir,'landing.mjs');
  const bundled=await build({entryPoints:['src/pages/LandingPage.tsx'],outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',tsconfig:'tsconfig.app.json',metafile:true,external:['react','react/*','react-dom','react-dom/*','react-router-dom','lucide-react']});
  for(const path of Object.keys(bundled.metafile.inputs))assert.doesNotMatch(path,/server\/|api\/|supabase|apiFetch|wallet-security|spin-payments/);
  const module=await import(pathToFileURL(out));
  const html=renderToStaticMarkup(React.createElement(StaticRouter,{location:"/"},React.createElement(module.LandingPage)));
  for(const name of ['MatMove Spin','RICH DICE','Fruity Flue','CRANKLING'])assert.ok(html.includes(name));
  assert.equal((html.match(/Play free demo/g)||[]).length,4);
  assert.equal((html.match(/>DEMO</g)||[]).length,4);
  assert.ok(html.indexOf('demo-games-title')<html.indexOf('Moving '));
  const source=await readFile('src/components/GameDemos.tsx','utf8');
  assert.match(source,/\/api\/get-live-wallet\?action=arcade_public/);assert.match(source,/method:'GET',credentials:'omit'/);assert.doesNotMatch(source,/walletFetch|supabase|Authorization|method:\s*['"]POST['"]/);
  assert.match(source,/No wallet is connected/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('demo controls complete four games, lock lucky numbers, preserve fruit timer, and award only one wheel bonus',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.arcade-controls-'));
 const previous={window:globalThis.window,crypto:Object.getOwnPropertyDescriptor(globalThis,'crypto'),setTimeout:globalThis.setTimeout};
 const slots=[];let position=0;const scheduled=[];const saved=new Map();
 const hooks={
  useState(initial){const i=position++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=position++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(){position++;},
 };
 globalThis.__arcadeHooks=hooks;
 globalThis.window={localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)}};
 Object.defineProperty(globalThis,'crypto',{value:{getRandomValues:values=>{values.fill(4);return values;}},configurable:true});
 globalThis.setTimeout=(fn)=>{scheduled.push(fn);return 1;};
 try{
  const out=join(dir,'controls.mjs');
  await build({entryPoints:['src/components/GameDemos.tsx'],outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',external:['react/jsx-runtime','react-router-dom','lucide-react'],plugins:[{name:'controlled-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.__arcadeHooks;'}));}}]});
  const {default:Component}=await import(pathToFileURL(out));
  let tree;
  function render(){position=0;tree=Component();return tree;}
  function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n));return [node,...nodes(node.props?.children)];}
  function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
  function button(label){const b=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(b,`Missing button: ${label}`);return b;}
  function choose(name){const b=nodes(tree).find(n=>n.type==='button'&&text(n).includes(name)&&text(n).includes('Play free demo'));assert.ok(b);b.props.onClick();render();}
  function click(label){const b=button(label);assert.ok(!b.props.disabled);b.props.onClick();render();}
  function finish(){assert.equal(scheduled.length,1);scheduled.shift()();render();}
  render();choose('RICH DICE');click('Roll RICH DICE demo');assert.ok(button('Rolling…').props.disabled);finish();assert.match(text(tree),/Demo win!/);assert.match(text(tree),/10.8 virtual credits/);
  choose('CRANKLING');for(let i=0;i<3;i++){click('Play CRANKLING demo');finish();assert.match(text(tree),/Your lucky number matched!/);}
  click('Start a new three-attempt demo set');assert.match(text(tree),/3 of 3 attempts left/);
  choose('Fruity Flue');let started;
  for(let i=0;i<3;i++){click('Play Fruity Flue demo');finish();const state=JSON.parse(saved.get('matmove-demo-fruity-v1'));if(i===0)started=state.startedAt;else assert.equal(state.startedAt,started);assert.match(text(tree),/Four fruits matched!/);}
  assert.ok(button('Three attempts used — waiting for reset').props.disabled);
  choose('MatMove Spin');click('Spin demo wheel');finish();click('Use free bonus spin');finish();assert.ok(button('Spin demo wheel'));assert.match(text(tree),/Demo win!/);
 }finally{
  globalThis.setTimeout=previous.setTimeout;if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;
  if(previous.crypto)Object.defineProperty(globalThis,'crypto',previous.crypto);else delete globalThis.crypto;
  delete globalThis.__arcadeHooks;await rm(dir,{recursive:true,force:true});
 }
});

import {defaultArcadeSettings} from '../shared/arcade-payment-rules.js';
import {defaultBundleTiers} from '../shared/bundle-spin-rules.js';
async function publishedDemo(run){
 const before={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,crypto:Object.getOwnPropertyDescriptor(globalThis,'crypto')};
 const slots=[],effects=[],timers=new Map(),stored=new Map(),requests=[];let position=0,dirty=true,tree,number=0,fail=false;
 const settings=defaultArcadeSettings();settings.dice.returnBps=8000;settings.dice.maxStakeMinor=3000;settings.fruity.prizeMinor=7500;settings.crankling.entryMinor=3000;settings.crankling.prizeMinor=9000;
 const tiers=defaultBundleTiers();tiers[0].sectors[0].prizeMinor=1400;
 let published={config:{id:8,settings},spin:{id:12,tiers},moneyEnabled:false};
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__publishedHooks={useState(initial){const i=position++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},useRef(v){const i=position++;if(!(i in slots))slots[i]={current:v};return slots[i];},useEffect(fn,deps){const i=position++,old=slots[i];if(!old||changed(old.deps,deps)){const r={deps,cleanup:old?.cleanup};slots[i]=r;effects.push(()=>{r.cleanup?.();r.cleanup=fn();});}}};
 const interval=(cb,ms)=>{const id=++number;timers.set(id,{cb,ms,repeat:true});return id;};const timeout=(cb,ms)=>{const id=++number;timers.set(id,{cb,ms,repeat:false});return id;};const clear=id=>timers.delete(id);
 globalThis.window={localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,String(v))},addEventListener(){},removeEventListener(){},setInterval:interval,clearInterval:clear,setTimeout:timeout,clearTimeout:clear};globalThis.document={hidden:false};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});assert.equal(url,'/api/get-live-wallet?action=arcade_public');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);assert.equal(options.headers,undefined);if(fail)throw Error('Offline');return {ok:true,json:async()=>JSON.parse(JSON.stringify(published))};};
 Object.defineProperty(globalThis,'crypto',{value:{getRandomValues:v=>{v.fill(4);return v;}},configurable:true});
 const dir=await mkdtemp(join(process.cwd(),'.published-demo-'));
 try{
  const out=join(dir,'demo.mjs');await build({entryPoints:['src/components/GameDemos.tsx'],outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/jsx-runtime','react-router-dom','lucide-react'],plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const {useState,useRef,useEffect}=globalThis.__publishedHooks;'}));}}]});const {default:Component}=await import(pathToFileURL(out));
  globalThis.setTimeout=timeout;globalThis.setInterval=interval;globalThis.clearInterval=clear;
  const n=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(n):[node,...n(node.props?.children)];
  const t=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(t).join(''):t(node.props?.children);
  function render(){position=0;dirty=false;tree=Component();while(effects.length)effects.shift()();}
  async function settle(){for(let i=0;i<12;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&i>=3)break;}if(dirty)render();}
  const h={get text(){return t(tree);},requests,stored,setPublished:v=>published=v,get published(){return published;},setOffline:v=>fail=v,async select(name){const b=n(tree).find(e=>e.type==='button'&&t(e).includes(name)&&t(e).includes('Play free demo'));assert.ok(b);b.props.onClick();await settle();},async click(label){const b=n(tree).find(e=>e.type==='button'&&t(e)===label);assert.ok(b,`Missing ${label}: ${t(tree)}`);assert.ok(!b.props.disabled);b.props.onClick();await settle();},async finish(){const list=[...timers].filter(([,v])=>v.ms===1100);assert.equal(list.length,1);for(const [id,v] of list){timers.delete(id);v.cb();}await settle();},async refresh(){for(const v of [...timers.values()].filter(v=>v.ms===15000))v.cb();await settle();}};
  await settle();await run(h);
 }finally{
  for(const s of slots)s?.cleanup?.();await rm(dir,{recursive:true,force:true});delete globalThis.__publishedHooks;
  for(const k of ['window','document','fetch','setTimeout','setInterval','clearInterval']){if(before[k]===undefined)delete globalThis[k];else globalThis[k]=before[k];}if(before.crypto)Object.defineProperty(globalThis,'crypto',before.crypto);else delete globalThis.crypto;
 }
}

test('landing demos fetch public settings only, use published dice prizes, and remain free when account games are paused',()=>publishedDemo(async h=>{
 assert.match(h.text,/Published game settings v8/);assert.equal(h.requests.length,1);
 await h.select('RICH DICE');assert.match(h.text,/Demo stake \(1–30 credits\)/);await h.click('Roll RICH DICE demo');await h.finish();assert.match(h.text,/9.6 virtual credits/);
 h.setOffline(true);await h.refresh();assert.match(h.text,/previously loaded settings remain in use/);await h.click('Roll RICH DICE demo');await h.finish();assert.match(h.text,/9.6 virtual credits/);
 assert.ok(h.requests.every(r=>r.options.method==='GET'));
}));
test('published changes preserve a started wheel bonus, CRANKLING set and Fruity Flue window prizes',()=>publishedDemo(async h=>{
 await h.select('MatMove Spin');await h.click('Spin demo wheel');await h.finish();assert.match(h.text,/One free bonus spin/);
 let next=JSON.parse(JSON.stringify(h.published));next.config.id=9;next.spin.id=13;next.spin.tiers[0].sectors[0].prizeMinor=2200;h.setPublished(next);await h.refresh();
 await h.click('Use free bonus spin');await h.finish();assert.match(h.text,/14 virtual credits/);
 await h.select('CRANKLING');await h.click('Play CRANKLING demo');await h.finish();assert.match(h.text,/90 virtual credits/);
 next=JSON.parse(JSON.stringify(h.published));next.config.id=10;next.config.settings.crankling.prizeMinor=11000;h.setPublished(next);await h.refresh();
 await h.click('Play CRANKLING demo');await h.finish();assert.match(h.text,/90 virtual credits/);
 await h.select('Fruity Flue');await h.click('Play Fruity Flue demo');await h.finish();assert.match(h.text,/75 virtual credits/);
 next=JSON.parse(JSON.stringify(h.published));next.config.id=11;next.config.settings.fruity.prizeMinor=8500;h.setPublished(next);await h.refresh();
 await h.click('Play Fruity Flue demo');await h.finish();assert.match(h.text,/75 virtual credits/);assert.equal(JSON.parse(h.stored.get('matmove-demo-fruity-v1')).prizeMinor,7500);
}));
