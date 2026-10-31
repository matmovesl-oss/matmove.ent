
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {defaultArcadeSettings} from '../shared/arcade-payment-rules.js';
const staff={id:'11111111-1111-4111-8111-111111111111',is_active:true,is_owner:false,permissions:['games.settings']};
const gameId='22222222-2222-4222-8222-222222222222';
const clone=x=>JSON.parse(JSON.stringify(x));
function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return [n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return '';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function bundle(controlled=false){const dir=await mkdtemp(join(process.cwd(),'.arcade-admin-ui-'));try{
 const out=join(dir,'page.mjs');await build({entryPoints:['src/pages/GamesPage.tsx'],outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',tsconfig:'tsconfig.app.json',external:controlled?['react/jsx-runtime','lucide-react']:['react','react/*','lucide-react'],plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'fixture'}));
  b.onResolve({filter:/^@\/lib\/adminAccess$/},()=>({path:'access',namespace:'fixture'}));
  b.onResolve({filter:/^@\/lib\/adminFetch$/},()=>({path:'fetch',namespace:'fixture'}));
  b.onResolve({filter:/^@\/components\/AdminLayout$/},()=>({path:'layout',namespace:'fixture'}));
  b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'fixture'}));
  if(controlled)b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='db'?'export const supabase={rpc:(...args)=>globalThis.__adminGameRpc(...args)};':a.path==='access'?`export const useAdminAccess=()=>globalThis.__adminGameAccess;export const canAccess=(a,k)=>!!a&&a.is_active===true&&(a.is_owner===true||a.permissions.includes(k)||a.permissions.includes('games'));`:a.path==='fetch'?'export const adminFetch=()=>{throw Error("Unexpected wallet request");};':a.path==='layout'?'export default function Layout({children}){return children;}':a.path==='router'?`import {jsx} from 'react/jsx-runtime';export const useSearchParams=()=>[new URLSearchParams(globalThis.__adminGameQuery||'')];export const Link=({to,children,...props})=>jsx('a',{...props,href:to,children});`:'export const {useState,useRef,useEffect,useCallback}=globalThis.__adminGameHooks;'}));
 }}]});return {module:await import(pathToFileURL(out)),close:()=>rm(dir,{recursive:true,force:true})};
}catch(e){await rm(dir,{recursive:true,force:true});throw e;}}
async function withControls(component,props,handler,fn){
 const saved={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,document:globalThis.document};
 const slots=[],effects=[],timers=new Map(),calls=[];let index=0,dirty=true,tree,id=0;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__adminGameAccess=staff;globalThis.__adminGameQuery='tab=settings&game=dice';
 globalThis.__adminGameHooks={useState(initial){const i=index++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},useRef(v){const i=index++;if(!(i in slots))slots[i]={current:v};return slots[i];},useCallback(fn,deps){const i=index++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=index++,old=slots[i];if(!old||changed(old.deps,deps)){const record={deps,cleanup:old?.cleanup};slots[i]=record;effects.push(()=>{record.cleanup?.();record.cleanup=fn();});}}};
 globalThis.__adminGameRpc=async(name,args)=>{calls.push({name,args:clone(args)});return handler(name,args);};
 globalThis.document={hidden:false};globalThis.setInterval=(cb,ms)=>{const n=++id;timers.set(n,{cb,ms});return n;};globalThis.clearInterval=n=>timers.delete(n);
 const b=await bundle(true);
 function render(){index=0;dirty=false;tree=b.module[component](props);while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<12;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty&&i>=3)break;}if(dirty)render();}
 const h={get tree(){return tree;},get text(){return text(tree);},calls,render,settle,button(label){const n=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(n,`Missing ${label}: ${text(tree)}`);return n;},input(label){const n=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']===label);assert.ok(n,`Missing input ${label}`);return n;},async change(label,value){h.input(label).props.onChange({target:{value:String(value)}});await settle();},async click(label){const n=h.button(label);assert.ok(!n.props.disabled);n.props.onClick();await settle();},async refresh(){for(const t of timers.values())t.cb();await settle();}};
 try{await settle();await fn(h);}finally{for(const s of slots)s?.cleanup?.();await b.close();for(const k of ['__adminGameHooks','__adminGameRpc','__adminGameAccess','__adminGameQuery'])delete globalThis[k];for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
}

test('unassigned or inactive staff see Access denied before any settings or report request',async()=>{
 const b=await bundle();let reads=0;globalThis.__adminGameRpc=()=>{reads++;throw Error('Must not read');};
 try{for(const access of [{...staff,permissions:['games.entries']},{...staff,is_owner:true,is_active:false}]){globalThis.__adminGameAccess=access;globalThis.__adminGameQuery='tab=settings&game=dice';const html=renderToStaticMarkup(React.createElement(b.module.GamesPage));assert.match(html,/Access denied/);assert.equal(reads,0);}}finally{await b.close();delete globalThis.__adminGameRpc;delete globalThis.__adminGameAccess;delete globalThis.__adminGameQuery;}
});
test('game tabs keep the selected game and customer while hiding unassigned sections',async()=>{
 const b=await bundle();globalThis.__adminGameAccess={...staff,permissions:['games.entries','games.winnings']};globalThis.__adminGameQuery=`tab=entries&game=fruity&player=${gameId}`;
 try{const html=renderToStaticMarkup(React.createElement(b.module.GamesPage));assert.match(html,/tab=winnings&amp;game=fruity&amp;player=/);assert.doesNotMatch(html,/>Settings &amp; access</);assert.match(html,/Fruity Flue/);assert.match(html,/CRANKLING/);}finally{await b.close();delete globalThis.__adminGameAccess;delete globalThis.__adminGameQuery;}
});
test('publishing uses the loaded version, keeps unedited games and prevents duplicate save clicks',()=>{
 let config={id:7,settings:defaultArcadeSettings()},writes=0,release;
 return withControls('ArcadeSettingsPanel',{game:'dice'},async(name,args)=>{
  if(name==='matmove_arcade_admin_report'){assert.equal(args.p_view,'settings');return {data:{config:clone(config)},error:null};}
  assert.equal(name,'matmove_arcade_admin_save');writes++;assert.equal(args.p_expected,7);assert.equal(args.p_settings.dice.maxStakeMinor,2500);assert.deepEqual(args.p_settings.fruity,defaultArcadeSettings().fruity);assert.deepEqual(args.p_settings.crankling,defaultArcadeSettings().crankling);
  await new Promise(resolve=>release=resolve);config={id:8,settings:clone(args.p_settings)};return {data:config,error:null};
 },async h=>{
  assert.ok(h.button('Publish future-game settings').props.disabled);await h.change('dice Maximum stake','25');const save=h.button('Publish future-game settings');assert.ok(!save.props.disabled);save.props.onClick();save.props.onClick();await h.settle();assert.equal(writes,1);release();await h.settle();assert.match(h.text,/Published/);assert.match(h.text,/Current published version: 8/);assert.ok(h.button('Publish future-game settings').props.disabled);
 });
});
test('invalid payout settings never publish and a stale-version error retains the local edit',()=>{
 let writes=0;const config={id:7,settings:defaultArcadeSettings()};
 return withControls('ArcadeSettingsPanel',{game:'dice'},async(name)=>name==='matmove_arcade_admin_report'?{data:{config},error:null}:(writes++,{data:null,error:{message:'CONFLICT: Settings changed. Refresh before publishing.'}}),async h=>{
  await h.change('dice Target average payout',110);assert.ok(h.button('Publish future-game settings').props.disabled);assert.equal(writes,0);
  await h.change('dice Target average payout',80);await h.click('Publish future-game settings');assert.equal(writes,1);assert.match(h.text,/Settings changed/);assert.equal(h.input('dice Target average payout').props.value,80);
 });
});
test('new game reports pass exact server game, view, page and customer filters without guessing credited amounts',()=>{
 const calls=[];return withControls('ArcadeReports',{game:'fruity',tab:'winnings',player:gameId},async(name,args)=>{
  calls.push(args);assert.equal(name,'matmove_arcade_admin_report');return {data:{view:'winnings',game:'fruity',page:args.p_page,pageSize:25,total:26,asOf:new Date().toISOString(),rows:[{id:'receipt-1',game:'fruity',user_id:gameId,customer_name:'Customer',customer_email:'person@example.com',amount_minor:5000,status:'processing',provider_id:'trn-prize',attempt_index:1,round_id:gameId,created_at:new Date().toISOString(),source_account:'fac-spin',destination_account:'fac-user'}]},error:null};
 },async h=>{assert.deepEqual(calls[0],{p_view:'winnings',p_game:'fruity',p_page:1,p_player:gameId});assert.match(h.text,/SLE 50\.00/);assert.match(h.text,/Payment is not confirmed completed/);assert.doesNotMatch(h.text,/Provider payment confirmed/);await h.click('Next arcade page');assert.equal(calls.at(-1).p_page,2);});
});
test('Fruity recovery selects a prize attempt, validates IDs, and attaches once without sending money',()=>{
 let attaches=0;return withControls('ArcadeRecovery',{game:'fruity'},async(name,args)=>{assert.equal(name,'matmove_arcade_admin_receipt');assert.deepEqual(args,{p_id:gameId,p_index:1,p_provider:'trn-original'});attaches++;return {data:null,error:null};},async h=>{
  assert.ok(h.button('Attach existing arcade receipt').props.disabled);
  const labels=nodes(h.tree).filter(n=>n.type==='input');labels[0].props.onChange({target:{value:gameId}});labels[1].props.onChange({target:{value:'trn-original'}});await h.settle();
  const button=h.button('Attach existing arcade receipt');button.props.onClick();button.props.onClick();await h.settle();assert.equal(attaches,1);assert.match(h.text,/No new transfer was sent/);assert.equal(h.calls.length,1);
 });
});
