
import {useEffect,useRef,useState} from 'react';
import {CircleHelp,X,ArrowUpRight} from 'lucide-react';
import {HELP_VERSION,HELP_ARTICLES,helpTopics,searchMatMoveHelp,type HelpContext} from '../../shared/matmove-help.js';

// Navigation only. This component never fetches account data or submits a payment.
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
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[reply,setReply]=useState<ReturnType<typeof searchMatMoveHelp>|null>(null),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),identity=useRef(userId),latest=useRef(context);identity.current=userId;latest.current=context;
 const scope=JSON.stringify([userId,context.role,context.isActive,context.isOwner,context.permissions]);
 const [answerScope,setAnswerScope]=useState(scope);
 const topics=helpTopics(context),visibleReply=answerScope===scope?reply:null;
 useEffect(()=>{setQuestion('');setReply(null);setError('');setAnswerScope(scope);setOpen(false);},[scope]);
 useEffect(()=>{const el=dialog.current;if(open&&el&&!el.open)el.showModal();if(!open&&el?.open)el.close();return()=>{if(el?.open)el.close();};},[open]);
 function ask(value:string){if(identity.current!==userId)return;setReply(searchMatMoveHelp(value,latest.current));setAnswerScope(scope);setError('');}
 function go(id:string){
  if(identity.current!==userId)return;
  const topic=helpTopics(latest.current).find(a=>a.id===id);if(!topic){setError('Your available sections changed. Choose a current topic.');return;}
  try{onNavigate(topic.action.destination);setOpen(false);setQuestion('');setReply(null);}catch{setError('This section could not be opened. Use the app navigation or try again.');}
 }
 return <><button type="button" aria-label="Open MatMove Help" onClick={()=>setOpen(true)} className="flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-bold text-emerald-800"><CircleHelp size={18}/><span className="hidden sm:inline">Help</span></button>
 <dialog ref={dialog} aria-label="MatMove Help" onCancel={e=>{e.preventDefault();setOpen(false);setQuestion('');setReply(null);}} className="m-auto max-h-[88dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-3xl border-0 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/55">
  <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">MatMove Help</h2><button type="button" aria-label="Close MatMove Help" onClick={()=>{setOpen(false);setQuestion('');setReply(null);}} className="min-h-11 min-w-11 rounded-xl border p-2"><X size={20}/></button></div>
  <p className="mt-2 text-sm text-slate-600">Your built-in app guide. Answers use our written help pages, not a live account check.</p>
  <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-950">Ask how to use a feature. Keep passcodes, passwords, card details and private documents out of Help. Questions stay in this panel and are cleared when you close it.</p>
  <form className="mt-4 flex gap-2" onSubmit={e=>{e.preventDefault();ask(question);}}><input aria-label="Ask about a MatMove feature" value={question} maxLength={500} autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-xl border p-3 text-base" placeholder="How do I complete KYC?" onChange={e=>setQuestion(e.target.value)}/><button type="submit" className="rounded-xl bg-emerald-700 px-4 font-bold text-white">Ask</button></form>
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  {visibleReply&&<section aria-live="polite" className="mt-4"><p className="text-sm text-slate-600">{visibleReply.message}</p>{visibleReply.articles.map(a=><article key={a.id} className="mt-3 rounded-2xl border bg-slate-50 p-4"><h3 className="font-bold">{a.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{a.answer}</p><button type="button" onClick={()=>go(a.id)} className="mt-3 flex min-h-11 items-center gap-2 font-bold text-emerald-800">{a.action.label}<ArrowUpRight size={16}/></button></article>)}</section>}
  <h3 className="mt-5 text-sm font-bold">Browse your topics</h3><div className="mt-2 flex flex-wrap gap-2">{topics.map(t=><button type="button" key={t.id} onClick={()=>{if(identity.current!==userId||!helpTopics(latest.current).some(a=>a.id===t.id))return;const article=HELP_ARTICLES.find(a=>a.id===t.id);if(article){setReply({version:HELP_VERSION,kind:'answer',message:'Guidance only. Actions still use the app’s normal checks.',articles:[article]});setAnswerScope(scope);}}} className="min-h-11 rounded-xl border px-3 py-2 text-left text-xs font-semibold">{t.title}</button>)}</div>
  <p className="mt-5 text-xs text-slate-500">Guide version {HELP_VERSION}. Help cannot approve KYC, change prices, move money or guarantee prizes.</p>
 </dialog></>;
}
