import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase';
import {setPortalUnlocked} from '@/lib/portalPrivacy';
import {profilePhotoPickerOpen,onProfilePhotoPickerEnd,clearProfilePhotoPicker} from '@/lib/profilePhotoPicker';

type Receipt={userId:string;configured:boolean;digits:4|6;ok:boolean;code:string;attemptsRemaining:number;retryAfterSeconds:number};
const codes=['status','cooldown','already_configured','saved','setup_required','upgrade_required','verified','incorrect'];
export async function customerPasscode(userId:string,action:'status'|'create'|'verify'|'change',pin:string|null=null,newPin:string|null=null):Promise<Receipt>{
 if(!userId||!['status','create','verify','change'].includes(action))throw Error('Invalid passcode request.');
 if(['create','change'].includes(action)&&!/^\d{6}$/.test(newPin||''))throw Error('Choose exactly six digits.');
 if(['verify','change'].includes(action)&&!/^([0-9]{4}|[0-9]{6})$/.test(pin||''))throw Error('Enter your current passcode.');
 const session=await supabase.auth.getSession();
 if(session.error||session.data.session?.user.id!==userId||!session.data.session.access_token)throw Error('Your sign-in changed. Sign in again.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await supabase.rpc('matmove_customer_passcode',{p_action:action,p_pin:pin,p_new_pin:newPin}).setHeader('Authorization',`Bearer ${session.data.session.access_token}`).abortSignal(controller.signal);
  if(r.error){
   if(r.error.message?.includes('ACCESS: Customer account required.'))throw Error('This identity has active staff access. Use Admin or contact support to review your customer account.');
   if(r.error.message?.includes('ACCESS: Customer account setup required.'))throw Error('Your saved customer role needs review. Contact support; your account and wallet have not been deleted.');
   const code=typeof r.error.code==='string'&&/^[A-Z0-9_]{3,20}$/.test(r.error.code)?` (${r.error.code})`:'';
   throw Error(`Passcode check was not confirmed${code}. Reload the passcode screen and try again.`);
  }
  const after=await supabase.auth.getSession();
  if(after.error||after.data.session?.user.id!==userId)throw Error('Your sign-in changed. Sign in again.');
  const d=r.data;
  if(d?.userId!==userId||typeof d.configured!=='boolean'||![4,6].includes(d.digits)||typeof d.ok!=='boolean'||!codes.includes(d.code)||!Number.isInteger(d.attemptsRemaining)||d.attemptsRemaining<0||d.attemptsRemaining>5||!Number.isInteger(d.retryAfterSeconds)||d.retryAfterSeconds<0||d.retryAfterSeconds>300||
   (d.ok&&(!d.configured||!['saved','verified','upgrade_required'].includes(d.code)))||(d.ok&&d.digits!==6&&d.code!=='upgrade_required')||
   (d.code==='upgrade_required'&&d.digits!==4)||
   (d.code==='verified'&&action!=='verify')||(d.code==='saved'&&!['create','change'].includes(action)))throw Error('Passcode response could not be verified. Reload and try again.');
  return d;
 }catch(e){if(controller.signal.aborted)throw Error('Passcode check timed out. Reload to confirm the saved state.');throw e;}
 finally{clearTimeout(timer);}
}
export function watchPasscodeBackground(onLock:()=>void,userId='',isUnlocked:()=>boolean=()=>false){
 const hidden=()=>{if(document.visibilityState==='hidden'&&!(isUnlocked()&&profilePhotoPickerOpen(userId)))onLock();};
 const pickerEnded=()=>{setTimeout(hidden,0);};
 const stopPicker=onProfilePhotoPickerEnd(pickerEnded);
 const restored=(event:PageTransitionEvent)=>{if(event.persisted)onLock();};
 document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',onLock);window.addEventListener('pageshow',restored);
 return()=>{stopPicker();clearProfilePhotoPicker(userId);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',onLock);window.removeEventListener('pageshow',restored);};
}
export default function CustomerPasscode({userId,onLogout,children}:{userId:string;onLogout:()=>void|Promise<void>;children:(lock:()=>void)=>ReactNode}){
 const privacyDialog=useRef<HTMLDialogElement|null>(null),workspace=useRef<HTMLDivElement|null>(null);
 const [enteredUser,setEnteredUser]=useState('');
 const [status,setStatus]=useState<Receipt|null>(null),[unlocked,setUnlocked]=useState(false),[upgrade,setUpgrade]=useState(false);
 const [pin,setPin]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const unlockedNow=useRef(false),statusNow=useRef<Receipt|null>(null);statusNow.current=status;
 const current=useRef(userId);current.current=userId;const mounted=useRef(false),revision=useRef(0),mutex=useRef(false);
 const clear=()=>{setPin('');setNext('');setConfirm('');};
 const valid=(id:string,n:number)=>mounted.current&&current.current===id&&revision.current===n;
 function lock(){setPortalUnlocked(userId,false);unlockedNow.current=false;clearProfilePhotoPicker(userId);revision.current++;mutex.current=false;setBusy(false);setUnlocked(false);setUpgrade(false);clear();setError('');}
 async function load(){if(mutex.current)return;mutex.current=true;const n=++revision.current,id=userId;setBusy(true);setError('');clear();unlockedNow.current=false;setUnlocked(false);setUpgrade(false);
  try{const d=await customerPasscode(id,'status');if(valid(id,n))setStatus(d);}catch(e){if(valid(id,n)){setStatus(null);setError(e instanceof Error?e.message:'Passcode service unavailable.');}}
  finally{if(valid(id,n)){mutex.current=false;setBusy(false);}}
 }
 useEffect(()=>{mounted.current=true;setStatus(null);lock();void load();const stop=watchPasscodeBackground(lock,userId,()=>unlockedNow.current);const resume=()=>{if(document.visibilityState==='visible'&&!statusNow.current&&!mutex.current)void load();};document.addEventListener('visibilitychange',resume);return()=>{document.removeEventListener('visibilitychange',resume);mounted.current=false;revision.current++;mutex.current=false;stop();};},[userId]);
 async function submit(){
  if(mutex.current||!status)return;
  const creating=!status.configured,changing=upgrade;
  if((creating||changing)&&(!/^\d{6}$/.test(next)||next!==confirm)){setError('Enter the same six-digit passcode in both new passcode fields.');return;}
  if(!creating&&!new RegExp(`^[0-9]{${status.digits}}$`).test(pin)){setError(`Enter your current ${status.digits}-digit passcode.`);return;}
  mutex.current=true;setBusy(true);setError('');const id=userId,n=++revision.current;
  try{
   const d=await customerPasscode(id,creating?'create':changing?'change':'verify',creating?null:pin,creating||changing?next:null);
   if(!valid(id,n))return;setStatus(d);
   if(d.ok&&d.digits===6&&['saved','verified'].includes(d.code)){clear();setUpgrade(false);setPortalUnlocked(id,true);unlockedNow.current=true;setEnteredUser(id);setUnlocked(true);}
   else if(d.ok&&d.code==='upgrade_required'){setUpgrade(true);setNext('');setConfirm('');}
   else{clear();setUpgrade(false);setError(d.code==='cooldown'?`Too many attempts. Try again in ${d.retryAfterSeconds} seconds.`:d.code==='already_configured'?'A passcode is already saved. Enter it to continue.':d.code==='setup_required'?'Create your six-digit passcode.':`Incorrect passcode. ${d.attemptsRemaining} attempts remaining.`);}
  }catch(e){if(valid(id,n)){clear();setUpgrade(false);setError(e instanceof Error?e.message:'Passcode service unavailable.');}}
  finally{if(valid(id,n)){mutex.current=false;setBusy(false);}}
 }
 const allowed=unlocked&&status?.userId===userId&&status.configured&&status.digits===6;
 useLayoutEffect(()=>{
  const dialog=privacyDialog.current,root=workspace.current;
  if(root){if(allowed)root.removeAttribute('inert');else root.setAttribute('inert','');}
  const closePrivateDialogs=()=>{root?.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(item=>item.close());};
  let observer:MutationObserver|undefined;
  if(allowed){if(dialog?.open)dialog.close();}
  else{
   closePrivateDialogs();if(dialog&&!dialog.open)dialog.showModal();
   if(root&&typeof MutationObserver!=='undefined'){observer=new MutationObserver(closePrivateDialogs);observer.observe(root,{subtree:true,attributes:true,attributeFilter:['open']});}
  }
  return()=>{observer?.disconnect();};
 },[allowed,enteredUser,userId]);
 const creating=status&&!status.configured;
 const field=(label:string,value:string,set:(v:string)=>void,length:number)=><label className="block text-xs font-semibold text-slate-600">{label}<input aria-label={label} type="password" inputMode="numeric" autoComplete="off" maxLength={length} value={value} disabled={busy} onChange={e=>set(e.target.value.replace(/\D/g,'').slice(0,length))} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-center text-xl tracking-[.45em] text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"/></label>;
 return <><dialog ref={privacyDialog} aria-label="MATMOVE privacy lock" aria-hidden={allowed} onCancel={e=>e.preventDefault()} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-slate-100 p-0 backdrop:bg-slate-100"><main className="flex min-h-[100dvh] items-center justify-center bg-slate-100 px-5 py-8"><form aria-label="Customer passcode" onSubmit={e=>{e.preventDefault();void submit();}} className="w-full max-w-xs space-y-4 rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
  <div className="text-center"><p className="text-xs font-bold tracking-[.2em] text-emerald-700">MATMOVE</p><h1 className="mt-2 text-xl font-bold">{upgrade?'Upgrade to six digits':creating?'Create passcode':'Unlock your account'}</h1><p className="mt-1 text-xs text-slate-500">{upgrade?'Choose your new six-digit passcode.':creating?'Choose and confirm six digits.':'Enter your passcode to continue.'}</p></div>
  {status?.digits===4&&status.configured&&!upgrade&&<p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Enter your existing four digits first, then choose six digits.</p>}
  {!status?<p role="status" className="text-center text-sm text-slate-600">{busy?'Checking passcode…':'Passcode setup unavailable.'}</p>:<>
   {!creating&&!upgrade&&field(`Current ${status.digits}-digit passcode`,pin,setPin,status.digits)}
   {(creating||upgrade)&&<>{field('New six-digit passcode',next,setNext,6)}{field('Confirm six-digit passcode',confirm,setConfirm,6)}</>}
   <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?'Checking…':creating||upgrade?'Save passcode':'Unlock'}</button>
  </>}
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-800">{error}</p>}
  <div className="flex justify-between gap-3"><button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 text-xs text-slate-600 underline">Reload passcode setup</button><button type="button" onClick={()=>{lock();void onLogout();}} className="min-h-11 text-xs text-slate-600 underline">Sign out</button></div>
  <details className="text-xs text-slate-500"><summary className="cursor-pointer py-1">Forgot passcode?</summary><p className="mt-2">Contact MatMove support. Signing in again does not reset your passcode.</p></details>
 </form></main></dialog><div ref={workspace} hidden={!allowed} aria-hidden={!allowed} style={allowed?undefined:{display:'none'}}>{enteredUser===userId&&children(lock)}</div></>;
}
