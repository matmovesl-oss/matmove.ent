
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const user = '11111111-1111-4111-8111-111111111111';
const driver = '22222222-2222-4222-8222-222222222222';
const id = '55555555-5555-4555-8555-555555555555';
const booking = (extra = {}) => ({ id, rider_id: user, driver_id: null, status: 'pending', service_type: 'ride', fare_amount: '20.00', matmove_fare_version: 1, ...extra });
const snapshot = (viewerId, extra = {}) => ({ bookingId: id, viewerId, fareMinor: 2000, fareVersion: 1, bookingStatus: 'pending', paymentStarted: false, selectedDriverId: null, offers: [], serverTime: new Date().toISOString(), ...extra });
function nodes(n) { if (!n || typeof n !== 'object') return []; if (Array.isArray(n)) return n.flatMap(nodes); return [n, ...nodes(n.props?.children)]; }
function text(n) { if (n == null || typeof n === 'boolean') return ''; if (typeof n !== 'object') return String(n); if (Array.isArray(n)) return n.map(text).join(''); return text(n.props?.children); }
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

async function bundled(role) {
  const dir = await mkdtemp(join(process.cwd(), '.dashboard-fares-'));
  const out = join(dir, 'ui.mjs');
  const file = `src/pages/${role}Dashboard.tsx`;
  try {
    await build({ stdin: { contents: await readFile(file, 'utf8') + `\nexport {${role}Main${role==='Rider'?',RiderShop':''}};`, resolveDir: join(process.cwd(), 'src/pages'), loader: 'tsx' }, tsconfig: 'tsconfig.app.json', outfile: out, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, external: ['react/*', 'lucide-react'], plugins: [{ name: 'controlled-dashboard', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'mocks' }));
      b.onResolve({ filter: /^@\/lib\/(supabase|apiFetch|useWalletAccess)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'mocks' }));
      b.onResolve({ filter: /^@\/services\/(rideService|fareNegotiationService)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'mocks' }));
      b.onResolve({ filter: /^@\/components\// }, a => ['@/components/ProductCatalog','@/components/ActiveTripMap'].includes(a.path)?null:({ path: a.path.split('/').at(-1), namespace: 'leaf' }));
      b.onLoad({ filter: /.*/, namespace: 'leaf' }, () => ({ contents: 'export default function Leaf(){return null;} export function RideLocationPicker(){return null;} export function WalletTopUp(){return null;} export function TransactionModal(){return null;} export const loadGoogleMaps=async()=>{};' }));
      b.onLoad({ filter: /.*/, namespace: 'mocks' }, a => ({ contents: ({
        hooks: 'export const {useState,useRef,useEffect,useCallback}=globalThis.__dashHooks;',
        supabase: 'export const supabase=globalThis.__dashDb;',
        apiFetch: 'export const walletFetch=async()=>({response:{ok:true},data:{sleWallet:{monime_account_id:"fac-owned",balance:100,balanceAvailable:true},transactions:[]},finish(){}});',
        useWalletAccess: 'export const useWalletAccess=()=>({frozen:false,approved:true});',
        rideService: 'export const updateRide=(...args)=>globalThis.__dashPay(...args); export const readRidePayment=async()=>({payment:{holdConfirmed:true,driverAccountId:"fac-driver",fare:20,driverEarnings:17,platformFee:3}});',
        fareNegotiationService: 'export const readRideFares=(...args)=>globalThis.__dashFare(...args);'
      })[a.path] }));
    } }] });
    return { module: await import(pathToFileURL(out)), close: () => rm(dir, { recursive: true, force: true }) };
  } catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
}

async function withDashboard(role, fn, options = {}) {
  const globals = ['window', 'document', 'localStorage', 'alert'];
  const original = Object.fromEntries(globals.map(k => [k, globalThis[k]]));
  const slots = [], effects = [], timers = [], payments = [], fareReads = [], queries = [], filters = [], inserts = [], alerts = [];
  let i = 0, dirty = true, tree, queryHandler = options.query || (() => ({ data: role === 'Driver' ? [booking()] : booking(), error: null }));
  let fareHandler = options.fare || (() => snapshot(driver));
  let payHandler = options.pay || (() => ({ pending: false, booking: booking({ status: 'accepted', driver_id: driver }) }));
  let signedIn = role === 'Driver' ? driver : user;
  const changed = (a, b) => !a || a.length !== b?.length || a.some((v, j) => !Object.is(v, b[j]));
  globalThis.__dashHooks = {
    useState(initial) { const n = i++; if (!(n in slots)) slots[n] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[n].value, value => { slots[n].value = typeof value === 'function' ? value(slots[n].value) : value; dirty = true; }]; },
    useRef(initial) { const n = i++; if (!(n in slots)) slots[n] = { current: initial }; return slots[n]; },
    useCallback(fn, deps) { const n = i++; if (!(n in slots) || changed(slots[n].deps, deps)) slots[n] = { fn, deps }; return slots[n].fn; },
    useEffect(fn, deps) { const n = i++, old = slots[n]; if (!old || changed(old.deps, deps)) { const record = { deps, cleanup: old?.cleanup }; slots[n] = record; effects.push(() => { record.cleanup?.(); record.cleanup = fn(); }); } }
  };
  globalThis.window = { setInterval(cb, ms) { timers.push({ cb, ms }); return timers.length; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible' };
  const availability=new Map(options.online?[[`matmove:driver-online:v1:${driver}`,'online']]:[]);
  globalThis.localStorage = { getItem:key=>key.startsWith('matmove:booking-create:')?availability.get(key)||null:availability.get(key)||'true', setItem:(key,value)=>availability.set(key,value),removeItem:key=>availability.delete(key) };
  globalThis.alert=message=>alerts.push(message);
  const channel = { on: () => channel, subscribe: () => channel };
  globalThis.__dashDb = { auth: { getSession: async () => ({ data: { session: { user: { id: signedIn },access_token:'test-token' } }, error: null }) }, channel: () => channel, removeChannel() {}, rpc(name,args){if(name!=='matmove_create_customer_trip')throw Error('Unexpected RPC '+name);const d=args.p_details,row=booking({id:args.p_request,rider_id:signedIn,service_type:d.service_type,vehicle_type:d.vehicle_type,pickup_location:d.pickup_location,destination_location:d.destination_location,fare_amount:Number(d.fare_amount),scheduled_time:d.scheduled_time,status:role==='Merchant'||d.service_type==='scheduled'?'pending_admin':'pending',passenger_count:d.passenger_count,passenger_name:d.passenger_name,matmove_pickup_lat:d.pickup_pin.lat,matmove_pickup_lng:d.pickup_pin.lng,matmove_destination_lat:d.destination_pin.lat,matmove_destination_lng:d.destination_pin.lng});inserts.push(row);const result={data:row,error:null};const q={setHeader(){return q;},abortSignal(){return q;},then(yes,no){return Promise.resolve(result).then(yes,no);}};return q;}, from(table) {
    let inserting=null;
    const execute = () => { if(inserting)return Promise.resolve({data:booking(inserting),error:null}); if(table==='products')return Promise.resolve({data:options.shopProducts||[],error:null});if (table !== 'bookings') return Promise.resolve({ data: [], error: null }); queries.push(table); return Promise.resolve(queryHandler()).then(result=>({...result,data:result.data===null?[]:Array.isArray(result.data)?result.data:[result.data]})); };
    const chain = { insert: value=>{inserting=value;inserts.push(value);return chain;}, select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain, or: value => {filters.push(value);return chain;}, neq: () => chain, maybeSingle: execute, single: execute, then: (yes, no) => execute().then(yes, no) };
    return chain;
  } };
  globalThis.__dashFare = async (...args) => { fareReads.push(args); return fareHandler(...args); };
  globalThis.__dashPay = async (...args) => { payments.push(args); return payHandler(...args); };
  const built = await bundled(role);
  function render() { i = 0; dirty = false; tree = built.module[options.shop?'RiderShop':`${role}Main`]({ profile: { id: role === 'Driver' ? driver : user, role: role.toLowerCase() }, wallet: { monime_account_id: 'fac-owned', balance: 100, balanceAvailable: true }, activeSection: 'home' }); for(const n of nodes(tree))if(n.type==='dialog'&&n.ref&&!n.ref.current)n.ref.current={open:false,showModal(){this.open=true;},close(){this.open=false;}};while (effects.length) effects.shift()(); }
  async function settle() { for (let n = 0; n < 12; n++) { if (dirty) render(); await new Promise(r => setImmediate(r)); if (n > 5 && !dirty) break; } if (dirty) render(); }
  const button = label => { const found = nodes(tree).find(n => n.type === 'button' && (text(n).trim() === label || n.props['aria-label'] === label)); assert.ok(found, `Missing ${label}: ${text(tree)}`); return found; };
  const widgets = () => nodes(tree).filter(n => typeof n.type === 'function' && n.props.bookingId && n.props.onFareChange);
  const h = { get text() { return text(tree); }, get tree() { return tree; }, get widgets() { return widgets(); }, button, payments, fareReads, queries, filters, inserts, alerts, settle, availability, get dialog(){return nodes(tree).find(n=>n.type==='dialog');},
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    setQuery: fn => queryHandler = fn, setFare: fn => fareHandler = fn, setPay: fn => payHandler = fn, setUser: value => signedIn = value,
    async click(label) { const n = button(label); assert.ok(!n.props.disabled, `Disabled: ${label}`); n.props.onClick(); await settle(); },
    async fare(value) { assert.equal(widgets().length, 1); widgets()[0].props.onFareChange(value); await settle(); },
    async poll() { for (const timer of timers) if (timer.ms === 5000) timer.cb(); await settle(); }
  };
  try { await settle(); await fn(h); } finally { for (const slot of slots) slot?.cleanup?.(); await built.close(); for (const k of ['__dashHooks', '__dashDb', '__dashPay', '__dashFare']) delete globalThis[k]; for (const k of globals) { if (original[k] === undefined) delete globalThis[k]; else globalThis[k] = original[k]; } }
}

for (const role of ['Rider', 'Merchant']) {
  test(`${role} receives its own keyed negotiation, keeps a confirmed fare through stale polls, and does not send a payment on agreement`, () => withDashboard(role, async h => {
    assert.equal(h.widgets.length, 1); assert.equal(h.widgets[0].key, `${user}:${id}`); assert.equal(h.widgets[0].props.role, role.toLowerCase());
    await h.fare(snapshot(user, { fareMinor: 2700, fareVersion: 2, selectedDriverId: driver }));
    await h.poll(); assert.equal(h.payments.length, 0);
    // The hook keeps the new price even if an old booking query returns version 1.
    h.setQuery(() => ({ data: booking({ status: 'in_progress' }), error: null })); await h.poll();
    assert.match(h.text, /27(?:\.00)?/); assert.equal(h.widgets.length, 0);
  }));

  test(`${role} never treats a failed active-trip lookup as permission to make another booking`, () => withDashboard(role, async h => {
    assert.match(h.text, /Could not check your active trip/);
    assert.doesNotMatch(h.text, /Confirm Request|Request Dispatch/);
    h.setQuery(() => ({ data: null, error: null })); await h.click('Retry active trip');
    assert.match(h.text, role === 'Rider' ? /Confirm Request/ : /Request Dispatch/);
  }, { query: () => ({ data: null, error: { message: 'offline' } }) }));
}

test('Driver mounts offers for only one card, rechecks the clicked fare, and requires another click after a price change', () => withDashboard('Driver', async h => {
  await h.click('Go online'); await h.click('Negotiate fare'); assert.equal(h.widgets.length, 1); assert.equal(h.widgets[0].key, `${driver}:${id}`);
  h.setFare(() => snapshot(driver, { fareMinor: 2500, fareVersion: 2, selectedDriverId: driver }));
  await h.click('Accept SLE 20.00'); assert.equal(h.payments.length, 0); assert.match(h.text, /fare changed/);
  assert.ok(h.button('Accept SLE 25.00')); await h.poll(); assert.ok(h.button('Accept SLE 25.00'));
  await h.click('Accept SLE 25.00'); assert.deepEqual(h.payments, [['accept', id]]); assert.match(h.text, /funding are confirmed/);
}));

test('Driver cannot accept while its proposal is pending or another driver is chosen', () => withDashboard('Driver', async h => {
  await h.click('Go online'); await h.click('Negotiate fare');
  const pending = { driverId: driver, status: 'pending', fareVersion: 1, expiresAt: new Date(Date.now() + 300000).toISOString() };
  await h.fare(snapshot(driver, { offers: [pending] })); assert.equal(h.button('Accept SLE 20.00').props.disabled, true);
  await h.fare(snapshot(driver, { selectedDriverId: 'another-driver' })); assert.equal(h.button('Accept SLE 20.00').props.disabled, true);
  assert.equal(h.payments.length, 0);
}));

test('Repeated Driver accepts authorize one preflight/payment and a changed session never reaches the payment API', () => withDashboard('Driver', async h => {
  await h.click('Go online'); const read = deferred(); h.setFare(() => read.promise);
  const accept = h.button('Accept SLE 20.00'); accept.props.onClick(); accept.props.onClick(); await h.settle(); assert.equal(h.fareReads.length, 1); assert.equal(h.payments.length, 0);
  h.setUser('another-user'); read.resolve(snapshot(driver)); await h.settle(); assert.equal(h.payments.length, 0); assert.match(h.text, /account changed/);
}));

test('A pending or uncertain escrow response reuses the same booking and never reports payment as completed', () => withDashboard('Driver', async h => {
  await h.click('Go online'); await h.click('Accept SLE 20.00');
  assert.match(h.text, /funding is processing/); assert.doesNotMatch(h.text, /funding are confirmed/);
  await h.click('Accept SLE 20.00'); assert.deepEqual(h.payments, [['accept', id], ['accept', id]]);
}, { pay: () => ({ pending: true, booking: booking() }) }));

test('A delayed empty booking read cannot clear a trip after its fare was confirmed', () => withDashboard('Rider', async h => {
  const stale = deferred(); h.setQuery(() => stale.promise); await h.poll();
  await h.fare(snapshot(user, { fareMinor: 2900, fareVersion: 2 })); stale.resolve({ data: null, error: null }); await h.settle();
  assert.equal(h.widgets.length, 1); assert.doesNotMatch(h.text, /Confirm Request/);
}));

for (const state of ['pending-offer', 'selected-other']) test(`Driver preflight rejects ${state} even before the negotiation panel was opened`, () => withDashboard('Driver', async h => {
  await h.click('Go online');
  h.setFare(() => snapshot(driver, state === 'selected-other' ? { selectedDriverId: 'another-driver' } : {
    offers: [{ driverId: driver, status: 'pending', fareVersion: 1, expiresAt: new Date(Date.now() + 300000).toISOString() }]
  }));
  await h.click('Accept SLE 20.00'); assert.equal(h.payments.length, 0);
  assert.match(h.text, state === 'selected-other' ? /another driver/ : /withdraw your proposal/);
}));

test('Switching between two Radar cards mounts one negotiation widget at a time', () => withDashboard('Driver', async h => {
  await h.click('Go online'); await h.click('Negotiate fare'); assert.equal(h.widgets[0].props.bookingId, id);
  const buttons = nodes(h.tree).filter(n => n.type === 'button' && text(n) === 'Negotiate fare');
  assert.equal(buttons.length, 1); buttons[0].props.onClick(); await h.settle();
  assert.equal(h.widgets.length, 1); assert.equal(h.widgets[0].props.bookingId, 'second-booking');
}, { query: () => ({ data: [booking(), booking({ id: 'second-booking' })], error: null }) }));

test('Leaving the Driver screen during preflight cannot send a payment after that read returns', () => withDashboard('Driver', async h => {
  await h.click('Go online'); const read = deferred(); h.setFare(() => read.promise);
  h.button('Accept SLE 20.00').props.onClick(); await h.settle(); h.unmount();
  read.resolve(snapshot(driver)); await h.settle(); assert.equal(h.payments.length, 0);
}));


// Catalog UI and cart integration share these dashboard regression checks.
{
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',productId='33333333-3333-4333-8333-333333333333';
const photo=i=>`${uid}/aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}.jpg`;
const product=(patch={})=>({id:productId,merchant_id:uid,name:'Rice',price:'1000.50',currency:'SLE',description:'Good rice',whatsapp_number:'+23277123456',image_paths:[],image_url:null,is_available:true,catalog_version:'0',...patch});
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return'';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function page(fn,{products=[],saved=null,loading=false,loadError='',gallery=null}={}){
 const dir=await mkdtemp(join(process.cwd(),'.catalog-ui-')),out=join(dir,'ui.mjs');const previous={window:globalThis.window,document:globalThis.document,Image:globalThis.Image,localStorage:globalThis.localStorage};
 const slots=[],effects=[],calls=[],files=new Map(),rows=new Map(products.map(p=>[p.id,p]));let i=0,dirty=true,tree,unmounted=false,identity=uid,rpcHandler=null,blocked=false,timer=0,uploadError=false,imageError=false,failAt=0,uploads=0;
 if(saved)files.set(`matmove:catalog-save:${uid}`,JSON.stringify(saved));
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 globalThis.__catalogHooks={useState(initial){const n=i++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return[slots[n].value,v=>{slots[n].value=typeof v==='function'?v(slots[n].value):v;dirty=true;}];},useRef(initial){const n=i++;if(!(n in slots))slots[n]={current:initial};return slots[n];},useEffect(fn,deps){const n=i++,old=slots[n];if(!old||changed(old.deps,deps)){const s={deps,cleanup:old?.cleanup};slots[n]=s;effects.push(()=>{s.cleanup?.();s.cleanup=fn();});}}};
 globalThis.window={setTimeout:()=>++timer,clearTimeout(){}};
 globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toBlob:fn=>fn(new Blob(['encoded'],{type:'image/jpeg'}))})};
 globalThis.Image=class{naturalWidth=800;naturalHeight=600;set src(v){queueMicrotask(()=>imageError?this.onerror?.():this.onload?.());}};
 globalThis.localStorage={getItem:key=>files.get(key)||null,setItem:(key,value)=>{if(blocked)throw Error('Storage blocked');files.set(key,value);},removeItem:key=>files.delete(key)};
 const savedRow=b=>product({id:b.p_id,name:b.p_name,price:b.p_price,currency:b.p_currency,description:b.p_description,whatsapp_number:b.p_whatsapp,image_paths:b.p_image_paths,is_available:b.p_available,catalog_version:b.p_expected===null?'0':String(BigInt(b.p_expected)+1n)});
 globalThis.__catalogDb={auth:{getSession:async()=>({data:{session:{user:{id:identity},access_token:'fixture-user-token'}},error:null})},storage:{from:bucket=>({getPublicUrl:path=>({data:{publicUrl:`https://fixture.supabase.co/storage/v1/object/public/${bucket}/${path}`}}),upload:async(path,blob,options)=>{calls.push({kind:'upload',bucket,path,blob,options});const failed=uploadError||++uploads===failAt;return{data:failed?null:{path},error:failed?{message:'failed'}:null};}})},rpc(name,body){const call={kind:'rpc',name,body:structuredClone(body),headers:{}};calls.push(call);const q={setHeader:(key,value)=>{call.headers[key]=value;return q;},then:(yes,no)=>Promise.resolve().then(async()=>{if(rpcHandler)return rpcHandler(body,savedRow);const row=savedRow(body);rows.set(row.id,row);return{data:row,error:null};}).then(yes,no)};return q;},from(table){const query={id:null,remove:false};const q={select:()=>q,eq:(name,value)=>{if(name==='id')query.id=value;return q;},delete:()=>{query.remove=true;return q;},maybeSingle:async()=>{calls.push({kind:'read',table,id:query.id});return{data:rows.get(query.id)||null,error:null};},then:(yes,no)=>Promise.resolve().then(()=>{calls.push({kind:'delete',table,id:query.id});const old=rows.get(query.id);rows.delete(query.id);return{data:old?[{id:old.id}]:[],error:null};}).then(yes,no)};return q;}};
 try{
 await build({entryPoints:['src/components/ProductCatalog.tsx'],tsconfig:'tsconfig.app.json',outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react/*'],plugins:[{name:'catalog-mocks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='hooks'?'export const {useState,useEffect,useRef}=globalThis.__catalogHooks;':'export const supabase=globalThis.__catalogDb;'}));}}]});
 const module=await import(pathToFileURL(out));function render(){i=0;dirty=false;tree=gallery?module.ProductGallery({product:gallery}):module.MerchantProductCatalog({userId:uid,products,loading,loadError,onReload:async()=>{calls.push({kind:'reload'});products=[...rows.values()];dirty=true;}});while(effects.length)effects.shift()();}
 async function settle(){for(let n=0;n<18;n++){if(dirty&&!unmounted)render();await new Promise(r=>setImmediate(r));if(n>8&&!dirty)break;}}
 const button=label=>{const b=nodes(tree).find(n=>n.type==='button'&&(text(n).trim()===label||n.props['aria-label']===label));assert.ok(b,`Missing ${label}: ${text(tree)}`);return b;};
 const h={module,calls,files,rows,button,settle,get text(){return text(tree);},get nodes(){return nodes(tree);},setHandler:fn=>rpcHandler=fn,setUser:id=>identity=id,block:()=>blocked=true,failUpload:()=>uploadError=true,failSecondUpload:()=>failAt=2,failImage:()=>imageError=true,setGallery:p=>{gallery=p;dirty=true;},unmount(){unmounted=true;slots.forEach(s=>s?.cleanup?.());},async input(label,value){const n=nodes(tree).find(n=>n.props['aria-label']===label);assert.ok(n,`Missing ${label}`);n.props.onChange({target:{value,checked:value}});await settle();},async click(label){const b=button(label);assert.ok(!b.props.disabled,`${label} disabled`);b.props.onClick();await settle();},async upload(count=1){const n=nodes(tree).find(n=>n.props['aria-label']==='Product photos');n.props.onChange({target:{files:Array.from({length:count},()=>new File(['pixels'],'photo.jpg',{type:'image/jpeg'})),value:'file'}});await settle();},async fill(){await this.input('Product name','New rice');await this.input('Product price','1000.50');await this.input('Product WhatsApp','23277123456');}};
 await settle();await fn(h);
 }finally{if(!unmounted)slots.forEach(s=>s?.cleanup?.());for(const[k,v]of Object.entries(previous))if(v===undefined)delete globalThis[k];else globalThis[k]=v;delete globalThis.__catalogHooks;delete globalThis.__catalogDb;await rm(dir,{recursive:true,force:true});}
}
test('prices preserve comma grouping, exact cents, quantity and currency without inventing a conversion',()=>page(async h=>{
 assert.match(h.module.productUploadError({statusCode:'403',message:'secret raw policy detail'}),/storage denied/i);assert.match(h.module.productUploadError({status:404}),/bucket is unavailable/);assert.match(h.module.productUploadError({status:413}),/5 MB/);assert.doesNotMatch(h.module.productUploadError({status:500,message:'private-token-value'}),/private-token/);
 assert.equal(h.module.catalogMoney('1000','SLE'),'SLE 1,000.00');assert.equal(h.module.catalogMoney('1000.50','USD',2),'USD 2,001.00');assert.equal(h.module.catalogMoney('1.001','SLE'),'Price unavailable');assert.equal(h.module.catalogMoney('1','EUR'),'Price unavailable');assert.equal(h.module.catalogCheckoutAllowed(product({currency:'USD'})),false);assert.equal(h.module.catalogCheckoutAllowed(product({is_available:false})),false);assert.equal(h.module.catalogCheckoutAllowed(product()),true);
}));
test('gallery shows three owned photos and selecting a thumbnail changes only the selected image',()=>page(async h=>{
 assert.equal(h.nodes.filter(n=>n.type==='img').length,4);await h.click('Photo 3 of Rice');assert.equal(h.nodes.find(n=>n.type==='img').props.src,`https://fixture.supabase.co/storage/v1/object/public/product_images/${photo(3)}`);assert.equal(h.calls.length,0);assert.deepEqual(h.module.catalogPhotos(product({image_paths:[`${other}/bad.jpg`]})),[]);assert.deepEqual(h.module.catalogPhotos(product({image_url:'javascript:bad'})),[]);
},{gallery:product({image_paths:[photo(1),photo(2),photo(3)]})}));
test('loading and failed reads never claim an empty catalog and prevent saves',async()=>{
 await page(async h=>{assert.match(h.text,/Loading your catalog/);assert.ok(!h.text.includes('No products listed'));await h.fill();h.button('Add to Catalog').props.onClick();await h.settle();assert.equal(h.calls.filter(c=>c.kind==='rpc').length,0);},{loading:true});
 await page(async h=>{assert.match(h.text,/offline/);assert.ok(!h.text.includes('No products listed'));},{loadError:'offline'});
});
test('new product saves one exact retained payload and binds its Authorization to the reviewed identity',()=>page(async h=>{
 await h.fill();h.setHandler((b,make)=>{assert.equal(h.files.size,1);const row=make(b);h.rows.set(row.id,row);return{data:row,error:null};});const button=h.button('Add to Catalog');button.props.onClick();button.props.onClick();await h.settle();const calls=h.calls.filter(c=>c.kind==='rpc');assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer fixture-user-token');assert.equal(calls[0].body.p_expected,null);assert.equal(calls[0].body.p_price,'1000.50');assert.equal(calls[0].body.p_whatsapp,'+23277123456');assert.equal(h.files.size,0);assert.match(h.text,/Product saved/);
}));
test('merchant edits price, USD currency and Sold status using the loaded version, preserving one product ID',()=>page(async h=>{
 await h.click('Edit Rice');await h.input('Product price','25.25');await h.input('Product currency','USD');await h.input('Product available',false);assert.match(h.text,/USD listing only/);await h.click('Save product changes');const call=h.calls.find(c=>c.kind==='rpc');assert.equal(call.body.p_id,productId);assert.equal(call.body.p_expected,'0');assert.equal(call.body.p_currency,'USD');assert.equal(call.body.p_available,false);assert.match(h.text,/USD 25.25/);assert.match(h.text,/Sold/);
},{products:[product()]}));
test('stale edit failures preserve form details and never report success',()=>page(async h=>{
 await h.click('Edit Rice');await h.input('Product name','Keep this draft');h.setHandler(()=>({data:null,error:{code:'P0001',message:'CONFLICT: Product changed. Reload it before saving.'}}));await h.click('Save product changes');assert.match(h.text,/Product changed/);assert.ok(!h.text.includes('Product saved.'));assert.equal(h.nodes.find(n=>n.props['aria-label']==='Product name').props.value,'Keep this draft');assert.equal(h.files.size,0);
},{products:[product()]}));
test('lost create response recovers the original saved row without a second RPC or a new product ID',()=>page(async h=>{
 await h.fill();h.setHandler((b,make)=>{h.rows.set(b.p_id,make(b));return{data:null,error:{code:'FETCH_ERROR',message:'lost'}};});await h.click('Add to Catalog');assert.match(h.text,/not confirmed/);assert.equal(h.files.size,1);await h.click('Retry original product save');assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);assert.equal(h.files.size,0);assert.match(h.text,/Product saved/);
}));
test('lost edit response verifies exact fields and the next version before confirming without another write',()=>page(async h=>{
 await h.click('Edit Rice');await h.input('Product available',false);h.setHandler((b,make)=>{h.rows.set(b.p_id,make(b));return{data:null,error:{code:'FETCH_ERROR'}};});await h.click('Save product changes');await h.click('Retry original product save');assert.equal(h.calls.filter(c=>c.kind==='rpc').length,1);assert.equal(h.rows.get(productId).catalog_version,'1');assert.match(h.text,/Product saved/);
},{products:[product()]}));
test('uploading decodes and converts photos, uses unique owned paths and never overwrites storage objects',()=>page(async h=>{
 await h.upload(3);assert.match(h.text,/Product photos \(3\/3\)/);assert.equal(h.calls.filter(c=>c.kind==='upload').length,3);for(const c of h.calls.filter(c=>c.kind==='upload')){assert.ok(c.path.startsWith(uid+'/'));assert.equal(c.blob.type,'image/jpeg');assert.equal(c.options.upsert,false);}await h.fill();await h.click('Add to Catalog');assert.equal(h.calls.find(c=>c.kind==='rpc').body.p_image_paths.length,3);
}));
test('a fourth image, a failed upload or an invalid decoded photo cannot become a saved image',async()=>{
 await page(async h=>{await h.upload(4);assert.match(h.text,/up to three/);assert.equal(h.calls.length,0);});
 await page(async h=>{h.failUpload();await h.upload();assert.match(h.text,/not confirmed/);assert.match(h.text,/Product photos \(0\/3\)/);});
 await page(async h=>{h.failImage();await h.upload();assert.match(h.text,/could not be opened/);assert.equal(h.calls.filter(c=>c.kind==='upload').length,0);});
});
test('blocked browser storage or a changed identity prevents any save RPC',async()=>{
 await page(async h=>{await h.fill();h.block();await h.click('Add to Catalog');assert.equal(h.calls.filter(c=>c.kind==='rpc').length,0);assert.ok(!h.text.includes('Product saved.'));});
 await page(async h=>{await h.fill();h.setUser(other);await h.click('Add to Catalog');assert.match(h.text,/sign-in changed/);assert.equal(h.calls.length,0);});
});
test('an unverified legacy photo requires an explicit removal before edit can save',()=>page(async h=>{
 await h.click('Edit Rice');assert.match(h.text,/older photo cannot be verified/);await h.click('Save product changes');assert.equal(h.calls.length,0);await h.click('Remove older photo');await h.click('Save product changes');assert.equal(h.calls.find(c=>c.kind==='rpc').body.p_image_paths.length,0);
},{products:[product({image_url:'https://legacy.example/old.jpg'})]}));
test('delete requires explicit confirmation, and editing availability remains a separate action',()=>page(async h=>{
 await h.click('Delete listing');assert.equal(h.calls.length,0);await h.click('Keep listing');assert.equal(h.calls.length,0);await h.click('Delete listing');await h.click('Confirm delete listing');assert.equal(h.calls.filter(c=>c.kind==='delete').length,1);
},{products:[product()]}));
test('late save receipts cannot publish after leaving the merchant screen',()=>page(async h=>{
 await h.fill();let resolve;h.setHandler(()=>new Promise(r=>resolve=r));h.button('Add to Catalog').props.onClick();await h.settle();assert.ok(resolve);h.unmount();resolve({data:product(),error:null});await h.settle();assert.ok(!h.text.includes('Product saved.'));assert.equal(h.files.size,1);
}));
test('used merchant, buyer and Account cart screens import the gallery/editor and currency checkout guard',async()=>{
 const [m,r,a]=await Promise.all(['src/pages/MerchantDashboard.tsx','src/pages/RiderDashboard.tsx','src/App.tsx'].map(p=>readFile(p,'utf8')));assert.match(m,/<MerchantProductCatalog key=\{profile.id\}/);assert.match(r,/<ProductGallery product=\{p\}/);assert.match(r,/disabled=\{!catalogCheckoutAllowed\(p\)\}/);assert.match(a,/checkoutListingsReady\?checkoutItems.map/);assert.match(a,/catalogMoney\(item.product\?\.price/);assert.match(m,/handleUpdateOrderStatus/);assert.match(a,/InviteEarn/);assert.match(a,/PortalGuide/);
});

const retainedBody=()=>({p_id:productId,p_expected:null,p_name:'Rice',p_price:'1000.50',p_currency:'SLE',p_description:'Good rice',p_whatsapp:'+23277123456',p_image_paths:[],p_available:true});
test('restored saves never submit automatically and an explicit retry uses the exact retained product ID and payload',()=>page(async h=>{
 assert.equal(h.calls.length,0);assert.match(h.text,/Unconfirmed product save/);await h.click('Retry original product save');assert.deepEqual(h.calls.find(c=>c.kind==='rpc').body,retainedBody());assert.match(h.text,/Product saved/);
},{saved:retainedBody()}));
test('corrupt saved requests and mismatched save receipts cannot produce a success message',async()=>{
 await page(async h=>{assert.match(h.text,/could not be read/);assert.equal(h.calls.length,0);},{saved:{...retainedBody(),p_image_paths:[`${other}/forged.jpg`]}});
 await page(async h=>{await h.fill();h.setHandler(b=>({data:product({id:b.p_id,merchant_id:other}),error:null}));await h.click('Add to Catalog');assert.match(h.text,/receipt did not match/);assert.ok(!h.text.includes('Product saved.'));assert.equal(h.files.size,1);});
});
test('owned legacy public images migrate into the editable photo paths without dropping the image',()=>page(async h=>{
 await h.click('Edit Rice');assert.match(h.text,/Product photos \(1\/3\)/);assert.ok(!h.text.includes('older photo cannot be verified'));await h.click('Save product changes');assert.deepEqual(h.calls.find(c=>c.kind==='rpc').body.p_image_paths,[`${uid}-aaaaaaaa-aaaa-4aaa-8aaa-000000000001.jpg`]);
},{products:[product({image_url:`https://fixture.supabase.co/storage/v1/object/public/product_images/${uid}-aaaaaaaa-aaaa-4aaa-8aaa-000000000001.jpg`})]}));
test('a confirmed replacement photo clears an unverified legacy URL and permits saving the edit',()=>page(async h=>{await h.click('Edit Rice');assert.match(h.text,/older photo cannot be verified/);await h.upload();assert.doesNotMatch(h.text,/older photo cannot be verified/);await h.click('Save product changes');assert.equal(h.calls.find(c=>c.kind==='rpc').body.p_image_paths.length,1);assert.match(h.text,/Product saved/);},{products:[product({image_url:'https://legacy.example/old.jpg'})]}));
test('a later failed product photo retains earlier confirmed uploads in the editor and exact save',()=>page(async h=>{h.failSecondUpload();await h.upload(2);assert.match(h.text,/Product photos \(1\/3\)/);assert.match(h.text,/not confirmed/);await h.fill();await h.click('Add to Catalog');assert.equal(h.calls.find(c=>c.kind==='rpc').body.p_image_paths.length,1);}));
test('an invalid new image array can still display its existing safe legacy image without accepting forged upload paths',()=>page(async h=>{assert.deepEqual(h.module.catalogPhotos(product({image_paths:[`${other}/invalid.jpg`],image_url:'https://legacy.example/old.jpg'})),['https://legacy.example/old.jpg']);assert.deepEqual(h.module.catalogPhotos(product({image_paths:[`${other}/invalid.jpg`],image_url:'javascript:bad'})),[]);}));
test('a changed identity prevents a product photo upload',()=>page(async h=>{
 h.setUser(other);await h.upload();assert.equal(h.calls.filter(c=>c.kind==='upload').length,0);assert.match(h.text,/sign-in changed/);
}));

}

// Driver radar coverage for merchant Dispatch and scheduled requests.
for(const kind of ['ride','delivery','scheduled'])test(`Driver sees pending_admin ${kind} requests without initiating payment`,()=>withDashboard('Driver',async h=>{
 await h.click('Go online');assert.ok(h.button('Accept SLE 20.00'));assert.equal(h.payments.length,0);assert.ok(h.filters.some(f=>f.includes('status.in.(pending,pending_admin)')));
},{query:()=>({data:[booking({status:'pending_admin',service_type:kind,scheduled_time:kind==='scheduled'?'2030-01-01T12:00:00Z':null})],error:null})}));
test('unpriced scheduled requests remain visible but cannot preflight, accept or fabricate take-home earnings',()=>withDashboard('Driver',async h=>{
 await h.click('Go online');const button=h.button('Awaiting fare confirmation');assert.equal(button.props.disabled,true);assert.match(h.text,/Awaiting a confirmed fare/);assert.doesNotMatch(h.text,/Estimated take-home/);
 button.props.onClick();await h.settle();assert.equal(h.fareReads.length,0);assert.equal(h.payments.length,0);
},{query:()=>({data:[booking({status:'pending_admin',service_type:'scheduled',fare_amount:0,scheduled_time:'2030-01-01T12:00:00Z'})],error:null})}));
test('Driver filters other assignments and self-created requests from an open radar result',()=>withDashboard('Driver',async h=>{
 await h.click('Go online');assert.doesNotMatch(h.text,/Accept SLE/);assert.equal(h.payments.length,0);
},{query:()=>({data:[booking({driver_id:'different-driver'}),booking({id:'66666666-6666-4666-8666-666666666666',rider_id:driver,status:'pending_admin'})],error:null})}));

{
 const feedRider='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',feedDriver='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',feedOther='cccccccc-cccc-4ccc-8ccc-cccccccccccc',feedAdmin='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 test('Driver radar SQL reads every open request status with authoritative eligibility and preserves request data',async t=>{
  const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite({postgresqlconf:['shared_buffers=16MB','max_connections=10','work_mem=1MB']});
  try{
   await pg.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key,role text,kyc_status text,is_wallet_frozen boolean default false);
    insert into profiles values('${feedRider}','merchant','approved',false),('${feedDriver}','driver','approved',false),('${feedOther}','driver','approved',false),('${feedAdmin}','admin','approved',false);
    create table user_roles(profile_id uuid,role text);insert into user_roles select id,role from profiles;
    create table wallets(user_id uuid,currency text,is_frozen boolean default false);insert into wallets(user_id,currency) select id,'SLE' from profiles;
    create table matmove_staff_access(id uuid primary key,is_active boolean,removed_at timestamptz,permissions jsonb);
    insert into matmove_staff_access values('${feedAdmin}',true,null,'["dispatch"]');
    create function matmove_admin_can(p_key text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.matmove_staff_access where id=auth.uid() and is_active and removed_at is null and permissions?p_key)$$;
    create table bookings(id uuid primary key default gen_random_uuid(),rider_id uuid,driver_id uuid,status text,service_type text,fare_amount numeric);
    create table ride_payments(booking_id uuid,driver_id uuid,state text);
    create function matmove_dispatch_driver_busy(p_driver uuid,p_booking uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.bookings where id is distinct from p_booking and driver_id=p_driver and status in ('pending','pending_admin','accepted','in_progress')) or exists(select 1 from public.ride_payments where booking_id is distinct from p_booking and driver_id=p_driver and coalesce(state,'') not in ('released','refunded','failed'))$$;
    grant usage on schema auth,public to authenticated,anon;grant select on bookings to authenticated,anon;create policy legacy_public_read on bookings for select to anon using(true);
    create policy old_rider_read on bookings for select to authenticated using(rider_id=auth.uid());
    insert into bookings(rider_id,status,service_type,fare_amount) values('${feedRider}','pending','ride',20),('${feedRider}','pending_admin','delivery',20),('${feedRider}','pending_admin','scheduled',0);
    insert into bookings(rider_id,driver_id,status,service_type,fare_amount) values('${feedRider}','${feedOther}','pending','ride',20);
   `);
   const sql=await readFile('docs/REQUEST_FEED_SETUP.sql','utf8');await pg.exec(sql);
   assert.equal((await pg.query("select count(*)::int n from pg_policy where polname='matmove_dispatch_visibility' and not polpermissive")).rows[0].n,1);
   const session=async uid=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await pg.exec('set role authenticated');};
   const rows=async()=> (await pg.query('select status,service_type,fare_amount from bookings order by service_type')).rows;
   await t.test('approved free Driver sees Ride, Merchant Dispatch and unpriced Schedule, but not another assignment',async()=>{
    await session(feedDriver);assert.equal((await rows()).length,3);assert.deepEqual((await rows()).map(r=>r.service_type),['delivery','ride','scheduled']);
   });
   await t.test('revoked approval, frozen wallet and contradictory membership deny open feeds',async()=>{
    await pg.exec('reset role');await pg.query("update profiles set kyc_status='pending' where id=$1",[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,0);
    await pg.exec('reset role');await pg.query("update profiles set kyc_status='approved' where id=$1",[feedDriver]);await pg.query('update wallets set is_frozen=true where user_id=$1',[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,0);
    await pg.exec('reset role');await pg.query('update wallets set is_frozen=false where user_id=$1',[feedDriver]);await pg.query("insert into user_roles values($1,'admin')",[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,0);await pg.exec('reset role');await pg.query("delete from user_roles where profile_id=$1 and role='admin'",[feedDriver]);
   });
   await t.test('active staff cannot use Driver visibility even with an approved Driver profile',async()=>{
    await pg.query("insert into matmove_staff_access values($1,true,null,'[]')",[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,0);await pg.exec('reset role');await pg.query('delete from matmove_staff_access where id=$1',[feedDriver]);
   });
   await t.test('legacy Driver without membership rows retains the same read access',async()=>{
    await pg.query('delete from user_roles where profile_id=$1',[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,3);
   });
   await t.test('busy Driver sees their own assigned trip and no other open requests',async()=>{
    await pg.exec('reset role');await pg.query("insert into bookings(rider_id,driver_id,status,service_type,fare_amount) values($1,$2,'accepted','ride',25)",[feedRider,feedDriver]);await session(feedDriver);assert.equal((await rows()).length,1);assert.equal((await rows())[0].status,'accepted');
    await pg.exec('reset role');await pg.query("delete from bookings where driver_id=$1 and status='accepted'",[feedDriver]);await pg.query("insert into ride_payments values(gen_random_uuid(),$1,'funding')",[feedDriver]);await session(feedDriver);assert.equal((await rows()).length,0);await pg.exec('reset role');await pg.exec('delete from ride_payments');
   });
   await t.test('Merchant still sees owned requests, anonymous reads stay denied, reruns preserve fares and states',async()=>{
    await session(feedRider);assert.equal((await rows()).length,4);await pg.exec('reset role;set role anon');assert.equal((await rows()).length,0);await assert.rejects(pg.query("select matmove_driver_radar_visible(null,null,'pending')"),/permission denied/);
    await pg.exec('reset role');const before=(await pg.query('select * from bookings order by id')).rows;await pg.exec(sql);assert.deepEqual((await pg.query('select * from bookings order by id')).rows,before);
   });
  }finally{await pg.close();}
 });
}

for(const role of ['Rider','Merchant']){
 test(`${role} scheduled request keeps explicit customer fare, vehicle, future time and exact map pins without payment`,()=>withDashboard(role,async h=>{
  const picker=nodes(h.tree).find(n=>typeof n.type==='function'&&n.props.onChange&&n.props.userId===user);assert.ok(picker);
  picker.props.onChange({pickup:{coords:[-13.23,8.48],address:'Confirmed pickup'},destination:{coords:[-13.24,8.49],address:'Confirmed destination'},distanceKm:2});await h.settle();
  await h.click('Schedule');const amount=nodes(h.tree).find(n=>n.type==='input'&&n.props.type==='number');assert.ok(amount,'Schedule must show its fare field');amount.props.onChange({target:{value:'40.25'}});
  const date=nodes(h.tree).find(n=>n.type==='input'&&n.props.type==='datetime-local');assert.ok(date);date.props.onChange({target:{value:'2030-01-01T12:00'}});await h.settle();
  await h.click(role==='Rider'?'Confirm Request':'Request Dispatch');assert.equal(h.inserts.length,1);const b=h.inserts[0];assert.equal(b.fare_amount,40.25);assert.equal(b.vehicle_type,'car');assert.equal(b.status,'pending_admin');assert.equal(b.scheduled_time,new Date('2030-01-01T12:00').toISOString());assert.equal(b.matmove_pickup_lat,8.48);assert.equal(b.matmove_destination_lng,-13.24);assert.equal(h.payments.length,0);assert.equal(h.alerts.length,0,JSON.stringify(h.alerts));
 },{query:()=>({data:null,error:null})}));
 test(`${role} cannot create an unpriced or past scheduled request`,()=>withDashboard(role,async h=>{
  const picker=nodes(h.tree).find(n=>typeof n.type==='function'&&n.props.onChange&&n.props.userId===user);picker.props.onChange({pickup:{coords:[-13.23,8.48],address:'Pickup'},destination:{coords:[-13.24,8.49],address:'Destination'},distanceKm:2});await h.settle();await h.click('Schedule');
  const input=type=>nodes(h.tree).find(n=>n.type==='input'&&n.props.type===type);
  input('number').props.onChange({target:{value:'0'}});input('datetime-local').props.onChange({target:{value:'2030-01-01T12:00'}});await h.settle();await h.click(role==='Rider'?'Confirm Request':'Request Dispatch');assert.equal(h.inserts.length,0);assert.match(h.alerts.at(-1),/positive fare/);
  input('number').props.onChange({target:{value:'40'}});input('datetime-local').props.onChange({target:{value:'2020-01-01T12:00'}});await h.settle();await h.click(role==='Rider'?'Confirm Request':'Request Dispatch');assert.equal(h.inserts.length,0);assert.match(h.alerts.at(-1),/future/);assert.equal(h.payments.length,0);
 },{query:()=>({data:null,error:null})}));
}

test('Driver restores its own saved online preference and only an explicit offline click changes it',()=>withDashboard('Driver',async h=>{assert.equal(h.button('Go offline').props['aria-pressed'],true);assert.equal(h.payments.length,0);await h.click('Go offline');assert.equal(h.availability.get(`matmove:driver-online:v1:${driver}`),'offline');assert.equal(h.button('Go online').props['aria-pressed'],false);},{online:true}));
test('Order In-App opens a modal rather than an inline checkout, and closing keeps payment submission explicit',()=>withDashboard('Rider',async h=>{assert.equal(h.dialog.ref.current.open,false);await h.click('Order In-App');assert.equal(h.dialog.ref.current.open,true);assert.match(text(h.dialog),/Rice/);assert.equal(h.payments.length,0);await h.click('Close checkout');assert.equal(h.dialog.ref.current.open,false);await h.click('Check a pending order');assert.equal(h.dialog.ref.current.open,true);assert.equal(h.payments.length,0);},{shop:true,shopProducts:[{id:'33333333-3333-4333-8333-333333333333',merchant_id:driver,name:'Rice',price:20,currency:'SLE',is_available:true,merchant:{business_name:'Shop'}}]}));

for(const role of ['Rider','Merchant'])test(`${role} can review an accepted trip and explicitly open a distinct new request without paying again`,()=>withDashboard(role,async h=>{
 const panel=()=>nodes(h.tree).find(n=>typeof n.props?.onNew==='function'&&Array.isArray(n.props.bookings));assert.equal(panel().props.bookings.length,1);assert.equal(panel().props.canCreate,true);panel().props.onNew();await h.settle();assert.match(h.text,/previous trip remains active/);assert.match(h.text,role==='Rider'?/Confirm Request/:/Request Dispatch/);assert.equal(h.payments.length,0);assert.equal(h.inserts.length,0);panel().props.onSelect(id);await h.settle();assert.match(h.text,/Driver is on the way|Driver on the way|Driver Found|Driver Accepted|Driver is arriving|driver/i);assert.equal(h.inserts.length,0);
},{query:()=>({data:booking({status:'accepted',driver_id:driver}),error:null})}));
for(const role of ['Rider','Merchant'])test(`${role} does not reopen a verified completed trip from a later stale active-trip response`,()=>withDashboard(role,async h=>{
 const label=role==='Rider'?'Confirm Arrival & Release Driver Payment':'Confirm Arrival & Release Payment';
 await h.click(label);if(role==='Merchant')await h.click('Confirm & Transfer');await h.poll();assert.doesNotMatch(h.text,/Trip in [Pp]rogress/);assert.equal(h.payments.length,1);
},{query:()=>({data:booking({status:'in_progress',driver_id:driver}),error:null}),pay:()=>({pending:false,booking:booking({status:'completed',driver_id:driver}),payment:{settled:true,driverEarnings:17,transfers:[{kind:'driver',transferId:'trn-completed'}]}})}));
