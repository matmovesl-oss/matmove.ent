import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,CircleHelp,MessageCircle,RefreshCw,Send,X} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {HELP_VERSION,HELP_ARTICLES,helpTopics,searchMatMoveHelp,type HelpContext} from '../../shared/matmove-help.js';

type SupportStatus='open'|'in_review'|'waiting_customer'|'resolved';
type Ticket={id:string;ticket_number:string;subject:string;category:string;status:SupportStatus;created_at:string;last_message_at:string;last_message:string;unread_count:number};
type SupportMessage={id:string;sender_type:'customer'|'admin';body:string;created_at:string;read_at:string|null};
const categories=[['account','Account & verification'],['wallet','Wallet & payments'],['ride','Rides & trips'],['delivery','Delivery & packages'],['merchant','Merchant & shopping'],['other','Other']];
const ticketRef=(value:string)=>'MM-'+String(value).padStart(6,'0');
const statusLabel=(value:string)=>value.replace(/_/g,' ');
const validTicket=(x:any):x is Ticket=>!!x&&typeof x.id==='string'&&typeof x.ticket_number==='string'&&typeof x.subject==='string'&&typeof x.category==='string'&&['open','in_review','waiting_customer','resolved'].includes(x.status)&&typeof x.last_message==='string';
const validMessage=(x:any):x is SupportMessage=>!!x&&typeof x.id==='string'&&['customer','admin'].includes(x.sender_type)&&typeof x.body==='string'&&typeof x.created_at==='string';
function requestKey(){if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();throw new Error('Secure support request IDs are unavailable in this browser.');}

export function customerHelpSection(destination:string,role:string):'home'|'ride'|'wallet'|'trips'|'shop'|'inventory'|'account' {
 const common:Record<string,'home'|'ride'|'wallet'|'trips'|'account'>={home:'home',wallet:'wallet',trips:'trips',account:'account',kyc:'account',games:'home'};
 if(!['rider','driver','merchant'].includes(role))throw new Error('This customer role is not supported.');
 if(common[destination])return common[destination];
 if(destination==='ride'&&role!=='driver'||destination==='radar'&&role==='driver')return 'ride';
 if(destination==='shop'&&role==='rider')return 'shop';
 if(destination==='business'&&role==='merchant')return 'inventory';
 throw new Error('This section is not available to your role.');
}

export default function MatMoveHelp({userId,context,onNavigate}:{userId:string;context:HelpContext;onNavigate:(destination:string)=>void}){
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[category,setCategory]=useState('other');
 const [reply,setReply]=useState<ReturnType<typeof searchMatMoveHelp>|null>(null),[error,setError]=useState('');
 const [tab,setTab]=useState<'guide'|'support'>('guide'),[tickets,setTickets]=useState<Ticket[]>([]);
 const [selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<SupportMessage[]>([]);
 const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[supportError,setSupportError]=useState(''),[supportNotice,setSupportNotice]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),identity=useRef(userId),latest=useRef(context),selectedRef=useRef<Ticket|null>(null),mounted=useRef(false),writeLock=useRef(false);
 identity.current=userId;latest.current=context;selectedRef.current=selected;
 const scope=JSON.stringify([userId,context.role,context.isActive,context.isOwner,context.permissions]);
 const [answerScope,setAnswerScope]=useState(scope);
 const topics=helpTopics(context),visibleReply=answerScope===scope?reply:null;
 const unread=tickets.reduce((n,t)=>n+(Number.isFinite(Number(t.unread_count))?Number(t.unread_count):0),0);

 const loadTickets=useCallback(async()=>{
  if(identity.current!==userId)return;
  const {data,error}=await supabase.rpc('matmove_support_customer_list');
  if(error)throw new Error(error.message||'Your support requests could not be loaded.');
  if(identity.current!==userId||data?.user_id!==userId||!Array.isArray(data.items)||!data.items.every(validTicket))throw new Error('Your support inbox could not be verified.');
  setTickets(data.items);
  const selectedNow=selectedRef.current;
  if(selectedNow){const fresh=data.items.find((x:Ticket)=>x.id===selectedNow.id);if(fresh)setSelected(fresh);else{setSelected(null);setMessages([]);}}
 },[userId]);

 const loadMessages=useCallback(async(id:string)=>{
  if(identity.current!==userId)return;
  const {data,error}=await supabase.rpc('matmove_support_customer_messages',{p_conversation_id:id});
  if(error)throw new Error(error.message||'This support conversation could not be loaded.');
  if(identity.current!==userId||data?.conversation?.id!==id||!Array.isArray(data.messages)||!data.messages.every(validMessage))throw new Error('This support conversation could not be verified.');
  setMessages(data.messages);
 },[userId]);

 useEffect(()=>{
  mounted.current=true;setTickets([]);setSelected(null);setMessages([]);setSupportError('');
  void loadTickets().catch(e=>{if(mounted.current)setSupportError(e instanceof Error?e.message:'Support inbox unavailable.');});
  const channel=supabase.channel('matmove-customer-support-'+userId)
   .on('postgres_changes',{event:'*',schema:'public',table:'matmove_support_conversations',filter:'customer_id=eq.'+userId},()=>{
    void loadTickets().catch(e=>{if(mounted.current)setSupportError(e instanceof Error?e.message:'Support inbox unavailable.');});
   })
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'matmove_support_messages'},()=>{
    void loadTickets().catch(()=>{});
    const active=selectedRef.current;if(active)void loadMessages(active.id).catch(()=>{});
   }).subscribe();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void loadTickets().catch(()=>{});},20000);
  return()=>{mounted.current=false;window.clearInterval(timer);void supabase.removeChannel(channel);};
 },[userId,loadTickets,loadMessages]);

 useEffect(()=>{const el=dialog.current;if(open&&el&&!el.open)el.showModal();if(!open&&el?.open)el.close();return()=>{if(el?.open)el.close();};},[open]);
 useEffect(()=>{setQuestion('');setReply(null);setError('');setAnswerScope(scope);},[scope]);

 async function ask(value:string){
  const clean=value.trim();if(!clean||writeLock.current)return;
  writeLock.current=true;setBusy(true);setError('');setSupportError('');
  const guidance=searchMatMoveHelp(clean,latest.current);setReply(guidance);setAnswerScope(scope);
  if(guidance.kind==='privacy'){writeLock.current=false;setBusy(false);return;}
  setSupportNotice('');
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_open',{p_request_key:requestKey(),p_subject:clean.slice(0,100),p_category:category,p_body:clean});
   if(error)throw new Error(error.message||'Your question could not be sent. Please try again.');
   const id=data?.conversation?.id;
   if(typeof id!=='string'||typeof data?.conversation?.ticket_number!=='string')throw new Error('The support ticket was not confirmed. Refresh your support inbox before retrying.');
   const next:Ticket={id,ticket_number:data.conversation.ticket_number,subject:data.conversation.subject||clean.slice(0,100),category:data.conversation.category||category,status:data.conversation.status||'open',created_at:new Date().toISOString(),last_message_at:new Date().toISOString(),last_message:clean,unread_count:0};
   setSelected(next);selectedRef.current=next;setQuestion('');setCategory('other');
   await Promise.all([loadTickets(),loadMessages(id)]);
   setSupportNotice('Your question has been sent to MatMove Support. Ticket '+ticketRef(next.ticket_number)+'. Open My support to continue the conversation.');
   setSupportError('');
  }catch(e){setSupportError(e instanceof Error?e.message:'Your question could not be sent.');}
  finally{writeLock.current=false;setBusy(false);}
 }

 async function sendReply(){
  const active=selectedRef.current,clean=draft.trim();
  if(!active||!clean||writeLock.current)return;
  writeLock.current=true;setBusy(true);setSupportError('');
  try{
   const {data,error}=await supabase.rpc('matmove_support_customer_message',{p_conversation_id:active.id,p_request_key:requestKey(),p_body:clean});
   if(error)throw new Error(error.message||'Your message could not be sent.');
   if(data?.conversation_id!==active.id||typeof data.id!=='string')throw new Error('Your message was not confirmed. Refresh the conversation before retrying.');
   setDraft('');await Promise.all([loadMessages(active.id),loadTickets()]);
  }catch(e){setSupportError(e instanceof Error?e.message:'Your message could not be sent.');}
  finally{writeLock.current=false;setBusy(false);}
 }

 async function chooseTicket(ticket:Ticket){
  setSelected(ticket);selectedRef.current=ticket;setMessages([]);setSupportError('');
  try{await loadMessages(ticket.id);await loadTickets();}
  catch(e){setSupportError(e instanceof Error?e.message:'Conversation unavailable.');}
 }
 const close=()=>{setOpen(false);setQuestion('');setReply(null);setError('');setSupportError('');setSupportNotice('')};
 function go(id:string){
  if(identity.current!==userId)return;
  const topic=helpTopics(latest.current).find(a=>a.id===id);
  if(!topic){setError('Your available sections changed. Choose a current topic.');return;}
  try{onNavigate(topic.action.destination);close();}
  catch{setError('This section could not be opened. Use the app navigation or try again.');}
 }
 return <>
  <button type="button" aria-label={unread?'Open MatMove Help, '+unread+' unread support replies':'Open MatMove Help'} onClick={()=>{setOpen(true);void loadTickets().catch(e=>setSupportError(e.message));}} className="relative flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-bold text-emerald-800"><CircleHelp size={18}/><span className="hidden sm:inline">Help</span>{unread>0&&<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[10px] font-black text-white">{unread>9?'9+':unread}</span>}</button>
  <dialog ref={dialog} aria-label="MatMove Help and Support" onCancel={e=>{e.preventDefault();close();}} className="m-auto max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-xl overflow-y-auto rounded-3xl border-0 bg-white p-4 text-slate-900 shadow-2xl backdrop:bg-slate-950/55 sm:p-5">
   <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">MatMove Help</h2><p className="mt-0.5 text-xs text-slate-500">Guidance and direct support from our team</p></div><button type="button" aria-label="Close MatMove Help" onClick={close} className="min-h-11 min-w-11 rounded-xl border p-2"><X size={20}/></button></div>
   <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
    <button type="button" onClick={()=>{setTab('guide');setSelected(null);}} aria-pressed={tab==='guide'} className={tab==='guide'?'min-h-10 rounded-lg bg-white text-sm font-bold text-emerald-800 shadow-sm':'min-h-10 rounded-lg text-sm font-bold text-slate-600'}>Help guide</button>
    <button type="button" onClick={()=>{setTab('support');setSelected(null);void loadTickets().catch(e=>setSupportError(e.message));}} aria-pressed={tab==='support'} className={tab==='support'?'flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white text-sm font-bold text-emerald-800 shadow-sm':'flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-bold text-slate-600'}>My support {unread>0&&<span className="rounded-full bg-rose-600 px-1.5 text-[10px] text-white">{unread>9?'9+':unread}</span>}</button>
   </div>
   {tab==='guide'?<>
    <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">Ask a question below and it will be sent to MatMove Support. Our team can reply in My support. Never include your password, passcode, one-time code or full card details.</p>
    <form className="mt-3 space-y-2" onSubmit={e=>{e.preventDefault();void ask(question);}}>
     <label className="block text-xs font-bold text-slate-700">What do you need help with?
      <select value={category} onChange={e=>setCategory(e.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal">{categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
     </label>
     <textarea aria-label="Ask MatMove Support" value={question} maxLength={2000} rows={3} disabled={busy} autoComplete="off" className="block min-h-24 w-full resize-y rounded-xl border p-3 text-base" placeholder="Write your question or explain the issue…" onChange={e=>setQuestion(e.target.value)}/>
     <button type="submit" disabled={busy||question.trim().length<1} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy?'Sending your question…':<><Send size={16}/> Send to MatMove Support</>}</button>
    </form>
    {supportNotice&&<div role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{supportNotice}<button type="button" onClick={()=>{setTab('support');setSelected(null);}} className="mt-2 block min-h-10 font-bold text-emerald-800 underline">View conversation</button></div>}
    {supportError&&<p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{supportError}</p>}
    {visibleReply&&<section aria-live="polite" className="mt-4"><p className="text-sm text-slate-600">{visibleReply.message}</p>{visibleReply.articles.map(a=><article key={a.id} className="mt-3 rounded-2xl border bg-slate-50 p-4"><h3 className="font-bold">{a.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{a.answer}</p><button type="button" onClick={()=>go(a.id)} className="mt-3 flex min-h-11 items-center gap-2 font-bold text-emerald-800">{a.action.label}<ArrowUpRight size={16}/></button></article>)}</section>}
    <h3 className="mt-5 text-sm font-bold">Browse help topics</h3><div className="mt-2 flex flex-wrap gap-2">{topics.map(t=><button type="button" key={t.id} onClick={()=>{if(identity.current!==userId||!helpTopics(latest.current).some(a=>a.id===t.id))return;const article=HELP_ARTICLES.find(a=>a.id===t.id);if(article){setReply({version:HELP_VERSION,kind:'answer',message:'Guidance only. Actions still use the app’s normal checks.',articles:[article]});setAnswerScope(scope);}}} className="min-h-10 rounded-xl border px-3 py-2 text-left text-xs font-semibold">{t.title}</button>)}</div>
    {error&&<p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <p className="mt-4 text-[11px] text-slate-500">Guide version {HELP_VERSION}. Help cannot approve KYC, change prices, move money or guarantee prizes.</p>
   </>:<>
    {supportError&&<p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{supportError} <button type="button" onClick={()=>void loadTickets().catch(e=>setSupportError(e.message))} className="ml-1 font-bold underline">Retry</button></p>}
    {!selected?<section className="mt-4">
     <div className="flex items-center justify-between gap-2"><h3 className="font-black">Your support requests</h3><button type="button" disabled={busy} onClick={()=>void loadTickets().catch(e=>setSupportError(e.message))} className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-emerald-800"><RefreshCw size={14}/> Refresh</button></div>
     {tickets.length===0?<p className="mt-3 rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">You have no support conversations yet. Send a question from the Help guide and MatMove Support will receive it.</p>:<div className="mt-3 space-y-2">{tickets.map(t=><button type="button" key={t.id} onClick={()=>void chooseTicket(t)} className="flex min-h-20 w-full items-center gap-3 rounded-2xl border p-3 text-left hover:border-emerald-300"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><MessageCircle size={19}/></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><b className="text-xs">{ticketRef(t.ticket_number)}</b><span className="text-[10px] capitalize text-slate-500">{statusLabel(t.status)}</span>{t.unread_count>0&&<span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">New reply</span>}</span><span className="mt-1 block truncate text-sm font-bold text-slate-900">{t.subject}</span><span className="mt-1 block truncate text-xs text-slate-500">{t.last_message}</span></span><ArrowUpRight size={16} className="shrink-0 text-slate-400"/></button>)}</div>}
    </section>:<section className="mt-4">
     <button type="button" onClick={()=>{setSelected(null);selectedRef.current=null;setMessages([]);}} className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-emerald-800"><ArrowLeft size={15}/> All requests</button>
     <div className="mt-2 rounded-2xl bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{ticketRef(selected.ticket_number)}</b><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold capitalize text-slate-600">{statusLabel(selected.status)}</span></div><p className="mt-1 font-bold text-slate-900">{selected.subject}</p><p className="mt-1 text-xs capitalize text-slate-500">{selected.category}</p></div>
     <div className="mt-3 max-h-[42dvh] space-y-3 overflow-y-auto rounded-2xl border bg-white p-3">
      {messages.length===0&&<p className="py-5 text-center text-xs text-slate-500">No messages loaded yet.</p>}
      {messages.map(m=><div key={m.id} className={m.sender_type==='customer'?'flex justify-end':'flex justify-start'}><article className={m.sender_type==='customer'?'max-w-[88%] rounded-2xl bg-emerald-700 px-3 py-2.5 text-white':'max-w-[88%] rounded-2xl bg-slate-100 px-3 py-2.5 text-slate-900'}><p className={m.sender_type==='customer'?'mb-1 text-[10px] font-bold text-emerald-100':'mb-1 text-[10px] font-bold text-emerald-800'}>{m.sender_type==='customer'?'You':'MatMove Support'}</p><p className="whitespace-pre-wrap break-words text-sm leading-5">{m.body}</p><p className={m.sender_type==='customer'?'mt-1 text-right text-[9px] text-emerald-100':'mt-1 text-right text-[9px] text-slate-400'}>{new Date(m.created_at).toLocaleString()}</p></article></div>)}
     </div>
     {selected.status==='resolved'&&<p className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">This request is marked resolved. Send a new message to reopen it with MatMove Support.</p>}
     <form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();void sendReply();}}><textarea aria-label="Reply to MatMove Support" rows={2} maxLength={2000} value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} placeholder="Write a reply…" className="min-h-12 min-w-0 flex-1 resize-y rounded-xl border p-3 text-sm"/><button type="submit" aria-label="Send reply" disabled={busy||!draft.trim()} className="min-h-12 min-w-12 self-end rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-50"><Send size={18}/></button></form>
    </section>}
   </>}
  </dialog>
 </>;
}
