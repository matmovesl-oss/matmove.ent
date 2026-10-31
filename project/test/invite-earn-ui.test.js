
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',code='MM123456ABCDEF';
const empty=()=>({user_id:uid,code:null,registered_with_code:false,campaign:{accepting:false,payments_enabled:false,reward_minor:'100',currency:'SLE'},invited_count:'0',pending_minor:'0',credited_minor:'0',review_count:'0'});
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(fn,{record=empty(),failure=null,makeFailure=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.invite-ui-')),out=join(dir,'ui.mjs'),old={window:globalThis.window,document:globalThis.document},nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');const slots=[],effects=[],calls=[],copies=[],shares=[];let cursor=0,dirty=true,tree,unmounted=false,identity=uid,handler=null,timer=0;
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__inviteHooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback(fn,deps){const i=cursor++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[i]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}};
 globalThis.window={setTimeout:()=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){},location:{origin:'https://matmove.example'}};globalThis.document={visibilityState:'visible'};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async v=>copies.push(v)},share:async v=>shares.push(v)}});
 globalThis.__inviteDb={auth:{getSession:async()=>({data:{session:{user:{id:identity}}},error:null})},rpc(name,args){calls.push({name,args});const q={abortSignal:()=>q,then:(yes,no)=>Promise.resolve().then(async()=>{
  if(handler){const v=await handler(name,args);if(v!==undefined)return v;}
  if(name==='matmove_referrals_me')return{data:record,error:failure?{message:failure}:null};
  if(name==='matmove_referral_my_code'){if(makeFailure)return{data:null,error:{message:makeFailure}};record={...record,code};return{data:{user_id:uid,code},error:null};}
  throw Error('Unexpected RPC '+name);
 }).then(yes,no)};return q;}};
 try{
  await build({entryPoints:['src/components/InviteEarn.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'invite-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useEffect,useRef,useCallback}=globalThis.__inviteHooks;':'export const supabase=globalThis.__inviteDb;'}));}}]});
  const module=await import(pathToFileURL(out));function render(){cursor=0;dirty=false;tree=module.default({userId:uid});while(effects.length)effects.shift()();}async function settle(){for(let n=0;n<18;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>8&&!dirty)break;}}
  const button=label=>{const n=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(n,`Missing ${label}: ${text(tree)}`);return n;};
  const h={module,calls,copies,shares,button,settle,get text(){return text(tree);},setUser:id=>identity=id,setRecord:v=>record=v,setHandler:fn=>handler=fn,async click(label){const b=button(label);assert.ok(!b.props.disabled,`${label} disabled`);b.props.onClick();await settle();},unmount(){unmounted=true;for(const s of slots)s?.cleanup?.();}};
  await settle();await fn(h);
 }finally{if(!unmounted)for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;delete globalThis.__inviteHooks;delete globalThis.__inviteDb;await rm(dir,{recursive:true,force:true});}
}
test('opening Account reads private referral status only and clearly labels the paused campaign',()=>page(async h=>{
 assert.deepEqual(h.calls.map(c=>c.name),['matmove_referrals_me']);assert.match(h.text,/registration is currently paused/);assert.match(h.text,/Generate my referral code/);assert.ok(!h.text.includes('fac-'));assert.ok(!h.text.includes('39.60'));
}));
test('explicit code generation is single-submit and shows only the confirmed owned result',()=>page(async h=>{
 const b=h.button('Generate my referral code');b.props.onClick();b.props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.name==='matmove_referral_my_code').length,1);assert.match(h.text,new RegExp(code));assert.equal(h.button('Share invite').props.disabled,true);assert.ok(h.calls.every(c=>['matmove_referrals_me','matmove_referral_my_code'].includes(c.name)));
}));
test('sharing uses the owned code and the local signup URL without registration or payment calls',()=>page(async h=>{
 await h.click('Copy code');assert.deepEqual(h.copies,[code]);await h.click('Share invite');assert.equal(h.shares[0].url,`https://matmove.example/signup?ref=${code}`);assert.ok(h.calls.every(c=>c.name==='matmove_referrals_me'));
},{record:{...empty(),code,campaign:{...empty().campaign,accepting:true}}}));
test('failed status fetch shows Reload without claiming empty referrals or successful zero earnings',()=>page(async h=>{
 assert.match(h.text,/Connection failed/);assert.ok(!h.text.includes('Credited rewards'));assert.ok(!h.text.includes('SLE 0'));h.setHandler(()=>({data:empty(),error:null}));await h.click('Reload referrals');assert.match(h.text,/Credited rewards/);
},{failure:'Connection failed'}));
test('lost generation response does not invent a code; Reload recovers the saved code without another create',()=>page(async h=>{
 h.setHandler(name=>name==='matmove_referral_my_code'?{data:null,error:{message:'Response lost'}}:undefined);await h.click('Generate my referral code');assert.match(h.text,/Response lost/);assert.ok(!h.text.includes(code));h.setRecord({...empty(),code});await h.click('Reload referrals');assert.match(h.text,new RegExp(code));assert.equal(h.calls.filter(c=>c.name==='matmove_referral_my_code').length,1);
}));
test('changed sessions prevent code generation or sharing; malformed summaries are rejected',()=>page(async h=>{
 h.setUser(other);await h.click('Generate my referral code');assert.equal(h.calls.filter(c=>c.name==='matmove_referral_my_code').length,0);assert.match(h.text,/sign-in changed/);
 for(const patch of [{user_id:other},{code:'not-valid'},{pending_minor:'NaN'},{campaign:{...empty().campaign,currency:'USD'}}])assert.throws(()=>h.module.validateReferralSummary({...empty(),...patch},uid));
}));
test('amounts preserve comma formatting and cents, and account integration keeps all earlier tools',()=>page(async h=>{
 assert.equal(h.module.referralMoney('100000'),'SLE 1,000');assert.equal(h.module.referralMoney('100050'),'SLE 1,000.50');assert.equal(h.module.referralMoney('1'),'SLE 0.01');assert.throws(()=>h.module.referralMoney('-1'));
 const app=await readFile('src/App.tsx','utf8');for(const name of ['InviteEarn','AccountProfile','AccountPolicy','MatMoveHelp','NotificationBell','PortalGuide'])assert.ok(app.includes(name));assert.match(app,/<InviteEarn key=\{`referrals:\$\{profile.id\}`\} userId=\{profile.id\}/);
}));
test('delayed reads cannot update the Account panel after it is closed',()=>page(async h=>{
 let resolve;h.setHandler(()=>new Promise(r=>resolve=r));h.button('Refresh referrals').props.onClick();await h.settle();assert.ok(resolve);h.unmount();resolve({data:{...empty(),code},error:null});await h.settle();assert.ok(!h.text.includes(code));
}));
