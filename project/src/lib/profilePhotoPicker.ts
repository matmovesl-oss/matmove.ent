// A short, account-bound exception for the profile photo chooser only.
// It never verifies a PIN, persists an unlock or suppresses pagehide/manual locks.
type Picker={userId:string;input:HTMLInputElement;expires:number;finish:()=>void;discard:()=>void};
let active:Picker|null=null;
const ended=new Set<()=>void>();
export function profilePhotoPickerOpen(userId:string){return !!active&&active.userId===userId&&Date.now()<active.expires;}
export function onProfilePhotoPickerEnd(listener:()=>void){ended.add(listener);return()=>{ended.delete(listener);};}
export function clearProfilePhotoPicker(userId:string){if(active?.userId===userId)active.discard();}
export function beginProfilePhotoPicker(userId:string,input:HTMLInputElement):()=>void {
 if(!userId||input.type!=='file'||input.disabled||document.visibilityState!=='visible')return()=>{};
 active?.discard();
 let done=false,settleTimer:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>;
 const cleanup=()=>{clearTimeout(timeout);if(settleTimer!==undefined)clearTimeout(settleTimer);input.removeEventListener('change',finish);input.removeEventListener('cancel',finish);window.removeEventListener('focus',returned);document.removeEventListener('visibilitychange',visible);};
 const discard=()=>{if(done)return;done=true;cleanup();if(active===picker)active=null;};
 const finish=()=>{if(done)return;discard();for(const listener of ended)listener();};
 const returned=()=>{if(!done&&document.visibilityState==='visible'){if(settleTimer!==undefined)clearTimeout(settleTimer);settleTimer=setTimeout(finish,1000);}};
 const visible=()=>{if(document.visibilityState==='visible')returned();};
 const picker:Picker={userId,input,expires:Date.now()+120000,finish,discard};active=picker;
 input.addEventListener('change',finish);input.addEventListener('cancel',finish);window.addEventListener('focus',returned);document.addEventListener('visibilitychange',visible);
 timeout=setTimeout(finish,120000);
 return finish;
}
