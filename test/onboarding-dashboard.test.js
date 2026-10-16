
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
async function bundled(file,fn){
 const dir=await mkdtemp(join(process.cwd(),'.onboarding-dashboard-test-'));
 try{const out=join(dir,'component.mjs');await build({entryPoints:[file],tsconfig:'tsconfig.app.json',outfile:out,platform:'node',format:'esm',bundle:true,jsx:'automatic',loader:{'.css':'empty'},external:['react','react/*','react-dom/*','lucide-react'],plugins:[{name:'dashboard-mock',setup(b){
 b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/useWalletAccess$/},()=>({path:'access',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='supabase'?'export const supabase={};':'export function useWalletAccess(){return globalThis.__dashboardAccess;}'}));
 }}]});await fn(await import(pathToFileURL(out)));}finally{delete globalThis.__dashboardAccess;await rm(dir,{recursive:true,force:true});}
}
function button(html,label){
 const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(match=>match[2].replace(/<[^>]*>/g,'').trim()===label);
 assert.ok(buttons.length,`Missing ${label} button`);return buttons;
}
const id='11111111-1111-4111-8111-111111111111';
const wallet={monime_account_id:'fac-owned',balance:0,balanceAvailable:true};
for(const role of ['Rider','Driver','Merchant'])test(`${role} dashboard remains accessible with correct pending and approved wallet controls`,()=>bundled(`src/pages/${role}Dashboard.tsx`,async module=>{
 const Component=module[`${role}Dashboard`];
 const render=(approved,frozen=false,account=wallet)=>{globalThis.__dashboardAccess={approved,frozen};return renderToStaticMarkup(React.createElement(Component,{profile:{id,role:role.toLowerCase(),kyc_status:approved?'approved':'not_started'},wallet:account,activeSection:'wallet'}));};
 const pending=render(false);assert.match(pending,/My Wallets/);
 if(role==='Rider'){
  assert.ok(button(pending,'Load').every(b=>!/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
  assert.ok(button(pending,'Withdraw').every(b=>/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
  assert.ok(button(pending,'Transfer').every(b=>/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
  assert.match(pending,/Verify your identity/);
 }else{
  for(const action of ['Load','Withdraw','Transfer'])assert.ok(button(pending,action).every(b=>/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
  assert.match(pending,/Approval pending/);
 }
 const ready=render(true);for(const action of ['Load','Withdraw','Transfer'])assert.ok(button(ready,action).every(b=>!/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
 const frozen=render(true,true);for(const action of ['Load','Withdraw','Transfer'])assert.ok(button(frozen,action).every(b=>/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
 const missing=render(true,false,{});assert.match(missing,/Finish wallet setup/);assert.match(missing,/Retry wallet setup/);assert.ok(button(missing,'Load').every(b=>/(?:^|\s)disabled(?:=|\s|$)/.test(b[1])));
}));

test('live wallet access does not approve riders by role, and approval/freeze changes take effect on refresh',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.onboarding-access-test-'));
 let state;let refresh;let cleanup;
 const profile={id,role:'rider',kyc_status:'not_started',is_wallet_frozen:false};
 globalThis.__accessReact={useState:initial=>{state=initial;return [initial,value=>{state=value;}];},useEffect:fn=>{cleanup=fn();}};
 const channel={on:()=>channel,subscribe:()=>channel};
 globalThis.__accessDb={from:table=>{const chain={select:()=>chain,eq:()=>chain,single:async()=>({data:profile}),then:(resolve,reject)=>Promise.resolve({data:table==='wallets'?[]:[{role:'rider'}]}).then(resolve,reject)};return chain;},channel:()=>channel,removeChannel:()=>{}};
 globalThis.window={setInterval:fn=>{refresh=fn;return 1;},clearInterval:()=>{}};
 try{
  const out=join(dir,'access.mjs');await build({entryPoints:['src/lib/useWalletAccess.ts'],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'hook-mock',setup(b){
   b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'supabase',namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='react'?'export const useState=(...args)=>globalThis.__accessReact.useState(...args);export const useEffect=(...args)=>globalThis.__accessReact.useEffect(...args);':'export const supabase=globalThis.__accessDb;'}));
  }}]});const module=await import(pathToFileURL(out));module.useWalletAccess(id);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));await flush();
  assert.deepEqual(state,{frozen:false,approved:false});
  profile.kyc_status='approved';refresh();await flush();assert.deepEqual(state,{frozen:false,approved:true});
  profile.is_wallet_frozen=true;refresh();await flush();assert.equal(state.frozen,true);
 }finally{cleanup?.();delete globalThis.window;delete globalThis.__accessReact;delete globalThis.__accessDb;await rm(dir,{recursive:true,force:true});}
});
