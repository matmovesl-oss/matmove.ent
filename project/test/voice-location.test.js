
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
async function withVoice(fn,{supported=true,throws=false}={}){
 const dir=await mkdtemp(join(process.cwd(),'.voice-')),out=join(dir,'voice.mjs'),old={window:globalThis.window,document:globalThis.document};const voices=[],messages=[],texts=[],timers=new Map(),events=new Map();let next=0,ends=0;
 globalThis.document={visibilityState:'visible',addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
 globalThis.window={isSecureContext:true,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),setTimeout:(f,ms)=>{timers.set(++next,{f,ms});return next;},clearTimeout:id=>timers.delete(id)};
 if(supported)window.webkitSpeechRecognition=class{constructor(){voices.push(this);}start(){if(throws)throw Error('permission blocked');this.started=true;}abort(){this.aborted=true;}};
 try{await build({entryPoints:['src/lib/voiceLocation.ts'],outfile:out,bundle:true,platform:'node',format:'esm'});const mod=await import(pathToFileURL(out));const h={mod,voices,messages,texts,timers,events,get ends(){return ends;},start:()=>mod.startLocationVoice({onText:t=>texts.push(t),onMessage:t=>messages.push(t),onEnd:()=>ends++})};await fn(h);}
 finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}await rm(dir,{recursive:true,force:true});}
}
test('microphone starts only on an explicit call, uses one final English result and always stops',()=>withVoice(async h=>{
 assert.equal(h.voices.length,0);assert.equal(h.mod.locationVoiceAvailable(),true);const cancel=h.start(),mic=h.voices[0];assert.equal(mic.started,true);assert.equal(mic.lang,'en-GB');assert.equal(mic.continuous,false);assert.equal(mic.interimResults,false);
 mic.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'interim'}}]});assert.equal(h.texts.length,0);
 mic.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'  Lumley\n beach  '}}]});assert.deepEqual(h.texts,['Lumley beach']);assert.equal(mic.aborted,true);cancel();assert.equal(h.ends,1);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);
}));
test('unsupported or insecure browsers explain the typed and map-pin fallback',async()=>{
 await withVoice(async h=>{h.start();assert.equal(h.voices.length,0);assert.match(h.messages[0],/unavailable/);},{supported:false});
 await withVoice(async h=>{window.isSecureContext=false;h.start();assert.equal(h.voices.length,0);assert.match(h.messages[0],/unavailable/);});
});
test('denied microphone permission and constructor/start failures end without a transcript',async()=>{
 await withVoice(async h=>{h.start();h.voices[0].onerror({error:'not-allowed'});assert.match(h.messages[0],/permission/);assert.equal(h.voices[0].aborted,true);assert.equal(h.texts.length,0);});
 await withVoice(async h=>{h.start();assert.match(h.messages[0],/could not start/);assert.equal(h.ends,1);},{throws:true});
});
test('cancel, backgrounding, pagehide and the listening timeout prevent later result publication',async()=>{
 for(const reason of ['cancel','hidden','pagehide','timeout'])await withVoice(async h=>{
 const cancel=h.start(),mic=h.voices[0],late=mic.onresult;
 if(reason==='cancel')cancel();else if(reason==='hidden'){document.visibilityState='hidden';h.events.get('visibilitychange')();}else if(reason==='pagehide')h.events.get('pagehide')();else [...h.timers.values()][0].f();
 late({resultIndex:0,results:[{isFinal:true,0:{transcript:'Late street'}}]});assert.equal(h.texts.length,0);assert.equal(mic.aborted,true);assert.equal(h.ends,1);
 });
});
test('empty, tiny or oversized transcripts cannot become an address',async()=>{
 for(const words of ['', 'x','a'.repeat(301)])await withVoice(async h=>{h.start();h.voices[0].onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:words}}]});assert.equal(h.texts.length,0);assert.match(h.messages[0],/3–300/);assert.equal(h.ends,1);});
});
test('voice helper does not upload audio, use a Google credential, store recordings or create bookings',async()=>{
 const code=await readFile('src/lib/voiceLocation.ts','utf8');assert.doesNotMatch(code,/fetch\(|localStorage|sessionStorage|MediaRecorder|supabase|API_KEY/);
 const rider=await readFile('src/pages/RiderDashboard.tsx','utf8'),merchant=await readFile('src/pages/MerchantDashboard.tsx','utf8');assert.match(rider,/<RideLocationPicker/);assert.match(merchant,/<RideLocationPicker/);
});
