
import {useCallback,useEffect,useRef,useState} from 'react';
import {Bell,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
type Item={id:string;message_id:string;title:string;body:string;destination:string|null;created_at:string;read_at:string|null};
type Inbox={user_id:string;items:Item[];unread_count:string;observed_max_id:string|null;next_before:string|null};
const destinations=['home','wallet','trips','games','account','kyc'];
const positive=(x:unknown):x is string=>typeof x==='string'&&/^[1-9]\d{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const date=(x:unknown)=>typeof x==='string'&&Number.isFinite(Date.parse(x));
export function validateInbox(value:any,userId:string,before:string|null=null):Inbox{
 if(value?.user_id!==userId||!Array.isArray(value.items)||value.items.length>30||typeof value.unread_count!=='string'||!/^\d{1,19}$/.test(value.unread_count)||!(value.observed_max_id===null||positive(value.observed_max_id))||!(value.next_before===null||positive(value.next_before)))throw new Error('Your notification response could not be verified.');
 let previous=before;const seen=new Set<string>();
 for(const i of value.items){
  if(!positive(i.id)||!uuid(i.message_id)||typeof i.title!=='string'||i.title.length<1||i.title.length>100||typeof i.body!=='string'||i.body.length<1||i.body.length>2000||!(i.destination===null||destinations.includes(i.destination))||!date(i.created_at)||!(i.read_at===null||date(i.read_at))||seen.has(i.id)||previous!==null&&BigInt(i.id)>=BigInt(previous)||value.observed_max_id===null||BigInt(i.id)>BigInt(value.observed_max_id))throw new Error('Your notification page could not be verified.');
  previous=i.id;seen.add(i.id);
 }
 if(value.next_before!==null&&(value.items.length!==30||value.next_before!==previous))throw new Error('Your notification continuation could not be verified.');
 return value;
}
async function bounded<T>(promise:PromiseLike<T>):Promise<T>{let timer=0;try{return await Promise.race([Promise.resolve(promise),new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error('Notifications timed out. Please retry.')),15000);})]);}finally{window.clearTimeout(timer);}}
async function session(userId:string){const r=await bounded(supabase.auth.getSession());if(r.error||r.data.session?.user.id!==userId)throw new Error('Your sign-in changed. Reopen the app.');}
export default function NotificationBell({userId,onNavigate}:{userId:string;onNavigate:(destination:string)=>void}){
 const [open,setOpen]=useState(false),[page,setPage]=useState<Inbox|null>(null),[items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),mounted=useRef(false),current=useRef(userId),generation=useRef(0),lock=useRef(false),controller=useRef<AbortController|null>(null);current.current=userId;
 const valid=(token:number)=>mounted.current&&current.current===userId&&generation.current===token;
 const read=useCallback(async(before:string|null=null,quiet=false)=>{
  if(lock.current)return;lock.current=true;const token=++generation.current;const abort=new AbortController();controller.current=abort;
  if(!quiet)setLoading(true);setError('');
  try{
   await session(userId);if(!valid(token))return;
   const r=await bounded(supabase.rpc('matmove_notifications',{p_before:before}).abortSignal(abort.signal));if(r.error)throw r.error;
   const result=validateInbox(r.data,userId,before);await session(userId);if(!valid(token))return;
   setPage(result);setItems(old=>before?[...old,...result.items.filter(i=>!old.some(o=>o.id===i.id))]:result.items);
  }catch(e:any){if(valid(token)){setError(e.message||'Notifications could not be loaded.');setPage(null);setItems([]);}}
  finally{if(valid(token)){setLoading(false);lock.current=false;}abort.abort();}
 },[userId]);
 useEffect(()=>{
  mounted.current=true;lock.current=false;setPage(null);setItems([]);setError('');setLoading(true);setOpen(false);void read();
  const refresh=()=>{if(document.visibilityState==='visible'&&!dialog.current?.open)void read(null,true);};
  const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
  return()=>{mounted.current=false;generation.current++;controller.current?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[userId,read]);
 useEffect(()=>{const el=dialog.current;if(open&&el&&!el.open)el.showModal();if(!open&&el?.open)el.close();return()=>{if(el?.open)el.close();};},[open]);
 async function mark(id:string,through=false){
  if(lock.current||!page||error)return;lock.current=true;setBusy(true);setError('');const token=++generation.current;
  try{
   await session(userId);if(!valid(token))return;
   const r=await bounded(supabase.rpc('matmove_notification_read',{p_id:id,p_through:through}));if(r.error)throw r.error;
   if(r.data?.user_id!==userId||r.data.id!==id||r.data.through!==through||!Number.isSafeInteger(r.data.changed)||r.data.changed<0)throw new Error('Read status could not be verified. Reload notifications.');
   await session(userId);if(!valid(token))return;
   lock.current=false;await read();
  }catch(e:any){if(valid(token)){setError(e.message||'Read status was not confirmed. Reload notifications.');setPage(null);setItems([]);}}
  finally{if(mounted.current&&current.current===userId){lock.current=false;setBusy(false);}}
 }
 function go(item:Item){if(current.current!==userId||!item.destination||!destinations.includes(item.destination))return;try{onNavigate(item.destination);setOpen(false);}catch{setError('This section could not be opened. Use the app navigation.');}}
 const unread=page?.user_id===userId&&!error?page.unread_count:null;
 return <><button type="button" aria-label={unread===null?'Open notifications':`Open notifications, ${unread} unread`} onClick={()=>{setOpen(true);void read();}} className="relative flex min-h-11 min-w-11 items-center justify-center rounded-xl border p-2 text-emerald-800"><Bell size={20}/>{unread&&BigInt(unread)>0n&&<span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{BigInt(unread)>9n?'9+':unread}</span>}</button>
 <dialog ref={dialog} aria-label="Your notifications" onCancel={e=>{e.preventDefault();setOpen(false);}} className="m-auto max-h-[88dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/55">
  <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-black">Notifications</h2><button type="button" aria-label="Close notifications" onClick={()=>setOpen(false)} className="min-h-11 min-w-11 rounded-xl border p-2"><X size={20}/></button></div>
  <p className="mt-2 text-sm text-slate-600">Messages from MatMove. Opening a message never confirms a payment or changes your verification.</p>
  {loading&&<p role="status" className="mt-4">Loading notifications…</p>}
  {error&&<div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}<button type="button" disabled={busy||loading} onClick={()=>void read()} className="ml-2 min-h-11 font-bold underline">Retry notifications</button></div>}
  {!error&&page&&<><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{page.unread_count} unread</span><div className="flex gap-3"><button type="button" disabled={busy||loading} onClick={()=>void read()} className="min-h-11 text-sm font-bold text-emerald-800">Refresh</button>{page.observed_max_id&&BigInt(page.unread_count)>0n&&<button type="button" disabled={busy||loading} onClick={()=>void mark(page.observed_max_id!,true)} className="min-h-11 text-sm font-bold text-emerald-800">Mark all read</button>}</div></div>
   {!loading&&items.length===0&&<p className="mt-4 text-sm text-slate-600">No messages yet.</p>}
   <ol className="mt-3 space-y-3">{items.map(i=><li key={i.id} className={`rounded-2xl border p-4 ${i.read_at?'border-slate-200':'border-emerald-300 bg-emerald-50'}`}><span className="text-xs text-slate-500">{i.read_at?'Read':'Unread'} · {new Date(i.created_at).toLocaleString()}</span><h3 className="mt-1 font-bold">{i.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{i.body}</p><div className="mt-3 flex flex-wrap gap-4">{i.destination&&<button type="button" disabled={busy||loading} onClick={()=>go(i)} className="min-h-11 text-sm font-bold text-emerald-800">Open {i.destination==='kyc'?'Account verification':i.destination}</button>}{!i.read_at&&<button type="button" disabled={busy||loading} onClick={()=>void mark(i.id)} className="min-h-11 text-sm font-bold text-emerald-800">Mark read</button>}</div></li>)}</ol>
   {page.next_before&&<button type="button" disabled={loading||busy} onClick={()=>void read(page.next_before)} className="mt-4 min-h-11 w-full rounded-xl border p-3 font-bold">Older messages</button>}
  </>}
 </dialog></>;
}
