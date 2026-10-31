import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',mid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const item={id:'12',message_id:mid,title:'Welcome',body:'Complete verification from Account.',destination:'kyc',created_at:'2026-10-27T12:00:00Z',read_at:null};
const base=()=>({user_id:uid,items:[{...item}],unread_count:'1',observed_max_id:'12',next_before:null});
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(which,fn,{reply=base(),failure=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.assistance-ui-')),out=join(dir,'ui.mjs'),original={window:globalThis.window,document:globalThis.document};
 const slots=[],effects=[],calls=[],navigation=[],intervals=new Map();let cursor=0,dirty=true,tree,unmounted=false,identity=uid,handler=null,nextTimer=0;
 let props=which==='MatMoveHelp'?{userId:uid,context:{role:'rider'},onNavigate:d=>navigation.push(d)}:{userId:uid,onNavigate:d=>navigation.push(d)};
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,i)=>!Object.is(v,b[i]));
 globalThis.__assistanceHooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useCallback(fn,deps){const i=cursor++;if(!(i in slots)||changed(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[i]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}};
 globalThis.window={setTimeout:()=>++nextTimer,clearTimeout(){},setInterval(fn,ms){const id=++nextTimer;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id)};globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 globalThis.__assistanceDb={auth:{getSession:async()=>({data:{session:{user:{id:identity}}},error:null})},rpc(name,args){calls.push({name,args});const q={abortSignal:()=>q,then:(yes,no)=>Promise.resolve().then(async()=>{
  if(handler)return handler(name,args);
  if(failure)return{data:null,error:{message:failure}};
  if(name==='matmove_notifications')return{data:reply,error:null};
  if(name==='matmove_notification_read'){reply={...reply,items:reply.items.map(i=>({...i,read_at:'2026-10-27T13:00:00Z'})),unread_count:'0'};return{data:{user_id:uid,id:args.p_id,through:args.p_through,changed:1},error:null};}
  throw new Error('Unexpected RPC '+name);
 }).then(yes,no)};return q;}};
 try{
  await build({entryPoints:[`src/components/${which}.tsx`],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'assistance-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useEffect,useRef,useCallback}=globalThis.__assistanceHooks;':'export const supabase=globalThis.__assistanceDb;'}));}}]});
  const module=await import(pathToFileURL(out));function render(){cursor=0;dirty=false;tree=module.default(props);for(const n of nodes(tree))if(n.type==='dialog'&&n.ref&&!n.ref.current)n.ref.current={open:false,showModal(){this.open=true;},close(){this.open=false;}};while(effects.length)effects.shift()();}
  async function settle(){for(let n=0;n<15;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>7&&!dirty)break;}}
  const button=label=>{const n=nodes(tree).find(n=>n.type==='button'&&(text(n).trim()===label||n.props['aria-label']===label));assert.ok(n,`Missing ${label}: ${text(tree)}`);return n;};
  const h={module,calls,navigation,intervals,button,settle,get nodes(){return nodes(tree);},get text(){return text(tree);},get dialog(){return nodes(tree).find(n=>n.type==='dialog');},setHandler:fn=>handler=fn,setUser:id=>identity=id,setReply:value=>reply=value,async update(value){props={...props,...value};dirty=true;await settle();},async click(label){const b=button(label);assert.ok(!b.props.disabled,`${label} disabled`);b.props.onClick();await settle();},async ask(q){nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:q}});await settle();nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await settle();},unmount(){unmounted=true;for(const s of slots)s?.cleanup?.();}};
  await settle();await fn(h);
 }finally{if(!unmounted)for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}delete globalThis.__assistanceHooks;delete globalThis.__assistanceDb;await rm(dir,{recursive:true,force:true});}
}
for(const role of ['rider','driver','merchant'])test(`${role} Help navigates only to role-supported screens without any API call`,()=>page('MatMoveHelp',async h=>{
 await h.update({context:{role}});await h.click('Open MatMove Help');assert.equal(h.dialog.ref.current.open,true);await h.ask('complete identity verification');await h.click('Open Account');assert.deepEqual(h.navigation,['account']);assert.equal(h.calls.length,0);assert.equal(h.dialog.ref.current.open,false);
 assert.equal(h.module.customerHelpSection(role==='driver'?'radar':'ride',role),'ride');assert.equal(h.module.customerHelpSection('games',role),'home');assert.throws(()=>h.module.customerHelpSection('https://external.example',role));
}));
test('Help opens every browse topic including those whose title does not match search keywords',()=>page('MatMoveHelp',async h=>{
 await h.click('Open MatMove Help');await h.click('Protect your account');assert.match(h.text,/Keep your password/);await h.click('Open Account');assert.deepEqual(h.navigation,['account']);
}));
test('unknown and sensitive questions stay local; close and Escape clear retained question and answers',()=>page('MatMoveHelp',async h=>{
 await h.click('Open MatMove Help');await h.ask('the moon is green');assert.match(h.text,/do not have a verified guide/);await h.ask('my pin is 123456');assert.match(h.text,/Keep passwords/);assert.ok(!h.text.includes('123456'));assert.equal(h.calls.length,0);
 h.dialog.props.onCancel({preventDefault(){}});await h.settle();assert.equal(h.dialog.ref.current.open,false);assert.equal(h.nodes.find(n=>n.type==='input').props.value,'');
}));
test('changed customer and revoked Admin assignments clear answers and invalidate retained navigation buttons',()=>page('MatMoveHelp',async h=>{
 await h.update({context:{role:'admin',isActive:true,permissions:['kyc']}});await h.click('Open MatMove Help');await h.ask('kyc');const old=h.button('Open KYC');await h.update({context:{role:'admin',isActive:true,permissions:[]}});old.props.onClick();await h.settle();assert.deepEqual(h.navigation,[]);assert.ok(!h.text.includes('Open KYC'));
 await h.update({userId:other,context:{role:'driver'}});assert.equal(h.dialog.ref.current.open,false);
}));
test('bell reads own inbox and only explicit mark-read writes once; opening links moves no money',()=>page('NotificationBell',async h=>{
 assert.equal(h.calls[0].name,'matmove_notifications');assert.deepEqual(h.calls[0].args,{p_before:null});await h.click('Open notifications, 1 unread');assert.equal(h.dialog.ref.current.open,true);await h.click('Open Account verification');assert.deepEqual(h.navigation,['kyc']);assert.equal(h.calls.some(c=>c.name==='matmove_notification_read'),false);
 await h.click('Open notifications, 1 unread');const b=h.button('Mark read');b.props.onClick();b.props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.name==='matmove_notification_read').length,1);assert.deepEqual(h.calls.find(c=>c.name==='matmove_notification_read').args,{p_id:'12',p_through:false});assert.match(h.text,/0 unread/);assert.ok(h.calls.every(c=>['matmove_notifications','matmove_notification_read'].includes(c.name)));
}));
test('mark all uses the last server-observed ID and a failed write never invents a successful read status',()=>page('NotificationBell',async h=>{
 h.setHandler((name,args)=>name==='matmove_notification_read'?{data:null,error:{message:'Connection lost'}}:{data:base(),error:null});await h.click('Mark all read');assert.deepEqual(h.calls.at(-1).args,{p_id:'12',p_through:true});assert.match(h.text,/Connection lost/);assert.ok(!h.text.includes('No messages yet'));assert.ok(!h.text.includes('0 unread'));
}));
test('failed inbox reads show Retry rather than empty messages or a successful zero badge',()=>page('NotificationBell',async h=>{
 assert.match(h.text,/Network unavailable/);assert.ok(!h.text.includes('No messages yet'));assert.ok(!h.text.includes('0 unread'));h.setHandler(()=>({data:base(),error:null}));await h.click('Retry notifications');assert.match(h.text,/1 unread/);
},{failure:'Network unavailable'}));
test('malformed or cross-user pages and external action destinations are rejected',()=>page('NotificationBell',async h=>{
 for(const value of [{...base(),user_id:other},{...base(),items:[{...item,destination:'https://bad.example'}]},{...base(),items:[item,item]},{...base(),next_before:'12'}])assert.throws(()=>h.module.validateInbox(value,uid));
 h.setReply({...base(),user_id:other});await h.click('Refresh');assert.match(h.text,/could not be verified/);assert.ok(!h.text.includes('Welcome'));
}));
test('changing the authenticated session prevents read status writes and another inbox read',()=>page('NotificationBell',async h=>{
 const count=h.calls.length;h.setUser(other);await h.click('Mark read');assert.equal(h.calls.length,count);assert.match(h.text,/sign-in changed/);assert.ok(!h.text.includes('Welcome'));
}));
test('polls pause while the inbox is open and a delayed read cannot publish after leaving the screen',()=>page('NotificationBell',async h=>{
 await h.click('Open notifications, 1 unread');const count=h.calls.length;const poll=[...h.intervals.values()].find(v=>v.ms===30000);poll.fn();await h.settle();assert.equal(h.calls.length,count);
 await h.click('Close notifications');let resolve;h.setHandler(()=>new Promise(r=>resolve=r));h.button('Refresh').props.onClick();await h.settle();assert.ok(resolve);h.unmount();resolve({data:{...base(),items:[{...item,title:'Late update'}]},error:null});await h.settle();assert.ok(!h.text.includes('Late update'));
}));
test('header integration retains profile, guide, top Account and the original twelve API files',async()=>{
 const app=await readFile('src/App.tsx','utf8');for(const name of ['MatMoveHelp','NotificationBell','AccountIdentity','AccountProfile','PortalGuide'])assert.ok(app.includes(name));assert.match(app,/customerHelpSection\(destination,role\)/);assert.match(app,/key=\{`notifications:\$\{profile.id\}:\$\{role\}`\}/);assert.match(app,/<CustomerPasscode key=\{session.user.id\}/);assert.match(app,/<PortalContent onPrivacyLock=\{lock\}/);
});

// Privacy lock regressions share this existing assistance test file.
{
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const receipt=(overrides={})=>({userId:uid,configured:true,digits:6,ok:false,code:'status',attemptsRemaining:5,retryAfterSeconds:0,...overrides});
const allNodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(allNodes):[n,...allNodes(n.props?.children)];
const nodes=n=>!n||typeof n!=='object'||n.props?.hidden||n.props?.['aria-hidden']===true?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'||n?.props?.hidden||n?.props?.['aria-hidden']===true?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
async function page(fn,{configured=true,digits=6,respond=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.pin-ui-')),out=join(dir,'ui.mjs');let i=0,dirty=true,tree,component;const slots=[],effects=[],calls=[],events={window:new Map(),document:new Map()};let sessionId=uid,logout=0,intervals=0;
 const originals={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};
 const emit=(kind,name,event={})=>{for(const fn of [...(events[kind].get(name)||[])])fn(event);};
 const target=kind=>({addEventListener:(name,fn)=>{if(!events[kind].has(name))events[kind].set(name,new Set());events[kind].get(name).add(fn);},removeEventListener:(name,fn)=>events[kind].get(name)?.delete(fn)});
 globalThis.window={...target('window'),setInterval:()=>{intervals++;return 1;},clearInterval(){}};globalThis.document={...target('document'),visibilityState:'visible'};
 // Any accidental PIN persistence fails the test, rather than being silently accepted.
 globalThis.localStorage=globalThis.sessionStorage={setItem(){throw Error('No PIN storage allowed');},getItem(){return null;},removeItem(){}};
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 globalThis.__pin={hooks:{useState(initial){const n=i++;if(!(n in slots))slots[n]={v:typeof initial==='function'?initial():initial};return[slots[n].v,v=>{slots[n].v=typeof v==='function'?v(slots[n].v):v;dirty=true;}];},useRef(initial){const n=i++;if(!(n in slots))slots[n]={current:initial};return slots[n];},useEffect(fn,deps){const n=i++,old=slots[n];if(!old||changed(old.deps,deps)){const next={deps,cleanup:old?.cleanup};slots[n]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}}},db:{auth:{getSession:async()=>({data:{session:{user:{id:sessionId},access_token:'captured-token'}}})},rpc(name,args){const call={name,args,headers:{}};calls.push(call);return{setHeader(k,v){call.headers[k]=v;return this;},abortSignal(signal){call.signal=signal;return this;},then(resolve,reject){return Promise.resolve().then(()=>respond?respond(call):{data:receipt({configured,digits,ok:args.p_action!=='status',code:args.p_action==='status'?'status':digits===4?'upgrade_required':'verified'})}).then(resolve,reject);}}}}};
 try{
 await build({entryPoints:['src/components/CustomerPasscode.tsx'],outfile:out,tsconfig:'tsconfig.app.json',bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*'],plugins:[{name:'pin',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useRef,useEffect}=globalThis.__pin.hooks;export const useLayoutEffect=useEffect;':'export const supabase=globalThis.__pin.db;'}));}}]});
 const mod=await import(pathToFileURL(out));component=mod.default;
 async function settle(){for(let n=0;n<25;n++){if(dirty){i=0;dirty=false;tree=component({userId:uid,onLogout:()=>{logout++;},children:lock=>({type:'div',props:{children:'PRIVATE DASHBOARD',onLock:lock}})});for(const n of allNodes(tree))if(n.type==='dialog'&&n.ref&&!n.ref.current)n.ref.current={open:false,showModal(){this.open=true;},close(){this.open=false;}};while(effects.length)effects.shift()();}await new Promise(r=>setImmediate(r));}}
 const h={calls,mod,settle,get tree(){return tree;},get retainedNodes(){return allNodes(tree);},get text(){return text(tree);},get logout(){return logout;},get intervals(){return intervals;},session(id){sessionId=id;},input(label,value){const n=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']===label);assert.ok(n,`Missing ${label}: ${text(tree)}`);n.props.onChange({target:{value}});},async submit(){const n=nodes(tree).find(n=>n.type==='form');assert.ok(n);n.props.onSubmit({preventDefault(){}});await settle();},async click(label){const n=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(n);assert.ok(!n.props.disabled);n.props.onClick();await settle();},async event(kind,name,event={}){emit(kind,name,event);await settle();},async hide(){globalThis.document.visibilityState='hidden';emit('document','visibilitychange');await settle();},unmount(){for(const s of slots)s?.cleanup?.();}};
 await settle();await fn(h);
 }finally{for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}delete globalThis.__pin;await rm(dir,{recursive:true,force:true});}
}
test('existing six-digit PIN unlocks only after one server-verified receipt with the captured identity',()=>page(async h=>{
 assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);h.input('Current 6-digit passcode','012345');await h.settle();const form=nodes(h.tree).find(n=>n.type==='form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await h.settle();
 assert.match(h.text,/PRIVATE DASHBOARD/);const writes=h.calls.filter(c=>c.args.p_action==='verify');assert.equal(writes.length,1);assert.equal(writes[0].headers.Authorization,'Bearer captured-token');assert.equal(writes[0].args.p_pin,'012345');assert.equal(h.intervals,0);
}));
test('setup requires matching six digits, preserves leading zeros, and never stores the PIN in browser storage',()=>page(async h=>{
 h.input('New six-digit passcode','012345');h.input('Confirm six-digit passcode','012346');await h.settle();await h.submit();assert.equal(h.calls.length,1);assert.match(h.text,/same six-digit/);
 h.input('Confirm six-digit passcode','012345');await h.settle();await h.submit();assert.equal(h.calls.at(-1).args.p_new_pin,'012345');assert.equal(h.calls.at(-1).args.p_pin,null);assert.match(h.text,/PRIVATE DASHBOARD/);
},{configured:false,respond:call=>({data:receipt(call.args.p_action==='status'?{configured:false}:{configured:true,ok:true,code:'saved'})})}));
test('a verified legacy four-digit PIN cannot unlock until an explicit six-digit upgrade is confirmed',()=>page(async h=>{
 h.input('Current 4-digit passcode','0123');await h.settle();await h.submit();assert.match(h.text,/Upgrade to six digits/);assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);
 h.input('New six-digit passcode','000123');h.input('Confirm six-digit passcode','000123');await h.settle();await h.submit();assert.equal(h.calls.at(-1).args.p_action,'change');assert.equal(h.calls.at(-1).args.p_pin,'0123');assert.match(h.text,/PRIVATE DASHBOARD/);
},{digits:4,respond:call=>({data:receipt(call.args.p_action==='status'?{digits:4}:call.args.p_action==='verify'?{digits:4,ok:true,code:'upgrade_required'}:{digits:6,ok:true,code:'saved'})})}));
test('wrong guesses and cooldown receipts stay locked and cannot claim a local successful PIN match',()=>page(async h=>{
 h.input('Current 6-digit passcode','999999');await h.settle();await h.submit();assert.match(h.text,/Try again in 300 seconds/);assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);
},{respond:call=>({data:receipt(call.args.p_action==='status'?{}:{code:'cooldown',attemptsRemaining:0,retryAfterSeconds:300})})}));
test('hiding or leaving the page clears secrets and locks immediately; visible-page inactivity has no lock timer',()=>page(async h=>{
 h.input('Current 6-digit passcode','012345');await h.settle();await h.submit();assert.match(h.text,/PRIVATE DASHBOARD/);assert.equal(h.intervals,0);await h.hide();assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);
 assert.ok(nodes(h.tree).filter(n=>n.type==='input').every(n=>n.props.value===''));
 assert.ok(h.retainedNodes.some(n=>n.props?.children==='PRIVATE DASHBOARD'),'Verified workspace must remain mounted behind the privacy lock');
 assert.ok(h.retainedNodes.some(n=>n.props?.hidden===true&&n.props?.style?.display==='none'),'Locked workspace must be visually hidden');
 assert.equal(h.calls.filter(c=>c.args.p_action==='verify').length,1);await h.event('window','pageshow',{persisted:true});assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);
}));
test('changed sessions, cross-user receipts and malformed success never unlock',async()=>{
 await page(async h=>{h.input('Current 6-digit passcode','012345');await h.settle();h.session(other);await h.submit();assert.equal(h.calls.length,1);assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);assert.match(h.text,/sign-in changed/);});
 for(const bad of [{userId:other,ok:true,code:'verified'},{ok:true,code:'status'},{ok:true,configured:false,code:'verified'},{ok:true,digits:4,code:'verified'}])await page(async h=>{h.input('Current 6-digit passcode','012345');await h.settle();await h.submit();assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);},{respond:c=>({data:receipt(c.args.p_action==='status'?{}:bad)})});
});
test('failed status reads give Reload and never fabricate a new passcode setup',()=>page(async h=>{
 assert.match(h.text,/not confirmed/);assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);assert.ok(nodes(h.tree).some(n=>n.type==='button'&&text(n)==='Reload passcode setup'));
},{respond:()=>({error:{message:'Database unavailable'}})}));
test('a delayed verification after backgrounding cannot reopen the dashboard',async()=>{
 let release;await page(async h=>{h.input('Current 6-digit passcode','012345');await h.settle();const form=nodes(h.tree).find(n=>n.type==='form');form.props.onSubmit({preventDefault(){}});await h.settle();await h.hide();release({data:receipt({ok:true,code:'verified'})});await h.settle();assert.doesNotMatch(h.text,/PRIVATE DASHBOARD/);
 },{respond:c=>c.args.p_action==='status'?{data:receipt()}:new Promise(r=>{release=r;})});
});
test('existing Portal routes, Account tools and deletion request use the shared gate without plaintext comparisons',async()=>{
 const app=await readFile('src/App.tsx','utf8');assert.match(app,/<CustomerPasscode key=\{session.user.id\}/);assert.match(app,/onLock=\{onPrivacyLock\}/);assert.match(app,/customerPasscode\(profile.id,'verify',deletePin\)/);assert.doesNotMatch(app,/profile\.passcode|IDLE_LOCK_MS|IDLE_LOGOUT_MS|enteredPin ===/);for(const name of ['ProductCatalog','NotificationBell','InviteEarn','PortalGuide','KycWorkspace','ArcadeGames'])assert.ok(app.includes(name));
});

}
