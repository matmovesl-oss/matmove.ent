import {useEffect,useRef,useState} from 'react';
import {claimCustomerGuide} from '@/services/customerGuide';
import {ArrowLeft,ArrowRight,CheckCircle2,Compass,ShieldCheck,X} from 'lucide-react';

type Role='rider'|'driver'|'merchant';
type Section='home'|'ride'|'wallet'|'trips'|'shop'|'inventory'|'account';
type Step={id:string;section:Section;title:string;description:string;hint:string};
const seenThisVisit=new Set<string>();
export function portalGuideSteps(role:Role,verified:boolean):Step[]{
 const intro:Step={id:'home',section:'home',title:'Welcome to your MatMove Home',description:'Your Home brings together your wallet overview, shortcuts, games and recent trips. Balances stay hidden until you tap the eye.',hint:'You can skip this tour and replay it from the Quick guide button at the top.'};
 const ride:Step=role==='driver'?{id:'ride',section:'ride',title:'Your Driver Radar',description:'Go online to see requests available to your account. Review the route, fare and any agreed price before accepting. Follow the trip status until completion.',hint:'Going online or opening this guide does not accept a request.'}:{id:'ride',section:'ride',title:role==='merchant'?'Request a ride or delivery':'Book rides and deliveries',description:'Start typing pickup and destination, select a suggested place, check the map pins and preview the route. Then choose your service, vehicle and fare. Use Schedule when you need a later trip.',hint:'The tutorial never creates a booking or confirms a payment for you.'};
 const commerce:Step[]=role==='merchant'?[{id:'business',section:'inventory',title:'Your Business',description:'Manage your catalog and track orders from Business. Check each product and its price before listing it for buyers.',hint:'Your products and orders belong to your merchant account.'}]:role==='rider'?[{id:'shop',section:'shop',title:'Shop with merchants',description:'Browse products and review the merchant and checkout details before buying. You can also use a product’s WhatsApp option where provided.',hint:'Opening Shop or this tour does not place an order.'}]:[];
 return[intro,ride,...commerce,
  {id:'wallet',section:'wallet',title:'Your Wallet',description:'Switch between SLE and USD and use the eye icon to reveal a balance. Load through Mobile Money. Review the amount, recipient and any fees before confirming a wallet action.',hint:role==='driver'||role==='merchant'?'Wallet operations require the relevant identity verification and Admin approval. A frozen wallet cannot move funds.':'If you skipped KYC, complete verification before using restricted wallet actions. A frozen wallet cannot move funds.'},
  {id:'trips',section:'trips',title:'Your Trips',description:'Find your ride and delivery history, open trip details and use the available sharing controls.',hint:'The status on each trip tells you where it is in the process.'},
  {id:'account',section:'account',title:'Your Account is at the top',description:'Tap Account in the top bar to find your profile, identity verification, security, games and other account tools. Account no longer takes a slot in the bottom navigation.',hint:'Use the bottom bar for your main activities and the top bar for your account.'},
  ...(verified?[]:[{id:'kyc',section:'account' as Section,title:'Complete your identity verification',description:'Your registered account is kept when you skip KYC. Open Account and select Continue verification, or use the button below to resume your onboarding.',hint:role==='rider'?'Complete the required identity details and uploads. Your dashboard stays accessible while you finish.':'Complete your identity and business or driver details. Admin reviews your submission; check your account for approval or a rejection reason.'}]),
 ];
}
export default function PortalGuide({userId,role,verified,replay,onNavigate,onVerify}:{userId:string;role:Role;verified:boolean;replay:number;onNavigate:(section:Section)=>void;onVerify:()=>void}){
 const key=`matmove-guide:v1:${userId}:${role}`;
 const [open,setOpen]=useState(false),[index,setIndex]=useState(0),[storageNotice,setStorageNotice]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),currentKey=useRef(key);currentKey.current=key;
 const navigateRef=useRef(onNavigate);navigateRef.current=onNavigate;
 const steps=portalGuideSteps(role,verified),step=steps[Math.min(index,steps.length-1)];
 useEffect(()=>{
  let active=true,seen=seenThisVisit.has(key);setIndex(0);setOpen(replay>0);
  try{seen=seen||['completed','dismissed','opened'].includes(localStorage.getItem(key)||'');}catch{setStorageNotice('Tour preferences are saved to your account. You can skip or reopen Quick guide.');}
  void claimCustomerGuide(userId,seen||replay>0).then(first=>{
   if(!active)return;
   seenThisVisit.add(key);try{if(!seen)localStorage.setItem(key,'opened');}catch{}
   if(replay===0)setOpen(first);
  }).catch(()=>{if(active)setStorageNotice('Automatic guide unavailable. Use Quick guide whenever you need it.');});
  return()=>{active=false;};
 },[key,replay,userId]);
 useEffect(()=>{
  const element=dialog.current;
  if(open&&element&&!element.open)element.showModal();
  if(!open&&element?.open)element.close();
  return()=>{if(element?.open)element.close();};
 },[open]);
 useEffect(()=>{if(open)navigateRef.current(step.section);},[open,step.section]);
 function finish(state:'completed'|'dismissed'){
  if(currentKey.current!==key)return;
  seenThisVisit.add(key);try{localStorage.setItem(key,state);}catch{}
  setOpen(false);
 }
 function move(next:number){setIndex(Math.max(0,Math.min(steps.length-1,next)));}
 return <dialog ref={dialog} aria-labelledby="mm-guide-title" aria-describedby="mm-guide-description" onCancel={e=>{e.preventDefault();finish('dismissed');}} className="m-auto max-h-[88dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-3xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-950/55">
  <div className="p-5 sm:p-6"><div className="mb-5 flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700"><Compass size={18}/>MatMove Quick guide</span><button type="button" aria-label="Skip app guide" onClick={()=>finish('dismissed')} className="min-h-11 min-w-11 rounded-xl border p-2 text-slate-600"><X size={18}/></button></div>
   <p className="text-xs font-semibold text-slate-500">{role==='driver'?'Driver':role==='merchant'?'Merchant':'Rider'} guide · {Math.min(index+1,steps.length)} of {steps.length}</p>
   <h2 id="mm-guide-title" tabIndex={-1} className="mt-2 text-2xl font-black text-slate-950">{step.title}</h2>
   <p id="mm-guide-description" className="mt-4 text-sm leading-relaxed text-slate-700">{step.description}</p>
   <p className="mt-4 flex items-start gap-2 rounded-2xl bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-900"><ShieldCheck size={18} className="mt-0.5 shrink-0"/>{step.hint}</p>
   {storageNotice&&<p role="status" className="mt-3 text-xs text-slate-600">{storageNotice}</p>}
   {step.id==='kyc'&&!verified&&<button type="button" onClick={()=>{try{onVerify();finish('dismissed');}catch{setStorageNotice('Verification could not be opened. Enable browser storage, then try again from Account.');}}} className="mt-4 min-h-11 w-full rounded-xl border border-emerald-700 px-4 py-3 font-bold text-emerald-800">Continue my KYC</button>}
   <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={()=>finish('dismissed')} className="min-h-11 text-sm font-bold text-slate-600 underline">Skip tour · Start using</button><div className="flex gap-2">{index>0&&<button type="button" onClick={()=>move(index-1)} className="flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-bold"><ArrowLeft size={16}/>Back</button>}{index<steps.length-1?<button type="button" onClick={()=>move(index+1)} className="flex min-h-11 items-center gap-1 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white">Next<ArrowRight size={16}/></button>:<button type="button" onClick={()=>{finish('completed');navigateRef.current('home');}} className="flex min-h-11 items-center gap-1 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white"><CheckCircle2 size={16}/>Start using</button>}</div></div>
  </div>
 </dialog>;
}
