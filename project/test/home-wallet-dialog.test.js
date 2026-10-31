
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111';
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function page(name,fn,{role='rider',saved=null,preferencesError=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.home-dialog-')),out=join(dir,'ui.mjs');
 const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
 const slots=[],effects=[],calls=[],timers=new Map(),store=new Map();let cursor=0,dirty=true,tree,closed=0,modalOpens=0,unmounted=false,timer=0;
 if(saved)store.set(`matmove-payout:${uid}`,JSON.stringify(saved));
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((x,i)=>!Object.is(x,b[i]));
 globalThis.__hwHooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useCallback(fn,deps){const i=cursor++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[i]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}
 };
 globalThis.window={setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:i=>timers.delete(i),setInterval:()=>++timer,clearInterval(){}};
 globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.__hwDb={auth:{getSession:async()=>({data:{session:{user:{id:uid}}},error:null})},rpc:async(name,args)=>{calls.push({kind:'rpc',name,args});return{data:{user_id:uid,places:[],cardReferences:[]},error:preferencesError};},from(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(yes,no)=>Promise.resolve({data:[],error:null}).then(yes,no)};return q;}};
 globalThis.__hwPayout=async body=>{calls.push({kind:'payout',body});throw Error('Unexpected payout');};
 try{
  await build({entryPoints:[`src/components/${name}.tsx`],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'home-wallet-mocks',setup(b){
   b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));
   b.onResolve({filter:/^@\/lib\/(supabase|apiFetch)$/},a=>({path:a.path.endsWith('supabase')?'db':'wallet',namespace:'mock'}));
   b.onResolve({filter:/^@\/services\/payoutService$/},()=>({path:'payout',namespace:'mock'}));
   b.onResolve({filter:/^@\/components\/ArcadeGames$/},()=>({path:'arcade',namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:{hooks:'export const {useState,useRef,useEffect,useCallback}=globalThis.__hwHooks;',db:'export const supabase=globalThis.__hwDb;',wallet:`export const walletFetch=async()=>({response:{ok:true},data:{sleWallet:{user_id:'${uid}',balanceAvailable:true,balance:2}},finish(){}});`,payout:'export const payoutRequest=(body)=>globalThis.__hwPayout(body);',arcade:'export function ArcadeGames(){return null;}'}[a.path]}));
  }}]});
  const {default:Component}=await import(pathToFileURL(out));
  function render(){cursor=0;dirty=false;tree=name==='PortalHome'?Component({profile:{id:uid,role,first_name:'Test'},onNavigate:s=>calls.push({kind:'navigate',section:s})}):Component({userId:uid,allowed:true,onClose:()=>closed++,onBalanceChange:()=>calls.push({kind:'balance'})});
   for(const n of nodes(tree))if(n.ref&&typeof n.ref==='object'&&!n.ref.current)n.ref.current=n.type==='dialog'?{open:false,showModal(){this.open=true;modalOpens++;}}:{};
   while(effects.length)effects.shift()();
  }
  async function settle(){for(let i=0;i<12;i++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(i>5&&!dirty)break;}if(dirty&&!unmounted)render();}
  const h={calls,store,settle,get text(){return text(tree);},get tree(){return tree;},get closed(){return closed;},get opens(){return modalOpens;},get nodes(){return nodes(tree);},setPayout:fn=>globalThis.__hwPayout=async body=>{calls.push({kind:'payout',body});return await fn(body);},async click(label){const button=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(button,`Missing ${label}: ${text(tree)}`);assert.ok(!button.props.disabled);button.props.onClick();await settle();}};
  await settle();await fn(h);
 }finally{unmounted=true;for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}for(const k of ['__hwHooks','__hwDb','__hwPayout'])delete globalThis[k];await rm(dir,{recursive:true,force:true});}
}
for(const role of ['rider','driver','merchant'])test(`${role} Home shows all four games and opens exactly the selected existing game without payment`,()=>page('PortalHome',async h=>{
 for(const label of ['Spin Wheel','RICH DICE','Fruity Flue','CRANKLING'])assert.ok(h.text.includes(label));
 const button=h.nodes.find(n=>n.type==='button'&&text(n).includes('RICH DICE'));button.props.onClick();await h.settle();
 assert.equal(h.tree.props.initialGame,'dice');assert.equal(h.tree.props.userId,uid);assert.equal(h.calls.filter(c=>c.kind==='payout').length,0);
 h.tree.props.onBack();await h.settle();assert.match(h.text,/Play MatMove Games/);
},{role}));
test('Home shows the actionable preferences error without claiming the user has no saved places',()=>page('PortalHome',async h=>{
 assert.match(h.text,/ACCESS: Customer account setup required/);assert.doesNotMatch(h.text,/Add your home address/);
},{preferencesError:{message:'ACCESS: Customer account setup required'}}));
test('Payout opens a native modal once and Escape closes a fresh unpaid form without a money request',()=>page('PayoutPanel',async h=>{
 assert.equal(h.tree.type,'dialog');assert.equal(h.opens,1);assert.equal(h.tree.props['aria-labelledby'],'mm-payout-title');
 let prevented=false;h.tree.props.onCancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.closed,1);assert.equal(h.calls.filter(c=>c.kind==='payout').length,0);
}));
const pending={request:{action:'submit',amount:'10',currency:'SLE',destinationPhone:'+23276000000',networkProvider:'orange',idempotencyKey:'original-key',acceptedTotalMinor:1016},withdrawal:{id:'withdrawal-original',state:'processing',amountMinor:1000,monimeFeeMinor:10,platformFeeMinor:6,totalMinor:1016,receipts:[]}};
test('Closing a pending payout keeps its original recovery key and never clears the request',()=>page('PayoutPanel',async h=>{
 assert.match(h.text,/does not cancel or repeat/);const before=h.store.get(`matmove-payout:${uid}`);
 await h.click('Close');assert.equal(h.closed,1);assert.equal(h.store.get(`matmove-payout:${uid}`),before);
},{saved:pending}));
test('Escape cannot dismiss an in-flight status check; it resumes the same withdrawal without another entry debit',()=>page('PayoutPanel',async h=>{
 const wait=deferred();h.setPayout(()=>wait.promise);await h.click('Check status');
 h.tree.props.onCancel({preventDefault(){}});assert.equal(h.closed,0);
 assert.deepEqual(h.calls.filter(c=>c.kind==='payout').map(c=>c.body),[{action:'status',withdrawalId:'withdrawal-original'}]);
 wait.resolve({withdrawal:pending.withdrawal});await h.settle();h.tree.props.onCancel({preventDefault(){}});assert.equal(h.closed,1);
},{saved:pending}));
