
type VoiceResult={isFinal:boolean;[index:number]:{transcript:string}};
type Recognition={lang:string;continuous:boolean;interimResults:boolean;maxAlternatives:number;onresult:((e:{resultIndex:number;results:ArrayLike<VoiceResult>})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export function locationVoiceAvailable(){return typeof window!=='undefined'&&window.isSecureContext!==false&&!!((window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition);}
export function startLocationVoice({onText,onMessage,onEnd}:{onText:(text:string)=>void;onMessage:(text:string)=>void;onEnd:()=>void}):()=>void{
 if(!locationVoiceAvailable()){onMessage('Voice entry is unavailable in this browser. Type the address, use your location or choose a map pin.');onEnd();return()=>{};}
 const Constructor=(window as SpeechWindow).SpeechRecognition||(window as SpeechWindow).webkitSpeechRecognition!;
 let recognition:Recognition;try{recognition=new Constructor!();}catch{onMessage('Microphone could not start. Type the address instead.');onEnd();return()=>{};}
 let finished=false,timer:number|undefined;
 const finish=()=>{if(finished)return;finished=true;if(timer!==undefined)window.clearTimeout(timer);recognition.onresult=null;recognition.onerror=null;recognition.onend=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',finish);try{recognition.abort();}catch{}onEnd();};
 const hidden=()=>{if(document.visibilityState==='hidden')finish();};
 recognition.lang='en-GB';recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
 recognition.onresult=event=>{
  if(finished)return;
  for(let i=event.resultIndex||0;i<event.results.length;i++){
   const result=event.results[i];if(!result?.isFinal)continue;
   const raw=result[0]?.transcript;
   const words=typeof raw==='string'?raw.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim():'';
   if(words.length<3||words.length>300){onMessage('Say a street, area or landmark using 3–300 characters, or type it instead.');finish();return;}
   try{onText(words);}finally{finish();}return;
  }
 };
 recognition.onerror=e=>{if(finished)return;onMessage(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)?'Microphone permission was unavailable. You can type the address or choose a map pin.':e.error==='no-speech'?'No speech was recognized. Try again or type the address.':'Voice entry could not finish. Type the address or try again.');finish();};
 recognition.onend=()=>{if(!finished){onMessage('Listening ended. Try again or type the address.');finish();}};
 document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',finish);
 timer=window.setTimeout(()=>{if(!finished){onMessage('Listening timed out. Try again or type the address.');finish();}},20000);
 try{recognition.start();}catch{onMessage('Microphone could not start. Type the address instead.');finish();}
 return finish;
}
