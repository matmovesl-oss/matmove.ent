import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';
const uid='11111111-1111-4111-8111-111111111111';
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
async function page(role,fn,{profileError=null,missing=false,section=null,storedOwner=uid}={}) {
 const source=await readFile('src/App.tsx','utf8'),dir=await mkdtemp(join(process.cwd(),'.portal-entry-')),out=join(dir,'entry.mjs');
 const parsed=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),stubs=new Map();
 for(const node of parsed.statements){if(!ts.isImportDeclaration(node))continue;const key=node.moduleSpecifier.text;if(!/^@\/(components|pages)\//.test(key))continue;const c=node.importClause;let code='';if(c?.name)code+=`export default function ${c.name.text}(){return null;}\n`;for(const n of c?.namedBindings?.elements||[]){const name=n.propertyName?.text||n.name.text;code+=`export function ${name}(){return null;}\n`;}stubs.set(key,code);}
 let tree,i=0,dirty=true,profileResolve,walletResolve,profileReads=0;const slots=[],effects=[],navigation=[],calls=[];const old={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage};
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 const profilePromise=new Promise(r=>profileResolve=r),walletPromise=new Promise(r=>walletResolve=r);
 const profile={id:uid,email:'customer@example.test',role,kyc_status:'approved',full_name:'Test Customer'};
 const hooks={useState(initial){const n=i++;if(!(n in slots))slots[n]={v:typeof initial==='function'?initial():initial};return[slots[n].v,v=>{slots[n].v=typeof v==='function'?v(slots[n].v):v;dirty=true;}];},useRef(initial){const n=i++;if(!(n in slots))slots[n]={current:initial};return slots[n];},useCallback(fn,deps){const n=i++;if(!slots[n]||changed(slots[n].deps,deps))slots[n]={fn,deps};return slots[n].fn;},useEffect(fn,deps){const n=i++,previous=slots[n];if(!previous||changed(previous.deps,deps)){const slot={deps,cleanup:previous?.cleanup};slots[n]=slot;effects.push(()=>{slot.cleanup?.();slot.cleanup=fn();});}}};
 const db={auth:{getSession:async()=>({data:{session:{user:{id:uid,email:profile.email}}}})},from(table){calls.push(table);const q={select(){return q;},eq(){return q;},maybeSingle(){profileReads++;return profileReads===1?profilePromise:Promise.resolve({data:profile,error:null});},single:async()=>({data:profile,error:null}),then(resolve,reject){return (table==='wallets'?walletPromise:Promise.resolve({data:[{role}],error:null})).then(resolve,reject);}};return q;},channel(){const c={on(){return c;},subscribe(){return c;}};return c;},removeChannel(){}};
 const remembered=new Map(section?[[`matmove:portal-section:v1:${storedOwner}`,section]]:[]);globalThis.sessionStorage={getItem:k=>remembered.get(k)||null,setItem:(k,v)=>remembered.set(k,v)};
 globalThis.window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};globalThis.document={visibilityState:'visible'};
 globalThis.__portalEntry={hooks,db,navigate:(...args)=>navigation.push(args),location:{pathname:`/customer/${role}`},auth:{session:{user:{id:uid},roles:[role]}}};
 try {
  await build({stdin:{contents:source.replace('function PortalContent(', 'export function PortalContent('),resolveDir:process.cwd()+'/src',sourcefile:'App.tsx',loader:'tsx'},outfile:out,tsconfig:'tsconfig.app.json',bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*','lucide-react'],plugins:[{name:'entry-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^react-router-dom$/},()=>({path:'router',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onResolve({filter:/^@\/context\/AuthContext$/},()=>({path:'auth',namespace:'mock'}));b.onResolve({filter:/^@\/(components|pages)\//},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:stubs.get(a.path)||{hooks:'export const {useState,useEffect,useCallback,useRef}=globalThis.__portalEntry.hooks;',router:'export const useNavigate=()=>globalThis.__portalEntry.navigate;export const useLocation=()=>globalThis.__portalEntry.location;export const Navigate=()=>null;export const Route=()=>null;export const Routes=()=>null;',db:'export const supabase=globalThis.__portalEntry.db;',auth:'export const useAuth=()=>globalThis.__portalEntry.auth;'}[a.path]}));}}]});
  const module=await import(pathToFileURL(out));
  async function settle(){for(let n=0;n<20;n++){if(dirty){i=0;dirty=false;tree=module.PortalContent({onPrivacyLock(){}});while(effects.length)effects.shift()();}await new Promise(r=>setImmediate(r));}}
  const h={settle,calls,navigation,get tree(){return tree;},get text(){return text(tree);},get home(){return nodes(tree).find(n=>n.type?.name==='PortalHome');},async profile(){profileResolve({data:missing?null:profile,error:profileError});await settle();},async wallet(){walletResolve({data:[{id:'wallet',currency:'SLE'}],error:null});await settle();}};
  await settle();await fn(h);
 }finally{for(const s of slots)s?.cleanup?.();for(const[k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}delete globalThis.__portalEntry;await rm(dir,{recursive:true,force:true});}
}
for(const role of ['rider','driver','merchant'])test(`${role} portal waits for profile and wallet after unlock, then opens owned Home without a null-profile crash`,()=>page(role,async h=>{
 assert.match(h.text,/Loading your portal/);assert.equal(h.home,undefined);assert.ok(!h.calls.includes('wallets'));
 await h.profile();assert.match(h.text,/Loading your portal/);assert.equal(h.home,undefined);
 await h.wallet();assert.ok(h.home,'Home should mount after both reads');assert.equal(h.home.props.profile.id,uid);assert.equal(h.home.props.profile.role,role);assert.equal(h.navigation.length,0);
}));
test('profile read failure shows Retry and does not construct private Home, guide or account header',()=>page('rider',async h=>{await h.profile();assert.match(h.text,/Profile read failed/);assert.match(h.text,/Retry/);assert.equal(h.home,undefined);assert.ok(!h.calls.includes('wallets'));},{profileError:{message:'Profile read failed'}}));
test('missing customer profile routes to account setup without reading profile.id or inventing Home',()=>page('rider',async h=>{await h.profile();assert.equal(h.home,undefined);assert.equal(h.navigation[0][0],'/select-role');assert.match(h.text,/Loading your portal/);},{missing:true}));

for(const role of ['rider','driver','merchant'])test(`${role} returns to its own saved Ride screen after a page reload without creating another request`,()=>page(role,async h=>{await h.profile();await h.wallet();assert.equal(h.home,undefined);const dashboard=nodes(h.tree).find(n=>n.type?.name===`${role[0].toUpperCase()+role.slice(1)}Dashboard`);assert.ok(dashboard);assert.equal(dashboard.props.activeSection,'home');assert.ok(h.calls.every(t=>['profiles','user_roles','wallets'].includes(t)));},{section:'ride'}));
test('a saved section from a different account is never restored',()=>page('rider',async h=>{await h.profile();await h.wallet();assert.ok(h.home);},{section:'ride',storedOwner:'22222222-2222-4222-8222-222222222222'}));
test('a merchant-only saved section cannot become a rider screen',()=>page('rider',async h=>{await h.profile();await h.wallet();assert.ok(h.home);},{section:'inventory'}));
