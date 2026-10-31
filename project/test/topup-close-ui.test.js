
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const user='11111111-1111-4111-8111-111111111111';
const key=`matmove-topup:${user}`;
const code=(extra={})=>({id:'code-old',status:'pending',closed:false,confirmed:false,amount:{currency:'SLE',value:500},ussdCode:'*715*123#',expireTime:new Date(Date.now()+600000).toISOString(),...extra});
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function withUI(fn,{saved=null,handler}={}){
 const dir=await mkdtemp(join(process.cwd(),'.topup-close-ui-')),out=join(dir,'ui.mjs');
 const originals=Object.fromEntries(['window','document','sessionStorage'].map(k=>[k,globalThis[k]]));
 const values=new Map(saved?[[key,JSON.stringify(saved)]]:[]),slots=[],effects=[],timers=new Map(),calls=[],intents=new Map();
 let i=0,dirty=true,tree,timerId=0,closed=0,paid=0,created=0;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 globalThis.__closeHooks={useState(initial){const x=i++;if(!(x in slots))slots[x]={value:typeof initial==='function'?initial():initial};return[slots[x].value,v=>{slots[x].value=typeof v==='function'?v(slots[x].value):v;dirty=true;}];},useRef(initial){const x=i++;if(!(x in slots))slots[x]={current:initial};return slots[x];},useCallback(fn,deps){const x=i++;if(!(x in slots)||changed(slots[x].deps,deps))slots[x]={fn,deps};return slots[x].fn;},useEffect(fn,deps){const x=i++,old=slots[x];if(!old||changed(old.deps,deps)){const r={deps,cleanup:old?.cleanup};slots[x]=r;effects.push(()=>{r.cleanup?.();r.cleanup=fn();});}}};
 globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 globalThis.document={hidden:false};
 globalThis.window={setTimeout:(cb,ms)=>{timers.set(++timerId,{cb,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:(cb,ms)=>{timers.set(++timerId,{cb,ms});return timerId;},clearInterval:id=>timers.delete(id)};
 let current=saved?.code||null;
 globalThis.__closeFetch=async(url,body)=>{
  calls.push({url,body:{...body}});
  let result=await handler?.(body,{current,setCurrent:v=>current=v});
  if(!result){
   if(body.operation==='quote')result={quote:{netMode:false,requestedMinor:Math.round(Number(body.amount)*100),walletCreditMinor:null,feeMinor:null,totalMinor:Math.round(Number(body.amount)*100),version:'legacy-gross'}};
   else if(body.operation==='status')result={paymentCode:current};
   else if(body.operation==='close'){current=code({...current,closed:true,ussdCode:null});result={paymentCode:current};}
   else{
    if(!intents.has(body.topupRequestId))intents.set(body.topupRequestId,code({id:`code-new-${++created}`,amount:{currency:'SLE',value:Math.round(Number(body.amount)*100)}}));
    current=intents.get(body.topupRequestId);result={paymentCode:current};
   }
  }
  return{response:{ok:!result.error},data:result,finish(){}};
 };
 try{
  await build({entryPoints:['src/components/WalletTopUp.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'close-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/apiFetch$/},()=>({path:'fetch',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useRef,useEffect,useCallback}=globalThis.__closeHooks;':'export const walletFetch=(...args)=>globalThis.__closeFetch(...args);'}));}}]});
  const module=await import(pathToFileURL(out));
  function render(){i=0;dirty=false;tree=module.WalletTopUp({userId:user,allowed:true,onClose:()=>closed++,onPaid:()=>paid++});while(effects.length)effects.shift()();}
  async function settle(){for(let n=0;n<12;n++){if(dirty)render();await new Promise(r=>setImmediate(r));if(n>5&&!dirty)break;}if(dirty)render();}
  const button=label=>{const node=nodes(tree).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));assert.ok(node,`Missing ${label}: ${text(tree)}`);return node;};
  const h={calls,values,button,settle,get text(){return text(tree);},get closed(){return closed;},get paid(){return paid;},get amount(){return nodes(tree).find(n=>n.type==='input')?.props.value;},
   async click(label){const n=button(label);assert.ok(!n.props.disabled);n.props.onClick();await settle();},
   async enter(amount){const input=nodes(tree).find(n=>n.type==='input');assert.ok(input);input.props.onChange({target:{value:amount}});await settle();for(const [id,t] of [...timers])if(t.ms===400){timers.delete(id);await t.cb();}await settle();},
   async remount(){for(const s of slots)s?.cleanup?.();slots.length=0;effects.length=0;timers.clear();dirty=true;await settle();}
  };
  await settle();await fn(h);
 }finally{for(const s of slots)s?.cleanup?.();await rm(dir,{recursive:true,force:true});delete globalThis.__closeHooks;delete globalThis.__closeFetch;for(const k in originals){if(originals[k]===undefined)delete globalThis[k];else globalThis[k]=originals[k];}}
}

test('Close retires the old code, reopening starts blank, and a new load uses a fresh logical request',()=>withUI(async h=>{
 await h.enter('5');await h.click('Generate code — SLE 5.00');
 const first=h.calls.find(c=>!c.body.operation).body;await h.click('Close');assert.equal(h.closed,1);assert.equal(h.values.has(key),false);
 await h.remount();assert.equal(h.amount,'');assert.doesNotMatch(h.text,/code-new|\*715/);
 await h.enter('5');await h.click('Generate code — SLE 5.00');
 const creates=h.calls.filter(c=>!c.body.operation);assert.equal(creates.length,2);assert.notEqual(first.topupRequestId,creates[1].body.topupRequestId);
 assert.ok(h.calls.some(c=>c.body.operation==='close'&&c.body.paymentCodeId==='code-new-1'));
}));

test('Restored completed payment is cleared and does not block another load',()=>withUI(async h=>{
 assert.match(h.text,/Payment completed/);assert.equal(h.paid,1);assert.equal(h.values.has(key),false);
 await h.click('Close');await h.remount();assert.equal(h.amount,'');assert.doesNotMatch(h.text,/Payment completed/);
},{saved:{amount:'5',intentId:'old-intent',code:code({status:'completed',closed:true,confirmed:true})}}));

test('A failed Close retains the same code and never enables an unrelated new payment',()=>withUI(async h=>{
 await h.click('Close');assert.equal(h.closed,0);assert.equal(JSON.parse(h.values.get(key)).code.id,'code-old');
 assert.match(h.text,/Retry Close/);assert.equal(h.calls.filter(c=>!c.body.operation).length,0);
},{saved:{amount:'5',intentId:'old-intent',code:code()},handler:async body=>{if(body.operation==='close')throw Error('network unavailable');}}));

test('A processing payment remains tracked and leaving that screen does not claim cancellation',()=>withUI(async h=>{
 await h.click('Close');assert.equal(h.closed,0);assert.match(h.text,/already processing/);assert.ok(h.values.has(key));
 await h.click('Return to dashboard — payment still processing');assert.equal(h.closed,1);assert.ok(h.values.has(key));
},{saved:{amount:'5',intentId:'old-intent',code:code({status:'processing'})},handler:async(body,ctx)=>body.operation==='close'?{paymentCode:code({status:'processing'})}:undefined}));

test('Closing during code creation waits for that response, retires it, and never creates a second request',()=>{
 const waiting=deferred();return withUI(async h=>{
  await h.enter('5');h.button('Generate code — SLE 5.00').props.onClick();await h.settle();await h.click('Close top-up');assert.equal(h.closed,0);
  waiting.resolve({paymentCode:code()});await h.settle();assert.equal(h.closed,1);assert.equal(h.calls.filter(c=>!c.body.operation).length,1);assert.equal(h.values.has(key),false);
 },{handler:body=>!body.operation?waiting.promise:undefined});
});

test('Closing an unconfirmed saved request recovers its original key before retiring the returned code',()=>withUI(async h=>{
 await h.click('Close top-up');assert.equal(h.closed,1);
 const creates=h.calls.filter(c=>!c.body.operation);assert.equal(creates.length,1);assert.equal(creates[0].body.topupRequestId,'retained-key');
 assert.equal(h.calls.filter(c=>c.body.operation==='close').length,1);assert.equal(h.values.has(key),false);
},{saved:{amount:'5',intentId:'retained-key'}}));
