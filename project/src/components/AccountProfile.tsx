import {useCallback,useEffect,useRef,useState} from 'react';
import {Camera,Loader2,RefreshCw,UserCircle} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {beginProfilePhotoPicker} from '@/lib/profilePhotoPicker';

const BUCKET='matmove-profile-photos';
const EVENT='matmove:account-presentation';
async function deadline<T>(operation:PromiseLike<T>,milliseconds=15000):Promise<T>{
 let timer=0;
 try{return await Promise.race([Promise.resolve(operation),new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error('The request timed out. Reload your saved profile before retrying.')),milliseconds);})]);}
 finally{window.clearTimeout(timer);}
}
type Presentation={user_id:string;display_name:string|null;photo_path:string|null;version:number};
export function validatePresentation(value:any,userId:string):Presentation{
 if(value?.user_id!==userId||!Number.isSafeInteger(value.version)||value.version<0||
  !(value.display_name===null||typeof value.display_name==='string'&&value.display_name.length<=60)||
  !(value.photo_path===null||typeof value.photo_path==='string'&&value.photo_path.startsWith(`${userId}/`)&&new RegExp(`^${userId}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp)$`).test(value.photo_path)))throw new Error('Your profile response could not be verified. Reload it before editing.');
 return value as Presentation;
}
async function sameUser(userId:string){
 const {data,error}=await deadline(supabase.auth.getSession());
 if(error||data.session?.user.id!==userId)throw new Error('Your sign-in changed. Reopen your account.');
}
function usePresentation(userId:string){
 const [record,setRecord]=useState<Presentation|null>(null),[photoUrl,setPhotoUrl]=useState('');
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[photoError,setPhotoError]=useState('');
 const mounted=useRef(false),epoch=useRef(0),current=useRef(userId),controller=useRef<AbortController|null>(null);current.current=userId;
 const reload=useCallback(async()=>{
  const token=++epoch.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const valid=()=>mounted.current&&current.current===userId&&epoch.current===token;
  setLoading(true);setError('');setPhotoError('');
  const timeout=window.setTimeout(()=>abort.abort(),15000);
  try{
   await sameUser(userId);if(!valid())return;
   const {data,error:rpcError}=await deadline(supabase.rpc('matmove_account_presentation_me').abortSignal(abort.signal));
   if(rpcError)throw rpcError;if(abort.signal.aborted)throw new Error('Profile loading timed out. Please retry.');
   const next=validatePresentation(data,userId);let url='',photoIssue='';
   if(next.photo_path){
    try{
     const signed=await deadline(supabase.storage.from(BUCKET).createSignedUrl(next.photo_path,600),8000);
     if(signed.error)throw signed.error;
     if(!signed.data?.signedUrl)throw new Error('Your profile photo could not be loaded.');
     url=signed.data.signedUrl;
    }catch{photoIssue='Your saved photo could not be loaded. You can replace it, remove it, or reload your profile.';}
   }
   await sameUser(userId);
   if(valid()&&!abort.signal.aborted){setRecord(next);setPhotoUrl(url);setPhotoError(photoIssue);}
   else if(valid())throw new Error('Profile loading timed out. Please retry.');
  }catch(err:any){if(valid()){setError(err.message||'Your profile could not be loaded.');setPhotoUrl('');}}
  finally{window.clearTimeout(timeout);if(valid())setLoading(false);}
 },[userId]);
 useEffect(()=>{
  mounted.current=true;setRecord(null);setPhotoUrl('');void reload();
  const changed=(event:Event)=>{if((event as CustomEvent).detail?.userId===userId)void reload();};
  const refresh=()=>{if(document.visibilityState==='visible')void reload();};
  window.addEventListener(EVENT,changed);document.addEventListener('visibilitychange',refresh);
  const timer=window.setInterval(refresh,300000);
  return()=>{mounted.current=false;epoch.current++;controller.current?.abort();window.clearInterval(timer);window.removeEventListener(EVENT,changed);document.removeEventListener('visibilitychange',refresh);};
 },[userId,reload]);
 return{record:record?.user_id===userId?record:null,photoUrl:record?.user_id===userId?photoUrl:'',loading,error,photoError,reload};
}
function Photo({url,size='small'}:{url:string;size?:'small'|'large'}){
 const [failed,setFailed]=useState('');
 return <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-emerald-700 ${size==='large'?'h-20 w-20':'h-10 w-10'}`}>{url&&failed!==url?<img src={url} alt="Your profile photo" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:<UserCircle size={size==='large'?48:28}/>}</span>;
}
export function AccountIdentity({userId,fallbackName}:{userId:string;fallbackName:string}){
 const {record,photoUrl}=usePresentation(userId);
 return <><span className="min-w-0"><b className="block text-sm text-slate-900">Account</b><span className="block max-w-48 truncate text-xs text-slate-500">{record?.display_name||fallbackName}</span></span><Photo url={photoUrl}/></>;
}
export async function prepareProfilePhoto(file:File):Promise<Blob>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG or WebP photo up to 5 MB.');
 const objectUrl=URL.createObjectURL(file);
 try{
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('This photo could not be decoded. Choose another image.'));element.src=objectUrl;});
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>12000||image.naturalHeight>12000)throw new Error('Choose a smaller photo with valid dimensions.');
  const scale=Math.min(1,1024/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('Photo editing is unavailable in this browser.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Photo conversion failed.')),'image/jpeg',0.86));
  if(blob.size>2097152)throw new Error('Choose a smaller photo. The prepared photo must be 2 MB or smaller.');
  return blob;
 }finally{URL.revokeObjectURL(objectUrl);}
}
export default function AccountProfile({userId}:{userId:string}){
 const {record,photoUrl,loading,error,photoError,reload}=usePresentation(userId);
 const [name,setName]=useState(''),[version,setVersion]=useState(0),[photo,setPhoto]=useState<Blob|null>(null),[preview,setPreview]=useState('');
 const [removePhoto,setRemovePhoto]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const pickerDone=useRef<(()=>void)|null>(null);
 const dirty=useRef(false),mutex=useRef(false),mounted=useRef(false),current=useRef(userId),uploaded=useRef('');current.current=userId;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pickerDone.current?.();};},[]);
 useEffect(()=>{if(record&&!dirty.current){setName(record.display_name||'');setVersion(record.version);setRemovePhoto(false);}},[record]);
 useEffect(()=>{if(!photo){setPreview('');return;}const url=URL.createObjectURL(photo);setPreview(url);return()=>URL.revokeObjectURL(url);},[photo]);
 async function choose(file:File){
  if(mutex.current)return;mutex.current=true;setBusy(true);setFailure('');setNotice('');const actor=userId;
  try{const blob=await prepareProfilePhoto(file);if(mounted.current&&current.current===actor){setPhoto(blob);setRemovePhoto(false);dirty.current=true;uploaded.current='';}}
  catch(err:any){if(mounted.current&&current.current===actor)setFailure(err.message||'Could not prepare your photo.');}
  finally{mutex.current=false;if(mounted.current&&current.current===actor)setBusy(false);}
 }
 async function save(){
  if(mutex.current||!record||loading||error)return;mutex.current=true;setBusy(true);setFailure('');setNotice('');const actor=userId;
  const valid=()=>mounted.current&&current.current===actor;
  try{
   await sameUser(actor);if(!valid())return;
   let path=removePhoto?null:record.photo_path;
   if(photo){
    path=uploaded.current||`${actor}/${crypto.randomUUID()}.jpg`;
    if(!uploaded.current){const result=await deadline(supabase.storage.from(BUCKET).upload(path,photo,{contentType:'image/jpeg',upsert:false}),20000);if(result.error)throw result.error;if(result.data?.path!==path)throw new Error('Photo upload was not confirmed.');uploaded.current=path;}
   }
   await sameUser(actor);if(!valid())return;
   const result=await deadline(supabase.rpc('matmove_save_account_presentation',{p_display_name:name.trim()||null,p_photo_path:path,p_expected:version}),20000);
   if(result.error)throw result.error;
   const saved=validatePresentation(result.data,actor);
   if(saved.version!==version+1||saved.photo_path!==path||saved.display_name!==(name.trim()||null))throw new Error('Your profile save was not confirmed. Reload it before trying again.');
   if(!valid())return;
   dirty.current=false;uploaded.current='';setPhoto(null);setRemovePhoto(false);setName(saved.display_name||'');setVersion(saved.version);setNotice('Profile saved. Your verified identity details have not changed.');
   window.dispatchEvent(new CustomEvent(EVENT,{detail:{userId:actor}}));
  }catch(err:any){if(valid())setFailure(`${err.message||'Could not save your profile.'} Reload saved profile to check its latest state before retrying.`);}
  finally{mutex.current=false;if(valid())setBusy(false);}
 }
 return <section aria-labelledby="mm-profile-edit-title" className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
  <div className="flex flex-wrap items-center gap-4"><Photo size="large" url={removePhoto?'':preview||photoUrl}/><div><h2 id="mm-profile-edit-title" className="text-lg font-bold text-slate-900">Your profile photo & display name</h2><p className="mt-1 max-w-lg text-sm text-slate-600">Personalize your account here. Your legal name, phone, email and verified identity are managed separately through KYC.</p></div></div>
  {loading?<p role="status" className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin"/>Loading profile…</p>:error?<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>:null}
  {photoError&&!loading&&<p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{photoError}</p>}
  <div className="mt-4 space-y-4"><label className="block text-sm font-bold text-slate-700">Display name (optional)<input type="text" autoComplete="nickname" value={name} maxLength={60} disabled={busy||loading||!!error||!record} onChange={e=>{setName(e.target.value);dirty.current=true;setNotice('');}} className="mt-2 w-full rounded-xl border p-3 text-base font-normal" placeholder="How you want your account to appear"/></label>
   <div className="flex flex-wrap gap-3"><label className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold ${busy||loading||error||!record?'opacity-50':'cursor-pointer'}`}><Camera size={18}/>Choose profile photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||loading||!!error||!record} onClick={e=>{pickerDone.current?.();pickerDone.current=beginProfilePhotoPicker(userId,e.currentTarget);}} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void choose(file);}} className="sr-only"/></label>{(record?.photo_path||photo)&&<button type="button" disabled={busy||loading||!!error} onClick={()=>{setPhoto(null);setRemovePhoto(true);dirty.current=true;uploaded.current='';setNotice('');}} className="min-h-11 rounded-xl border px-4 text-sm font-bold">Remove photo</button>}</div>
   <p className="text-xs text-slate-500">JPG, PNG or WebP up to 5 MB. Photos are resized and saved privately; removing a photo hides it from your profile.</p>
   <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||loading||!!error||!record} onClick={()=>void save()} className="min-h-11 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">{busy?'Saving profile…':'Save profile'}</button><button type="button" disabled={busy||loading} onClick={()=>{dirty.current=false;setPhoto(null);setRemovePhoto(false);uploaded.current='';setFailure('');setNotice('');void reload();}} className="flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold disabled:opacity-50"><RefreshCw size={16}/>Reload saved profile</button></div>
  </div>
  {failure&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{failure}</p>}{notice&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
 </section>;
}
