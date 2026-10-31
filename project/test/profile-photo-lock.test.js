import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
async function page(fn){
 const dir=await mkdtemp(join(process.cwd(),'.photo-lock-')),out=join(dir,'test.mjs');
 const originals={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};const realNow=Date.now;
 let now=1000,n=0;const timers=new Map();
 try{
  await build({stdin:{contents:"export * from './lib/profilePhotoPicker';export {watchPasscodeBackground} from './components/CustomerPasscode';",resolveDir:join(process.cwd(),'src'),loader:'ts'},outfile:out,tsconfig:'tsconfig.app.json',bundle:true,platform:'node',format:'esm',external:['react','react/*'],plugins:[{name:'db',setup(b){b.onResolve({filter:/^@\/lib\/supabase$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const supabase={};'}));}}]});
  const m=await import(pathToFileURL(out));
  const win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';globalThis.window=win;globalThis.document=doc;Date.now=()=>now;
  globalThis.setTimeout=(fn,ms)=>{const id=++n;timers.set(id,{fn,at:now+(ms||0)});return id;};globalThis.clearTimeout=id=>timers.delete(id);
  let locks=0,unlocked=true;const stop=m.watchPasscodeBackground(()=>{locks++;unlocked=false;m.clearProfilePhotoPicker(uid);},uid,()=>unlocked);
  const input=()=>Object.assign(new EventTarget(),{type:'file',disabled:false});
  const h={m,input,get locks(){return locks;},unlock(){unlocked=true;},lockGate(){unlocked=false;},hide(){doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));},show(){doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));},event(type){win.dispatchEvent(type==='pageshow'?Object.assign(new Event(type),{persisted:true}):new Event(type));},tick(ms=0){now+=ms;for(let count=0;count<100;count++){const due=[...timers].find(([,v])=>v.at<=now);if(!due)return;timers.delete(due[0]);due[1].fn();}throw Error('Timer did not settle');}};
  try{await fn(h);}finally{stop();m.clearProfilePhotoPicker(other);assert.equal(timers.size,0,'Picker timers should be released');}
 }finally{Date.now=realNow;for(const[k,v]of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}await rm(dir,{recursive:true,force:true});}
}
test('owned profile gallery return preserves an already unlocked account and never verifies another PIN',()=>page(h=>{const file=h.input();h.m.beginProfilePhotoPicker(uid,file);h.hide();assert.equal(h.locks,0);file.dispatchEvent(new Event('change'));h.show();h.tick();assert.equal(h.locks,0);assert.equal(h.m.profilePhotoPickerOpen(uid),false);h.hide();assert.equal(h.locks,1);}));
test('ordinary backgrounding still locks without a profile photo chooser',()=>page(h=>{h.hide();assert.equal(h.locks,1);}));
test('a chooser cannot unlock a locked gate or suppress another account privacy lock',()=>page(h=>{h.lockGate();h.m.beginProfilePhotoPicker(uid,h.input());h.hide();assert.equal(h.locks,1);h.show();h.unlock();h.m.beginProfilePhotoPicker(other,h.input());h.hide();assert.equal(h.locks,2);h.m.clearProfilePhotoPicker(other);}));
test('page exit and back-forward restoration still lock during a profile chooser',()=>page(h=>{h.m.beginProfilePhotoPicker(uid,h.input());h.event('pagehide');assert.equal(h.locks,1);h.unlock();h.m.beginProfilePhotoPicker(uid,h.input());h.event('pageshow');assert.equal(h.locks,2);}));
test('chooser cancellation restores normal background locking without a new PIN request',()=>page(h=>{const input=h.input();h.m.beginProfilePhotoPicker(uid,input);input.dispatchEvent(new Event('cancel'));h.tick();assert.equal(h.locks,0);h.hide();assert.equal(h.locks,1);}));
test('an abandoned hidden chooser expires and locks instead of becoming a permanent exception',()=>page(h=>{h.m.beginProfilePhotoPicker(uid,h.input());h.hide();h.tick(120000);h.tick();assert.equal(h.locks,1);assert.equal(h.m.profilePhotoPickerOpen(uid),false);}));
test('focus fallback ends a chooser without change or cancel events; disabled inputs never defer a lock',()=>page(h=>{h.m.beginProfilePhotoPicker(uid,h.input());h.event('focus');h.tick(1000);h.tick();assert.equal(h.m.profilePhotoPickerOpen(uid),false);h.m.beginProfilePhotoPicker(uid,Object.assign(h.input(),{disabled:true}));h.hide();assert.equal(h.locks,1);}));
test('profile upload explicitly scopes the exception to its own file input and compact unlock retains six-digit server verification',async()=>{
 const photo=await readFile('src/components/AccountProfile.tsx','utf8'),pin=await readFile('src/components/CustomerPasscode.tsx','utf8');assert.match(photo,/beginProfilePhotoPicker\(userId,e.currentTarget\)/);assert.match(photo,/disabled=\{busy\|\|loading\|\|!!error\|\|!record\}/);assert.match(pin,/max-w-xs/);assert.match(pin,/<details/);assert.doesNotMatch(pin,/This privacy lock supplements|Your privacy screen locks when/);assert.match(pin,/customerPasscode\(id,creating\?'create'/);
});
