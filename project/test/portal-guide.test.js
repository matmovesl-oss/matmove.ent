import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111';
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(fn,{role='rider',verified=false,seen=false,blocked=false,serverSeen=false}={}){
 const dir=await mkdtemp(join(process.cwd(),'.portal-guide-')),out=join(dir,'ui.mjs');
 const old=globalThis.localStorage,slots=[],effects=[],storage=new Map(),navigation=[];let i=0,dirty=true,tree,verifications=0,unmounted=false;
 let props={userId:uid,role,verified,replay:0,onNavigate:s=>navigation.push(s),onVerify:()=>verifications++};
 const savedAccounts=new Set(serverSeen?[uid]:[]);globalThis.__guideClaim=async(id,seen)=>{const first=!savedAccounts.has(id);savedAccounts.add(id);return !seen&&first;};
 const key=`matmove-guide:v1:${uid}:${role}`;if(seen)storage.set(key,'completed');
 globalThis.localStorage={getItem(k){if(blocked)throw Error('blocked');return storage.get(k)||null;},setItem(k,v){if(blocked)throw Error('blocked');storage.set(k,v);}};
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((x,j)=>!Object.is(x,b[j]));
 globalThis.__guideHooks={
  useState(initial){const n=i++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return[slots[n].value,v=>{slots[n].value=typeof v==='function'?v(slots[n].value):v;dirty=true;}];},
  useRef(initial){const n=i++;if(!(n in slots))slots[n]={current:initial};return slots[n];},
  useEffect(fn,deps){const n=i++,old=slots[n];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[n]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}
 };
 try{
  await build({entryPoints:['src/components/PortalGuide.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'guide-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/services\/customerGuide$/},()=>({path:'claim',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='claim'?'export const claimCustomerGuide=(...args)=>globalThis.__guideClaim(...args);':'export const {useEffect,useRef,useState}=globalThis.__guideHooks;'}));}}]});
  const {default:Guide,portalGuideSteps}=await import(pathToFileURL(out));
  function render(){i=0;dirty=false;tree=Guide(props);for(const n of nodes(tree))if(n.type==='dialog'&&n.ref&&!n.ref.current)n.ref.current={open:false,showModal(){this.open=true;},close(){this.open=false;}};while(effects.length)effects.shift()();}
  async function settle(){for(let n=0;n<10;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>4&&!dirty)break;}}
  const h={navigation,storage,key,steps:portalGuideSteps,get tree(){return tree;},get text(){return text(tree);},get open(){return tree.ref.current.open;},get verifiedCalls(){return verifications;},async update(next){props={...props,...next};dirty=true;await settle();},async click(label){const b=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert.ok(b,`Missing ${label}: ${text(tree)}`);b.props.onClick();await settle();},settle};
  await settle();await fn(h);
 }finally{unmounted=true;for(const s of slots)s?.cleanup?.();if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;delete globalThis.__guideHooks;delete globalThis.__guideClaim;await rm(dir,{recursive:true,force:true});}
}
for(const role of ['rider','driver','merchant'])test(`${role} tutorial starts once, follows its own sections and only opens KYC after an explicit click`,()=>page(async h=>{
 assert.equal(h.open,true);assert.deepEqual(h.navigation,['home']);
 const steps=h.steps(role,false);assert.equal(steps.at(-1).id,'kyc');
 assert.equal(steps.some(s=>s.section==='inventory'),role==='merchant');assert.equal(steps.some(s=>s.section==='shop'),role==='rider');
 for(let n=1;n<steps.length;n++)await h.click('Next');
 assert.deepEqual(h.navigation,steps.map(s=>s.section).filter((s,i,a)=>i===0||s!==a[i-1]));assert.equal(h.verifiedCalls,0);
 await h.click('Continue my KYC');assert.equal(h.verifiedCalls,1);assert.equal(h.open,false);assert.equal(h.storage.get(h.key),'dismissed');
},{role}));
test('Skip records only a tour preference, never approval or KYC state, and Quick guide can replay it',()=>page(async h=>{
 await h.click('Skip tour · Start using');assert.equal(h.open,false);assert.equal(h.verifiedCalls,0);assert.deepEqual([...h.storage],[[h.key,'dismissed']]);
 await h.update({replay:1});assert.equal(h.open,true);assert.match(h.text,/Welcome to your MatMove Home/);
}));
test('Completed tour stays closed until replay and verified users are never prompted to resubmit KYC',()=>page(async h=>{
 assert.equal(h.open,false);assert.deepEqual(h.navigation,[]);await h.update({replay:1});assert.equal(h.open,true);
 const steps=h.steps('rider',true);assert.ok(!steps.some(s=>s.id==='kyc'));for(let n=1;n<steps.length;n++)await h.click('Next');
 await h.click('Start using');assert.equal(h.open,false);assert.equal(h.verifiedCalls,0);assert.equal(h.storage.get(h.key),'completed');assert.equal(h.navigation.at(-1),'home');
},{verified:true,seen:true}));
test('Blocked browser storage does not trap a user in the guide; Escape can still dismiss it',()=>page(async h=>{
 assert.equal(h.open,true);assert.match(h.text,/Tour preferences are saved to your account/);let prevented=false;
 h.tree.props.onCancel({preventDefault(){prevented=true;}});await h.settle();assert.equal(prevented,true);assert.equal(h.open,false);assert.equal(h.verifiedCalls,0);
},{blocked:true}));
test('Switching customers gives the new customer a separate guide preference and never reuses the old account key',()=>page(async h=>{
 await h.click('Skip tour · Start using');await h.update({userId:'22222222-2222-4222-8222-222222222222'});assert.equal(h.open,true);
 await h.click('Skip tour · Start using');assert.equal(h.storage.size,2);assert.ok([...h.storage.keys()].every(k=>k.startsWith('matmove-guide:v1:')));
}));
test('Account stays accessible at the top while the bottom navigation no longer has an Account tab',async()=>{
 const app=await readFile('src/App.tsx','utf8');const nav=app.slice(app.indexOf('function PortalNavigation'),app.indexOf('function PasscodeScreen'));
 assert.doesNotMatch(nav,/id: 'account'/);for(const section of ['home','ride','wallet','trips'])assert.ok(nav.includes(`id: '${section}'`));
 assert.match(app,/aria-label="Open your account"/);assert.match(app,/key=\{`\$\{profile.id\}:\$\{role\}`\} userId=\{profile.id\}/);assert.match(app,/onVerify=\{/);
 for(const file of ['RiderDashboard','DriverDashboard','MerchantDashboard']){
  const source=await readFile(`src/pages/${file}.tsx`,'utf8');const main=source.slice(source.indexOf("{activeSection === 'home' &&"),source.indexOf("{activeSection === 'wallet' &&"));
  assert.doesNotMatch(main,/\{[Ww]alletCards\}/);assert.match(source,/activeSection === 'wallet'/);
 }
});

test('an account whose guide was seen on another login or device stays closed without local storage, and replay stays explicit',()=>page(async h=>{assert.equal(h.open,false);await h.update({replay:1});assert.equal(h.open,true);},{serverSeen:true}));
test('a guide is consumed on its first display rather than waiting for Skip or completion',()=>page(async h=>{assert.equal(h.open,true);assert.equal(h.storage.get(h.key),'opened');await h.update({role:'driver'});assert.equal(h.open,false);}));
