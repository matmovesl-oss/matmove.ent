
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',booking='55555555-5555-4555-8555-555555555555',offerId='66666666-6666-4666-8666-666666666666',driver='22222222-2222-4222-8222-222222222222';
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
const clone=x=>JSON.parse(JSON.stringify(x));
function snapshot(role='rider') {return{bookingId:booking,viewerId:uid,fareMinor:2000,fareVersion:1,bookingStatus:'pending',paymentStarted:false,selectedDriverId:null,serverTime:new Date().toISOString(),offers:role==='driver'?[]:[{id:offerId,driverId:driver,driverName:'Driver One',amountMinor:2500,fareVersion:1,agreedVersion:null,status:'pending',expiresAt:new Date(Date.now()+300000).toISOString(),createdAt:new Date().toISOString()}]};}
async function bundled(controlled=true,entry='src/components/FareNegotiation.tsx'){
 const dir=await mkdtemp(join(process.cwd(),'.fare-ui-test-'));const out=join(dir,'ui.mjs');
 try{await build({entryPoints:[entry],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react/*','lucide-react'],plugins:[{name:'fare-mocks',setup(b){
 b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase=globalThis.__fareDb;'}));
 if(controlled){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:'export const {useState,useRef,useEffect,useCallback}=globalThis.__fareHooks;'}));}
 }}]});return{module:await import(pathToFileURL(out)),close:()=>rm(dir,{recursive:true,force:true})};}catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
async function withUI(role,fn,{handler}={}){
 const original={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 const slots=[],effects=[],intervals=[],calls=[],changes=[];let i=0,dirty=true,tree,accepted=0,current=snapshot(role),sessionUid=uid;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 globalThis.__fareHooks={useState(initial){const x=i++;if(!(x in slots))slots[x]={value:typeof initial==='function'?initial():initial};return[slots[x].value,v=>{slots[x].value=typeof v==='function'?v(slots[x].value):v;dirty=true;}];},useRef(initial){const x=i++;if(!(x in slots))slots[x]={current:initial};return slots[x];},useCallback(fn,deps){const x=i++;if(!(x in slots)||changed(slots[x].deps,deps))slots[x]={fn,deps};return slots[x].fn;},useEffect(fn,deps){const x=i++,old=slots[x];if(!old||changed(old.deps,deps)){const r={deps,cleanup:old?.cleanup};slots[x]=r;effects.push(()=>{r.cleanup?.();r.cleanup=fn();});}}};
 globalThis.window={setInterval:(cb,ms)=>{intervals.push({cb,ms});return intervals.length;},clearInterval(){}};
 globalThis.document={visibilityState:'visible'};let moneyCalls=0;
 globalThis.fetch=async()=>{moneyCalls++;throw Error('No payments should be sent by negotiations');};
 globalThis.__fareDb={auth:{getSession:async()=>({data:{session:{user:{id:sessionUid}}}})},rpc:async(name,args)=>{
  calls.push({name,args:clone(args)});
  if(name==='matmove_read_ride_fares')return{data:clone(current),error:null};
  const result=await handler?.(name,args,{get current(){return current;},setCurrent:x=>current=x});
  return result||{data:{id:offerId},error:null};
 }};
 const b=await bundled();
 function render(){i=0;dirty=false;tree=b.module.default({userId:uid,bookingId:booking,role,onFareChange:x=>changes.push(x),onAccepted:()=>accepted++});while(effects.length)effects.shift()();}
 async function settle(){for(let x=0;x<15;x++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(x>5&&!dirty)break;}if(dirty)render();}
 function button(label){const n=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(n,`Missing button ${label}\n${text(tree)}`);return n;}
 const h={get text(){return text(tree);},get tree(){return tree;},calls,changes,get accepted(){return accepted;},get moneyCalls(){return moneyCalls;},button,settle,setUser:x=>sessionUid=x,setSnapshot:x=>current=x,
 async click(label){const n=button(label);assert.ok(!n.props.disabled);n.props.onClick();await settle();},
 async amount(value){const input=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']==='Proposed total fare');assert.ok(input);input.props.onChange({target:{value}});await settle();},
 async submitTwice(){const form=nodes(tree).find(n=>n.type==='form');assert.ok(form);form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await settle();},
 async tick(){for(const t of intervals)if(t.ms===5000)t.cb();await settle();}
 };
 try{await settle();await fn(h);}finally{for(const s of slots)s?.cleanup?.();await b.close();delete globalThis.__fareDb;delete globalThis.__fareHooks;for(const k of ['window','document','fetch']){if(original[k]===undefined)delete globalThis[k];else globalThis[k]=original[k];}}
}

test('Customer reviews before confirming, double clicks authorize one decision, and agreement never sends a payment',()=>{
 let release;
 return withUI('rider',async h=>{
  assert.match(h.text,/SLE 20.00/);await h.click('Review SLE 25.00');assert.equal(h.calls.filter(c=>c.name==='matmove_decide_ride_fare').length,0);
  const confirm=h.button('Confirm SLE 25.00');confirm.props.onClick();confirm.props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.name==='matmove_decide_ride_fare').length,1);
  release();await h.settle();assert.equal(h.accepted,1);assert.equal(h.moneyCalls,0);assert.match(h.text,/Fare agreed/);assert.match(h.text,/SLE 25.00/);
  const decision=h.calls.find(c=>c.name==='matmove_decide_ride_fare');assert.equal(decision.args.p_user_id,uid);assert.equal(decision.args.p_offer_id,offerId);assert.equal(decision.args.p_fare_version,1);assert.equal(decision.args.p_amount_minor,undefined);
 },{handler:async(name,args,ctx)=>{if(name==='matmove_decide_ride_fare'){await new Promise(resolve=>release=resolve);ctx.setCurrent({...ctx.current,fareMinor:2500,fareVersion:2,selectedDriverId:driver,offers:ctx.current.offers.map(o=>({...o,status:'accepted',agreedVersion:2}))});return{data:{id:offerId,status:'accepted'},error:null};}}});
});

test('Lost proposal responses retain the same logical key, while repeated submits send one request at a time',()=>{
 let attempts=0,release;
 return withUI('driver',async h=>{
  await h.amount('25.00');await h.submitTwice();assert.equal(attempts,1);release();await h.settle();assert.match(h.text,/Response lost/);
  await h.amount('25.00');await h.submitTwice();assert.equal(attempts,2);
  const writes=h.calls.filter(c=>c.name==='matmove_propose_ride_fare');assert.equal(writes[0].args.p_request_id,writes[1].args.p_request_id);assert.equal(writes[0].args.p_amount_minor,2500);assert.equal(h.moneyCalls,0);
 },{handler:async(name)=>{if(name==='matmove_propose_ride_fare'){attempts++;if(attempts===1){await new Promise(resolve=>release=resolve);throw Error('Response lost. Refresh before retrying.');}}}});
});

test('Expired offers and payment-started requests cannot be confirmed; a switched identity cannot propose',()=>withUI('rider',async h=>{
 const expired=snapshot();expired.offers[0].expiresAt=new Date(Date.now()-1000).toISOString();h.setSnapshot(expired);await h.tick();assert.doesNotMatch(h.text,/Review SLE/);assert.match(h.text,/Expired/);
 h.setSnapshot({...snapshot(),paymentStarted:true});await h.tick();assert.match(h.text,/changes are closed/);assert.doesNotMatch(h.text,/Review SLE/);
}));

test('Session ownership is rechecked before sending an offer',()=>withUI('driver',async h=>{
 await h.amount('25.00');h.setUser('different-user');await h.submitTwice();assert.equal(h.calls.filter(c=>c.name==='matmove_propose_ride_fare').length,0);assert.match(h.text,/account changed/);
}));

test('Fare parsing uses exact cents and rejects invalid, excessive, negative, or fractional-cent amounts',async()=>{
 globalThis.__fareDb={};const b=await bundled(false,'src/services/fareNegotiationService.ts');
 try{assert.equal(b.module.fareMinor('0.29'),29);assert.equal(b.module.fareMinor('20'),2000);assert.equal(b.module.fareMinor('1000000.00'),100000000);for(const value of ['-1','0','0.001','1e2','1000000.01','not money'])assert.throws(()=>b.module.fareMinor(value));}
 finally{await b.close();delete globalThis.__fareDb;}
});
