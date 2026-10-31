
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',code='MM123456ABCDEF';
const reward=(state='pending',id='33333333-3333-4333-8333-333333333333')=>({id,kind:'inviter',amountMinor:'100',currency:'SLE',state,createdAt:'2026-10-28T06:00:00Z'});
const empty=()=>({userId:uid,rewards:[],hasMore:false});

function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(fn,{record=empty(),failure=null,delay=false}={}){
 const dir=await mkdtemp(join(process.cwd(),'.invite-ui-')),out=join(dir,'ui.mjs'),old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch},nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');const slots=[],effects=[],calls=[],copies=[],shares=[];let cursor=0,dirty=true,tree,unmounted=false,identity=uid,handler=null,timer=0,authCallback,timeout,resolveFetch;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__inviteHooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback(fn,deps){const i=cursor++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[i]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}};
 globalThis.window={setTimeout:fn=>{timeout=fn;return ++timer;},clearTimeout(){},setInterval:()=>++timer,clearInterval(){},location:{origin:'https://matmove.example'}};globalThis.document={visibilityState:'visible'};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async v=>copies.push(v)},share:async v=>shares.push(v)}});
 globalThis.__inviteDb={auth:{getSession:async()=>({data:{session:{user:{id:identity},access_token:'fixture-token'}},error:null}),onAuthStateChange(fn){authCallback=fn;return{data:{subscription:{unsubscribe(){authCallback=null;}}}};}}};
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(handler)return handler(url,options);
  if(delay)await new Promise(r=>resolveFetch=r);
  return {ok:!failure,json:async()=>record};
 };

 try{
  await build({entryPoints:['src/components/ReferralRewardHistory.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'invite-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useEffect,useRef,useCallback}=globalThis.__inviteHooks;':'export const supabase=globalThis.__inviteDb;'}));}}]});
  const module=await import(pathToFileURL(out));function render(){cursor=0;dirty=false;tree=module.default({userId:uid});while(effects.length)effects.shift()();}async function settle(){for(let n=0;n<18;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>8&&!dirty)break;}}
  const button=label=>{const n=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(n,`Missing ${label}: ${text(tree)}`);return n;};
  const h={module,calls,copies,shares,button,settle, timeout:()=>timeout?.(),resolveFetch:()=>resolveFetch?.(),event:id=>authCallback?.('SIGNED_OUT',id?{user:{id}}:null),get text(){return text(tree);},setUser:id=>identity=id,setRecord:v=>record=v,setHandler:fn=>handler=fn,async click(label){const b=button(label);assert.ok(!b.props.disabled,`${label} disabled`);b.props.onClick();await settle();},unmount(){unmounted=true;for(const s of slots)s?.cleanup?.();}};
  await settle();await fn(h);
 }finally{if(!unmounted)for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;delete globalThis.__inviteHooks;delete globalThis.__inviteDb;await rm(dir,{recursive:true,force:true});}
}

test('Account history sends only an authenticated private status read, never a reward payment',()=>page(async h=>{
 assert.equal(h.calls.length,1);const {url,options}=h.calls[0];assert.equal(url,'/api/get-live-wallet');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer fixture-token');assert.deepEqual(JSON.parse(options.body),{action:'referral_status',userId:uid});assert.match(h.text,/No referral rewards recorded/);
 const source=await readFile('src/components/InviteEarn.tsx','utf8');assert.match(source,/<ReferralRewardHistory key=\{userId\} userId=\{userId\}/);
}));
test('every saved state has an honest label and only completed rewards show Credited',()=>page(async h=>{
 for(const [state,label] of [['pending','Pending eligibility checks'],['processing','Payment processing'],['completed','Credited'],['review_required','Needs review'],['failed','Payment failed']]){
  h.setRecord({userId:uid,rewards:[reward(state)],hasMore:false});await h.click('Refresh reward history');assert.match(h.text,new RegExp(label));assert.equal(h.text.includes('Credited'),state==='completed');assert.match(h.text,/SLE 1/);assert.ok(!h.text.includes('fac-'));assert.ok(!h.text.includes('trn-'));assert.ok(!h.text.includes(reward().id));
 }
}));
test('load failure never becomes an empty success and Refresh can recover',()=>page(async h=>{
 assert.match(h.text,/unavailable/);assert.ok(!h.text.includes('No referral rewards'));h.setHandler(async()=>({ok:true,json:async()=>empty()}));await h.click('Refresh reward history');assert.match(h.text,/No referral rewards/);
},{failure:true}));
test('pending reads show Loading and repeated refresh clicks send one read',()=>page(async h=>{
 assert.match(h.text,/Loading reward history/);assert.ok(!h.text.includes('No referral rewards'));h.button('Refresh reward history').props.onClick();assert.equal(h.calls.length,1);h.resolveFetch();await h.settle();assert.match(h.text,/No referral rewards/);
},{delay:true}));
test('wrong owner, duplicate rows, private extras, forged amount and unknown state fail the whole page',()=>page(async h=>{
 for(const value of [{...empty(),userId:other},{...empty(),rewards:[reward(),reward()]},{...empty(),rewards:[{...reward(),providerId:'trn-private'}]},{...empty(),rewards:[{...reward(),amountMinor:'200'}]},{...empty(),rewards:[reward('paid')]},{...empty(),rewards:[{...reward(),createdAt:'tomorrow'}]},{...empty(),hasMore:true}]){
  h.setRecord(value);await h.click('Refresh reward history');assert.match(h.text,/could not be verified/);assert.ok(!h.text.includes('Friend signup reward'));
 }
}));
test('truncated history shows a precise newest-50 notice and keeps totals separate',()=>page(async h=>{
 const rewards=Array.from({length:50},(_,i)=>reward('pending',`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`));h.setRecord({userId:uid,rewards,hasMore:true});await h.click('Refresh reward history');assert.match(h.text,/50 most recent/);assert.match(h.text,/totals include older/);assert.equal((h.text.match(/Friend signup reward/g)||[]).length,50);
}));
test('a changed identity blocks a new read before fetch and signing out hides retained history immediately',()=>page(async h=>{
 assert.match(h.text,/Friend signup reward/);h.setUser(other);await h.click('Refresh reward history');assert.equal(h.calls.length,1);assert.match(h.text,/Sign-in changed/);h.event(null);await h.settle();assert.ok(!h.text.includes('Friend signup reward'));
},{record:{userId:uid,rewards:[reward('completed')],hasMore:false}}));
test('an Auth identity change rejects a delayed reply even when the old token request succeeds',()=>page(async h=>{
 h.setUser(other);h.event(other);await h.settle();h.resolveFetch();await h.settle();assert.match(h.text,/Sign-in changed/);assert.ok(!h.text.includes('Friend signup reward'));assert.ok(h.calls[0].options.signal.aborted);
},{record:{userId:uid,rewards:[reward('completed')],hasMore:false},delay:true}));
test('timeout releases the read without allowing a late successful response to publish',()=>page(async h=>{
 h.timeout();await h.settle();assert.match(h.text,/timed out/);assert.ok(h.calls[0].options.signal.aborted);h.resolveFetch();await h.settle();assert.ok(!h.text.includes('Friend signup reward'));
},{record:{userId:uid,rewards:[reward('completed')],hasMore:false},delay:true}));
test('leaving Account aborts the read and no late reward is published',()=>page(async h=>{
 h.unmount();h.resolveFetch();await h.settle();assert.ok(h.calls[0].options.signal.aborted);assert.ok(!h.text.includes('Friend signup reward'));
},{record:{userId:uid,rewards:[reward('completed')],hasMore:false},delay:true}));
test('malformed JSON and server errors never display raw sensitive provider messages',()=>page(async h=>{
 h.setHandler(async()=>({ok:false,json:async()=>({error:'secret fac-private trn-private'})}));await h.click('Refresh reward history');assert.ok(!h.text.includes('fac-private'));assert.match(h.text,/unavailable/);
 h.setHandler(async()=>({ok:true,json:async()=>{throw new Error('secret provider exception');}}));await h.click('Refresh reward history');assert.ok(!h.text.includes('secret provider'));assert.match(h.text,/unavailable/);
}));
test('referral guides remain role-scoped and open existing Account or assigned Financials only',async()=>{
 const {searchMatMoveHelp,helpTopics}=await import('../shared/matmove-help.js');
 for(const role of ['rider','driver','merchant']){const r=searchMatMoveHelp('referral promo reward history',{role});assert.equal(r.articles[0].id,'referrals');assert.equal(r.articles[0].action.destination,'account');assert.match(r.articles[0].answer,/SLE 1/);assert.match(r.articles[0].answer,/paused/);assert.ok(!helpTopics({role}).some(a=>a.id==='admin-referrals'));}
 assert.ok(helpTopics({role:'admin',isActive:true,permissions:['financials']}).some(a=>a.id==='admin-referrals'));assert.ok(!helpTopics({role:'admin',isActive:true,permissions:['customers']}).some(a=>a.id==='admin-referrals'));assert.ok(!helpTopics({role:'admin',isActive:false,isOwner:true}).some(a=>a.id==='admin-referrals'));
});

test('post-response identity verification rejects an account switch even without an Auth event',()=>page(async h=>{
 h.setUser(other);h.resolveFetch();await h.settle();assert.match(h.text,/Sign-in changed/);assert.ok(!h.text.includes('Friend signup reward'));
},{record:{userId:uid,rewards:[reward('completed')],hasMore:false},delay:true}));
