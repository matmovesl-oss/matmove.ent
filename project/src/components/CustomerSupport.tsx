import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageCircle,Send,X,RefreshCw,ArrowLeft,ChevronDown,ChevronRight,ArrowUpRight,Globe,Instagram} from 'lucide-react';
import {supabase} from '@/lib/supabase';

type Ticket={id:string;ticket_number:string;subject:string;category:string;status:string;created_at:string;last_message_at:string;last_message:string;unread_count:number};
type Message={id:string;sender_type:'customer'|'admin';body:string;created_at:string;read_at:string|null};
type PublicContact={id:string;kind:'social'|'whatsapp';platform_name:string;link_url:string|null;whatsapp_phone:string|null;icon_key:string;display_order:number};
const categories=[['account','Account'],['wallet','Wallet & payments'],['ride','Rides'],['delivery','Delivery'],['merchant','Merchant'],['other','Other']];
const makeKey=()=>crypto.randomUUID();
const pretty=(v:string)=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'Date unavailable';};
const statusLabel=(s:string)=>({open:'Open',in_review:'In review',waiting_customer:'Waiting for you',resolved:'Resolved'}[s]||s);
const safeHttps=(value:string|null)=>{if(!value)return null;try{const url=new URL(value);return url.protocol==='https:'?url.toString():null;}catch{return null;}};
const phoneDigits=(value:string|null)=>String(value||'').replace(/[^0-9]/g,'');

function ContactGlyph({icon}:{icon:string}){
 const glyphs:Record<string,string>={facebook:'f',tiktok:'♪',youtube:'▶',linkedin:'in',x:'𝕏',telegram:'➤',snapchat:'◉',website:'↗',generic:'↗'};
 if(icon==='instagram')return <Instagram size={19}/>;
 return <span aria-hidden="true" className="text-sm font-black">{glyphs[icon]||'↗'}</span>;
}

export default function CustomerSupport({userId}:{userId:string}){
 const [open,setOpen]=useState(false),[showInbox,setShowInbox]=useState(false);
 const [tickets,setTickets]=useState<Ticket[]>([]),[selected,setSelected]=useState<string|null>(null),[messages,setMessages]=useState<Message[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [subject,setSubject]=useState(''),[category,setCategory]=useState('account'),[body,setBody]=useState(''),[reply,setReply]=useState('');
 const [contacts,setContacts]=useState<PublicContact[]>([]),[contactsLoading,setContactsLoading]=useState(true),[contactsError,setContactsError]=useState('');
 const live=useRef(false),identity=useRef(userId),request=useRef<string|null>(null);
 const ticketRequest=useRef(0),messageRequest=useRef(0);identity.current=userId;

 const loadContacts=useCallback(async()=>{
  try{
   const {data,error}=await supabase.from('matmove_public_contacts')
    .select('id,kind,platform_name,link_url,whatsapp_phone,icon_key,display_order')
    .eq('is_active',true).order('display_order',{ascending:true}).order('created_at',{ascending:true});
   if(error)throw error;
   const valid=(Array.isArray(data)?data:[]).filter((item:any)=>{
    if(item.kind==='whatsapp')return phoneDigits(item.whatsapp_phone).length>=8&&phoneDigits(item.whatsapp_phone).length<=15;
    return item.kind==='social'&&!!safeHttps(item.link_url)&&typeof item.platform_name==='string'&&item.platform_name.trim().length>1;
   });
   setContacts(valid as PublicContact[]);setContactsError('');
  }catch(e){setContactsError(e instanceof Error?e.message:'Public contact links are temporarily unavailable.');}
  finally{setContactsLoading(false);}
 },[]);

 useEffect(()=>{
  let mounted=true;
  const refresh=async()=>{
   try{
    const {data,error}=await supabase.from('matmove_public_contacts')
     .select('id,kind,platform_name,link_url,whatsapp_phone,icon_key,display_order')
     .eq('is_active',true).order('display_order',{ascending:true}).order('created_at',{ascending:true});
    if(error)throw error;
    const valid=(Array.isArray(data)?data:[]).filter((item:any)=>{
     if(item.kind==='whatsapp')return phoneDigits(item.whatsapp_phone).length>=8&&phoneDigits(item.whatsapp_phone).length<=15;
     return item.kind==='social'&&!!safeHttps(item.link_url)&&typeof item.platform_name==='string'&&item.platform_name.trim().length>1;
    });
    if(mounted){setContacts(valid as PublicContact[]);setContactsError('');}
   }catch(e){if(mounted)setContactsError(e instanceof Error?e.message:'Public contact links are temporarily unavailable.');}
   finally{if(mounted)setContactsLoading(false);}
  };
  void refresh();
  const channel=supabase.channel('matmove-public-contact-links-'+userId)
   .on('postgres_changes',{event:'*',schema:'public',table:'matmove_public_contacts'},()=>{void refresh();})
   .subscribe();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
  const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',onVisible);
  return()=>{mounted=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);void supabase.removeChannel(channel);};
 },[userId]);

 const loadTickets=useCallback(async()=>{
  const id=userId,sequence=++ticketRequest.current;
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_list');
   if(error)throw error;
   if(!live.current||identity.current!==id||sequence!==ticketRequest.current)return;
   if(data?.user_id!==id||!Array.isArray(data.items))throw new Error('Support requests could not be verified.');
   setTickets(data.items as Ticket[]);
  }catch(e){if(live.current&&identity.current===id&&sequence===ticketRequest.current)setError(e instanceof Error?e.message:'Support is temporarily unavailable.');}
 },[userId]);
 const loadMessages=useCallback(async(conversationId:string)=>{
  const id=userId,sequence=++messageRequest.current;
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_messages',{p_conversation_id:conversationId});
   if(error)throw error;
   if(!live.current||identity.current!==id||sequence!==messageRequest.current)return;
   if(data?.conversation?.id!==conversationId||!Array.isArray(data.messages))throw new Error('Conversation could not be verified.');
   setMessages(data.messages as Message[]);
  }catch(e){if(live.current&&identity.current===id&&sequence===messageRequest.current)setError(e instanceof Error?e.message:'Messages could not be loaded.');}
 },[userId]);
 useEffect(()=>{
  if(!open||!showInbox)return;
  live.current=true;ticketRequest.current++;messageRequest.current++;setTickets([]);setMessages([]);void loadTickets();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible'){void loadTickets();if(selected)void loadMessages(selected);}},15000);
  return()=>{live.current=false;ticketRequest.current++;messageRequest.current++;window.clearInterval(timer);};
 },[userId,open,showInbox,loadTickets,loadMessages,selected]);

 async function openTicket(e:React.FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  const key=request.current||makeKey();request.current=key;
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_open',{p_request_key:key,p_subject:subject.trim(),p_category:category,p_body:body.trim()});
   if(error)throw error;
   const id=data?.conversation?.id;
   if(typeof id!=='string'||data?.message?.sender_type!=='customer')throw new Error('The support request was not confirmed. Retry the same request.');
   request.current=null;setSubject('');setBody('');setSelected(id);setNotice('Your support request has been sent. MatMove can now see it in the Admin inbox.');await loadTickets();await loadMessages(id);
  }catch(e){setError(e instanceof Error?e.message:'Could not send your request.');}
  finally{setBusy(false);}
 }
 async function sendReply(e:React.FormEvent){
  e.preventDefault();if(!selected||!reply.trim()||busy)return;setBusy(true);setError('');
  const key=makeKey();
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_message',{p_conversation_id:selected,p_request_key:key,p_body:reply.trim()});
   if(error)throw error;
   if(data?.conversation_id!==selected||typeof data.id!=='string')throw new Error('Message delivery was not confirmed.');
   setReply('');await Promise.all([loadMessages(selected),loadTickets()]);
  }catch(e){setError(e instanceof Error?e.message:'Message could not be sent.');}
  finally{setBusy(false);}
 }
 const activeWhatsapp=contacts.find(c=>c.kind==='whatsapp');
 const socialLinks=contacts.filter(c=>c.kind==='social'&&safeHttps(c.link_url));
 const whatsappDigits=phoneDigits(activeWhatsapp?.whatsapp_phone||null);
 const whatsappHref=whatsappDigits?'https://wa.me/'+whatsappDigits+'?text='+encodeURIComponent('Hello MatMove Support'):null;

 return <>
  <button type="button" onClick={()=>{setOpen(true);setShowInbox(false);messageRequest.current++;setSelected(null);setError('');setNotice('');void loadContacts();}} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-bold text-emerald-800" aria-label="Open MatMove support and social links"><MessageCircle size={18}/><span>Support & Socials</span><ChevronDown size={15}/>{tickets.some(t=>t.unread_count>0)&&<span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] text-white">{tickets.reduce((n,t)=>n+Number(t.unread_count||0),0)}</span>}</button>
  {open&&<div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5"><section role="dialog" aria-modal="true" aria-label="MatMove Support & Socials" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
   <header className="flex items-center justify-between border-b p-4"><div><h2 className="text-lg font-black">MatMove Support & Socials</h2><p className="text-xs text-slate-500">{showInbox?'Talk directly with the MatMove support team.':'Official MatMove channels and support contacts.'}</p></div><button type="button" aria-label="Close support" onClick={()=>setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl border"><X size={19}/></button></header>
   <div className="min-h-0 flex-1 overflow-y-auto p-4">
    {error&&<p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice&&<p role="status" className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!showInbox?<div className="space-y-4">
     <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-center gap-2"><Globe size={18} className="text-emerald-800"/><h3 className="font-black text-emerald-950">Connect with MatMove</h3></div><p className="mt-1 text-xs text-emerald-900">Follow our official channels for updates, service announcements and support.</p></div>
     {contactsLoading&&contacts.length===0?<p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading MatMove contact links…</p>:null}
     {contactsError&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Some contact links could not be refreshed. You can still use the in-app support inbox.</p>}
     {whatsappHref&&<a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-emerald-700"><MessageCircle size={20}/></span><span className="min-w-0 flex-1"><span className="block text-sm font-black">WhatsApp Support</span><span className="block text-xs text-emerald-800">+{whatsappDigits}</span></span><ArrowUpRight size={18}/></a>}
     {socialLinks.map(item=>{const url=safeHttps(item.link_url);if(!url)return null;return <a key={item.id} href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-slate-900 hover:border-sky-300"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-800"><ContactGlyph icon={item.icon_key}/></span><span className="min-w-0 flex-1"><span className="block text-sm font-black">{item.platform_name}</span><span className="block truncate text-xs text-slate-500">Official MatMove profile</span></span><ArrowUpRight size={18} className="text-slate-500"/></a>;})}
     {!contactsLoading&&contacts.length===0?<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No social links have been published yet. You can still contact MatMove through the support inbox.</p>:null}
     <button type="button" onClick={()=>{setShowInbox(true);messageRequest.current++;setSelected(null);setMessages([]);setError('');setNotice('');}} className="flex min-h-12 w-full items-center justify-between rounded-xl bg-[#073b2f] px-4 text-sm font-bold text-white"><span className="flex items-center gap-2"><MessageCircle size={17}/> Message MatMove Support</span><ChevronRight size={18}/></button>
    </div>:<div className="space-y-3">
     <button type="button" onClick={()=>{setShowInbox(false);setSelected(null);setMessages([]);setError('');setNotice('');}} className="mb-1 flex min-h-10 items-center gap-2 text-sm font-bold text-emerald-800"><ArrowLeft size={16}/> Back to socials & contact options</button>
     {selected?<><button type="button" onClick={()=>{messageRequest.current++;setSelected(null);setMessages([]);setError('');}} className="mb-1 flex min-h-10 items-center gap-2 text-sm font-bold text-slate-700"><ArrowLeft size={16}/> All support requests</button><div className="space-y-3">{messages.map(m=><div key={m.id} className={m.sender_type==='customer'?'ml-8 rounded-2xl bg-emerald-50 p-3':'mr-8 rounded-2xl bg-slate-100 p-3'}><p className="mb-1 text-[10px] font-bold uppercase text-slate-500">{m.sender_type==='customer'?'You':'MatMove Support'} · {pretty(m.created_at)}</p><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p></div>)}</div><form onSubmit={sendReply} className="mt-4 flex gap-2"><textarea value={reply} onChange={e=>setReply(e.target.value)} maxLength={2000} rows={2} placeholder="Write a reply…" className="min-h-12 min-w-0 flex-1 rounded-xl border p-3 text-sm"/><button disabled={busy||!reply.trim()} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-bold text-white disabled:opacity-50"><Send size={16}/><span className="hidden sm:inline">Send</span></button></form></>:<><form onSubmit={openTicket} className="mb-5 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4"><h3 className="font-bold">Create a support request</h3><input value={subject} onChange={e=>{request.current=null;setSubject(e.target.value);}} minLength={3} maxLength={100} required placeholder="What do you need help with?" className="min-h-11 w-full rounded-xl border bg-white px-3 text-sm"/><select value={category} onChange={e=>{request.current=null;setCategory(e.target.value);}} className="min-h-11 w-full rounded-xl border bg-white px-3 text-sm">{categories.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><textarea value={body} onChange={e=>{request.current=null;setBody(e.target.value);}} maxLength={2000} required rows={3} placeholder="Describe the issue. Do not include your password, PIN or full card details." className="w-full rounded-xl border bg-white p-3 text-sm"/><button disabled={busy||subject.trim().length<3||!body.trim()} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?'Sending…':'Send to MatMove Support'}</button></form><div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Your support requests</h3><button type="button" onClick={()=>void loadTickets()} className="flex items-center gap-1 text-xs font-bold text-emerald-800"><RefreshCw size={14}/> Refresh</button></div>{tickets.length===0?<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No support requests yet.</p>:<div className="space-y-2">{tickets.map(t=><button key={t.id} type="button" onClick={()=>{setSelected(t.id);setError('');void loadMessages(t.id);}} className="w-full rounded-xl border p-3 text-left hover:border-emerald-300"><div className="flex items-center justify-between gap-2"><b className="text-sm">#{t.ticket_number} · {t.subject}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold">{statusLabel(t.status)}</span></div><p className="mt-1 line-clamp-2 text-xs text-slate-600">{t.last_message}</p>{Number(t.unread_count)>0&&<span className="mt-2 inline-block rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-800">{t.unread_count} new reply</span>}</button>)}</div>}</>}
    </div>}
   </div>
  </section></div>}
 </>;
}
