


import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const uid='11111111-1111-4111-8111-111111111111';
function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return [n,...nodes(n.props?.children)];}
function text(n){if(n==null||typeof n==='boolean')return '';if(typeof n!=='object')return String(n);if(Array.isArray(n))return n.map(text).join('');return text(n.props?.children);}
async function bundle(file,{controlled=false,extra=''}={}){
 const dir=await mkdtemp(join(process.cwd(),'.booking-map-test-'));const out=join(dir,'ui.mjs');
 try{
  await build({stdin:{contents:(await readFile(file,'utf8'))+extra,resolveDir:join(process.cwd(),file.substring(0,file.lastIndexOf('/'))),loader:'tsx'},tsconfig:'tsconfig.app.json',define:{'import.meta.env.VITE_GOOGLE_MAPS_API_KEY':'"test-key"'},outfile:out,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/*','react-dom/*','lucide-react'],plugins:[{name:'ui-mocks',setup(b){
   b.onResolve({filter:/^@\/lib\/(supabase|apiFetch|useWalletAccess)$/},args=>({path:args.path,namespace:'mock'}));
   b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.endsWith('supabase')?'export const supabase=globalThis.__bookingDb;':args.path.endsWith('apiFetch')?'export const walletFetch=async()=>{throw Error("Unexpected wallet request");};':'export const useWalletAccess=()=>({frozen:false,approved:true});'}));
   if(controlled){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:'export const {useState,useRef,useEffect,useCallback}=globalThis.__bookingHooks;'}));}
  }}]});
  return {module:await import(pathToFileURL(out)),close:()=>rm(dir,{recursive:true,force:true})};
 }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
function place(address,lng=-13.23,lat=8.48){return {formatted_address:address,place_id:address,geometry:{location:{lng:()=>lng,lat:()=>lat}}};}
async function withPicker(fn,{places=[],rpcError=null,voice=false}={}){
 const original={window:globalThis.window,document:globalThis.document,google:globalThis.google,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 let i=0,dirty=true,tree,timer=0,unmounted=false;
 const slots=[],effects=[],geocodes=[],routes=[],emitted=[],rpcs=[],gps=[],predictions=[],voices=[],savedTimers=new Map();
 const changed=(a,b)=>!a||a.length!==b?.length||a.some((v,j)=>!Object.is(v,b[j]));
 globalThis.__bookingHooks={
  useState(initial){const x=i++;if(!(x in slots))slots[x]={value:typeof initial==='function'?initial():initial};return[slots[x].value,v=>{slots[x].value=typeof v==='function'?v(slots[x].value):v;dirty=true;}];},
  useRef(initial){const x=i++;if(!(x in slots))slots[x]={current:initial};return slots[x];},
  useCallback(fn,deps){const x=i++;if(!(x in slots)||changed(slots[x].deps,deps))slots[x]={fn,deps};return slots[x].fn;},
  useEffect(fn,deps){const x=i++,old=slots[x];if(!old||changed(old.deps,deps)){const record={deps,cleanup:old?.cleanup};slots[x]=record;effects.push(()=>{record.cleanup?.();record.cleanup=fn();});}}
 };
 const sdk={
  importLibrary:async()=>({AutocompleteSessionToken:class{},AutocompleteSuggestion:{fetchAutocompleteSuggestions:request=>new Promise((resolve,reject)=>predictions.push({request,resolve,reject}))}}),
  Map:class{addListener(){return {};}panTo(){}},
  Marker:class{addListener(){}setMap(){}setPosition(){}},
  Geocoder:class{geocode(request,cb){geocodes.push({request,cb});}},
  DirectionsRenderer:class{setMap(){}setDirections(){}},
  DirectionsService:class{route(request,cb){routes.push({request,cb});}},
  LatLngBounds:class{},TravelMode:{DRIVING:'DRIVING'},event:{clearInstanceListeners(){}}
 };
 globalThis.google={maps:sdk};
 globalThis.window={google:globalThis.google,setTimeout:(cb,ms)=>{savedTimers.set(++timer,{cb,ms});return timer;},clearTimeout:id=>savedTimers.delete(id),setInterval:()=>++timer,clearInterval(){}};
 globalThis.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 globalThis.window.addEventListener=()=>{};globalThis.window.removeEventListener=()=>{};
 if(voice)globalThis.window.SpeechRecognition=class{constructor(){voices.push(this);}start(){}abort(){this.aborted=true;}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition:(success,error)=>gps.push({success,error})}}});
 let currentUser=uid;
 globalThis.__bookingDb={auth:{getSession:async()=>({data:{session:{user:{id:currentUser}}}})},rpc:async(name,args)=>{rpcs.push({name,args});if(name==='matmove_home_preferences')return{data:{user_id:uid,places},error:rpcError};return{data:{kind:args.p_kind,address:args.p_address,latitude:args.p_latitude,longitude:args.p_longitude,version:2},error:null};}};
 const built=await bundle('src/components/RideLocationPicker.tsx',{controlled:true});
 function render(){i=0;dirty=false;tree=built.module.RideLocationPicker({userId:uid,onChange:v=>emitted.push(JSON.parse(JSON.stringify(v)))});for(const n of nodes(tree))if(n.type==='div'&&n.ref&&typeof n.ref==='object')n.ref.current={};while(effects.length)effects.shift()();}
 async function settle(){for(let x=0;x<10;x++){if(dirty&&!unmounted)render();await new Promise(resolve=>setImmediate(resolve));if(x>3&&!dirty)break;}if(dirty&&!unmounted)render();}
 function button(label){const matches=nodes(tree).filter(n=>n.type==='button'&&text(n)===label);assert.ok(matches.length,`Button missing: ${label}\n${text(tree)}`);return matches[0];}
 const h={get tree(){return tree;},get text(){return text(tree);},get last(){return emitted.at(-1);},geocodes,routes,gps,rpcs,predictions,voices,button,settle,setUser:id=>currentUser=id,
  async timers(ms){for(const[id,t]of [...savedTimers])if(t.ms===ms){savedTimers.delete(id);t.cb();}await settle();},
  async click(label){const b=button(label);assert.ok(!b.props.disabled,`Disabled: ${label}`);b.props.onClick();await settle();},
  async type(target,value){const input=nodes(tree).find(n=>n.type==='input'&&n.props['aria-label']===`${target} address`);assert.ok(input);input.props.onChange({target:{value}});await settle();},
  async choose(target,address){await this.type(target,address);await this.click(`Find ${target.toLowerCase()}`);geocodes.at(-1).cb([place(address)],'OK');await settle();await this.click(address);},
  async route(){await this.click('Preview route');routes.at(-1).cb({routes:[{legs:[{distance:{value:2500}}]}]},'OK');await settle();},
  async unmount(){unmounted=true;for(const s of slots)s?.cleanup?.();}
 };
 try{await settle();await fn(h);}finally{if(!unmounted)await h.unmount();await built.close();delete globalThis.__bookingDb;delete globalThis.__bookingHooks;for(const key of ['window','document','google']){if(original[key]===undefined)delete globalThis[key];else globalThis[key]=original[key];}if(original.navigator)Object.defineProperty(globalThis,'navigator',original.navigator);else delete globalThis.navigator;}
}

test('Changing selected address immediately invalidates the route and a delayed old route cannot restore the fare',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.choose('Destination','First Destination');await h.route();assert.equal(h.last.distanceKm,2.5);
 await h.click('Preview route');const stale=h.routes.at(-1);assert.equal(h.last.distanceKm,null);
 await h.type('Destination','New destination');assert.equal(h.last.destination,null);assert.equal(h.last.distanceKm,null);
 stale.cb({routes:[{legs:[{distance:{value:99999}}]}]},'OK');await h.settle();assert.equal(h.last.distanceKm,null);assert.equal(h.button('Preview route').props.disabled,true);
}));

test('Late search and GPS responses cannot replace a manually selected pickup, and no fixed street is fabricated',()=>withPicker(async h=>{
 await h.type('Pickup','Old search');await h.click('Find pickup');const stale=h.geocodes.at(-1);
 await h.choose('Pickup','Chosen Street');assert.equal(h.last.pickup.address,'Chosen Street');
 stale.cb([place('Wrong Street')],'OK');await h.settle();assert.doesNotMatch(h.text,/Wrong Street/);
 h.gps[0].success({coords:{longitude:-13.3,latitude:8.4,accuracy:10}});await h.settle();assert.equal(h.last.pickup.address,'Chosen Street');
 await h.click('Use live location');h.gps.at(-1).success({coords:{longitude:0,latitude:0,accuracy:8000}});await h.settle();assert.match(h.text,/approximate/);assert.equal(h.last.pickup.address,'Chosen Street');
}));

test('Saved coordinates select the owned place directly; saving uses the loaded version and duplicate clicks send one write',()=>withPicker(async h=>{
 const homes=nodes(h.tree).filter(n=>n.type==='button'&&text(n)==='home');assert.equal(homes.length,2);
 homes[0].props.onClick();await h.settle();assert.equal(h.last.pickup.address,'Saved Home');assert.deepEqual(h.last.pickup.coords,[-13.23,8.48]);
 const save=h.button('Save pickup as home');save.props.onClick();save.props.onClick();await h.settle();
 const writes=h.rpcs.filter(r=>r.name==='matmove_save_place');assert.equal(writes.length,1);assert.equal(writes[0].args.p_expected,4);assert.equal(writes[0].args.p_user_id,uid);
},{places:[{kind:'home',address:'Saved Home',longitude:-13.23,latitude:8.48,version:4}]}));

test('Text-only saved places require choosing the resolved address, and session changes prevent saving',()=>withPicker(async h=>{
 await h.click('work');assert.equal(h.last.pickup,null);assert.equal(h.geocodes.at(-1).request.address,'Work Street');
 h.geocodes.at(-1).cb([place('Resolved Work')],'OK');await h.settle();await h.click('Resolved Work');assert.equal(h.last.pickup.address,'Resolved Work');
 h.setUser('different-user');await h.click('Save pickup as work');assert.equal(h.rpcs.filter(r=>r.name==='matmove_save_place').length,0);assert.match(h.text,/account changed/);
},{places:[{kind:'work',address:'Work Street',longitude:null,latitude:null,version:1}]}));

test('A failed preferences fetch shows Retry rather than claiming no saved places',()=>withPicker(async h=>{
 assert.match(h.text,/Could not load saved places/);assert.ok(h.button('Reload saved places'));assert.doesNotMatch(h.text,/Select a location below to save/);
},{rpcError:{message:'network failed'}}));

test('Unmounted route callbacks do not publish a late route',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.choose('Destination','Destination Street');await h.click('Preview route');const old=h.routes.at(-1);const last=h.last;
 await h.unmount();old.cb({routes:[{legs:[{distance:{value:5000}}]}]},'OK');assert.deepEqual(h.last,last);
}));

test('Rider shop and merchant inventory render loading before empty data, and wallet approval controls remain separate',async()=>{
 globalThis.__bookingDb={};
 const rider=await bundle('src/pages/RiderDashboard.tsx',{extra:'\nexport {RiderShop};'});
 const merchant=await bundle('src/pages/MerchantDashboard.tsx',{extra:'\nexport {MerchantInventory};'});
 try{
  const shop=renderToStaticMarkup(React.createElement(rider.module.RiderShop,{profile:{id:uid},wallet:{}}));assert.match(shop,/Loading shop products/);assert.doesNotMatch(shop,/No products listed yet/);
  const inventory=renderToStaticMarkup(React.createElement(merchant.module.MerchantInventory,{profile:{id:uid}}));assert.match(inventory,/Loading your catalog/);assert.doesNotMatch(inventory,/No products listed yet/);
 }finally{await rider.close();await merchant.close();delete globalThis.__bookingDb;}
});

function prediction(label,lng=-13.23,lat=8.48,details=Promise.resolve()){
 return{placeId:label,text:{toString:()=>label},toPlace:()=>({location:{lng:()=>lng,lat:()=>lat},formattedAddress:label,fetchFields:()=>details})};
}
test('Typing automatically debounces Places suggestions without Find and confirms coordinates only after a selected result',()=>withPicker(async h=>{
 await h.type('Pickup','Lum');assert.equal(h.last.pickup,null);assert.equal(h.predictions.length,0);
 await h.type('Pickup','Lumley');await h.timers(350);assert.equal(h.predictions.length,1);
 const call=h.predictions[0];assert.equal(call.request.input,'Lumley');assert.deepEqual(call.request.includedRegionCodes,['sl']);assert.ok(call.request.sessionToken);
 call.resolve({suggestions:[{placePrediction:prediction('Lumley Beach')} ]});await h.settle();assert.match(h.text,/Lumley Beach/);assert.equal(h.last.pickup,null);
 await h.click('Lumley Beach');assert.deepEqual(h.last.pickup.coords,[-13.23,8.48]);assert.equal(h.last.distanceKm,null);
}));
test('A delayed suggestion from a different field cannot replace the latest field or leave a selectable stale place',()=>withPicker(async h=>{
 await h.type('Pickup','Lumley');await h.timers(350);const old=h.predictions[0];
 await h.type('Destination','Congo');await h.timers(350);const current=h.predictions[1];
 current.resolve({suggestions:[{placePrediction:prediction('Congo Cross')} ]});await h.settle();
 old.resolve({suggestions:[{placePrediction:prediction('Wrong old pickup')} ]});await h.settle();
 assert.match(h.text,/Congo Cross/);assert.doesNotMatch(h.text,/Wrong old pickup/);
}));
test('Suggestions explain unavailable service and timeout while leaving the Find and pin fallback available',()=>withPicker(async h=>{
 await h.type('Pickup','Lumley');await h.timers(350);h.predictions[0].reject(Error('Places disabled'));await h.settle();
 assert.match(h.text,/Live suggestions are unavailable/);assert.equal(h.button('Find pickup').props.disabled,false);
 await h.type('Destination','Congo');await h.timers(350);await h.timers(10000);assert.match(h.text,/Suggestions timed out/);
 h.predictions.at(-1).resolve({suggestions:[{placePrediction:prediction('Late place')} ]});await h.settle();assert.doesNotMatch(h.text,/Late place/);
}));
test('Editing while place details load invalidates those coordinates and malformed coordinates never become a pickup',()=>withPicker(async h=>{
 let resolve;const details=new Promise(r=>resolve=r);
 await h.type('Pickup','Lumley');await h.timers(350);h.predictions[0].resolve({suggestions:[{placePrediction:prediction('Lumley Beach',-13.23,8.48,details)}]});await h.settle();
 h.button('Lumley Beach').props.onClick();await h.settle();await h.type('Pickup','New place');resolve();await h.settle();assert.equal(h.last.pickup,null);
 await h.timers(350);h.predictions.at(-1).resolve({suggestions:[{placePrediction:prediction('Bad coordinates',999,999)}]});await h.settle();await h.click('Bad coordinates');assert.equal(h.last.pickup,null);assert.match(h.text,/Could not confirm/);
}));


test('two confirmed coordinates automatically preview one route without a request or payment',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.timers(400);assert.equal(h.routes.length,0);
 await h.choose('Destination','Destination Street');assert.equal(h.last.distanceKm,null);await h.timers(400);assert.equal(h.routes.length,1);assert.equal(h.last.distanceKm,null);
 const route=h.routes[0];assert.deepEqual(route.request.origin,{lat:8.48,lng:-13.23});assert.deepEqual(route.request.destination,{lat:8.48,lng:-13.23});
 route.cb({routes:[{legs:[{distance:{value:4500}}]}]},'OK');await h.settle();assert.equal(h.last.distanceKm,4.5);assert.match(h.text,/Route preview ready/);
 assert.equal(h.rpcs.filter(r=>r.name!=='matmove_home_preferences').length,0);
}));
test('editing before the automatic preview cancels it and late routes cannot restore the previous fare',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.choose('Destination','Destination Street');await h.type('Destination','Still typing');await h.timers(400);assert.equal(h.routes.length,0);
 await h.choose('Destination','New Place');await h.timers(400);assert.equal(h.routes.length,1);const stale=h.routes[0];await h.type('Pickup','Different pickup');stale.cb({routes:[{legs:[{distance:{value:9900}}]}]},'OK');await h.settle();assert.equal(h.last.distanceKm,null);assert.equal(h.last.pickup,null);
}));
test('manual preview cancels the queued automatic duplicate and timeout keeps distance unavailable',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.choose('Destination','Destination Street');await h.click('Preview route');await h.timers(400);assert.equal(h.routes.length,1);
 await h.timers(15000);assert.match(h.text,/Route lookup timed out/);assert.equal(h.last.distanceKm,null);h.routes[0].cb({routes:[{legs:[{distance:{value:2000}}]}]},'OK');await h.settle();assert.equal(h.last.distanceKm,null);
}));
test('unsupported voice never starts a microphone and typed search stays available',()=>withPicker(async h=>{
 assert.equal(h.button('Speak pickup').props.disabled,true);assert.match(h.text,/Voice entry is unavailable here/);await h.choose('Pickup','Manual Street');assert.equal(h.last.pickup.address,'Manual Street');
}));
test('spoken text searches places but never becomes confirmed coordinates until a result is selected',()=>withPicker(async h=>{
 assert.equal(h.voices.length,0);await h.click('Speak destination');assert.equal(h.voices.length,1);const mic=h.voices[0];assert.match(h.text,/Listening for destination/);
 mic.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'Lumley beach'}}]});await h.settle();assert.equal(h.last.destination,null);await h.timers(350);assert.equal(h.predictions.at(-1).request.input,'Lumley beach');
 h.predictions.at(-1).resolve({suggestions:[{placePrediction:prediction('Lumley Beach confirmed')}]});await h.settle();await h.click('Lumley Beach confirmed');assert.equal(h.last.destination.address,'Lumley Beach confirmed');assert.equal(mic.aborted,true);
},{voice:true}));
test('typing or choosing another field cancels voice and a captured late transcript cannot replace the edit',()=>withPicker(async h=>{
 await h.click('Speak pickup');const mic=h.voices[0],late=mic.onresult;await h.type('Pickup','My own street');assert.equal(mic.aborted,true);
 late({resultIndex:0,results:[{isFinal:true,0:{transcript:'Wrong street'}}]});await h.settle();assert.doesNotMatch(h.text,/Wrong street/);assert.equal(h.last.pickup,null);
 await h.click('Speak destination');const second=h.voices[1];await h.unmount();assert.equal(second.aborted,true);
},{voice:true}));

test('starting voice editing clears the previous destination and fare before any transcript arrives',()=>withPicker(async h=>{
 await h.choose('Pickup','Pickup Street');await h.choose('Destination','Old Destination');await h.route();assert.equal(h.last.distanceKm,2.5);
 await h.click('Speak destination');assert.equal(h.last.destination,null);assert.equal(h.last.distanceKm,null);assert.equal(h.button('Preview route').props.disabled,true);
 await h.click('Stop microphone');assert.equal(h.last.destination,null);assert.equal(h.voices[0].aborted,true);
},{voice:true}));
