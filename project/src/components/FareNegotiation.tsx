
import {useCallback,useEffect,useRef,useState} from 'react';
import {Loader2,RefreshCw,MessageSquare} from 'lucide-react';
import {readRideFares,proposeRideFare,decideRideFare,fareMinor,offerRequestKey,type FareSnapshot,type FareOffer} from '@/services/fareNegotiationService';

type Props={userId:string;bookingId:string;role:'rider'|'merchant'|'driver';onFareChange?:(snapshot:FareSnapshot)=>void;onAccepted?:()=>void};
const money=(minor:number)=>`SLE ${(minor/100).toFixed(2)}`;
export default function FareNegotiation({userId,bookingId,role,onFareChange,onAccepted}:Props){
 const [storedSnapshot,setSnapshot]=useState<FareSnapshot|null>(null);
 const snapshot=storedSnapshot?.viewerId===userId&&storedSnapshot.bookingId===bookingId?storedSnapshot:null;
 const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [amount,setAmount]=useState(''),[confirm,setConfirm]=useState<FareOffer|null>(null);
 const [now,setNow]=useState(Date.now());
 const offset=useRef(0),mounted=useRef(false),mutex=useRef(false);
 const pendingRead=useRef<Promise<void>|null>(null),readEpoch=useRef(0);
 const identity=useRef({userId,bookingId});identity.current={userId,bookingId};
 const currentIdentity=()=>mounted.current&&identity.current.userId===userId&&identity.current.bookingId===bookingId;
 const proposal=useRef<{key:string;minor:number;version:number}|null>(null);
 const callbacks=useRef({onFareChange,onAccepted});callbacks.current={onFareChange,onAccepted};
 const refresh=useCallback(()=>{
  if(pendingRead.current)return pendingRead.current;
  const epoch=++readEpoch.current;
  if(currentIdentity())setRefreshing(true);
  const task=(async()=>{
   try{
    const data=await readRideFares(userId,bookingId);
    if(currentIdentity()&&epoch===readEpoch.current){offset.current=Date.parse(data.serverTime)-Date.now();setSnapshot(data);setError('');callbacks.current.onFareChange?.(data);}
   }catch(e:any){if(currentIdentity()&&epoch===readEpoch.current)setError(e.message||'Could not load fare offers.');}
   finally{if(currentIdentity()&&epoch===readEpoch.current){setLoading(false);setRefreshing(false);}}
  })();
  pendingRead.current=task;
  void task.finally(()=>{if(pendingRead.current===task)pendingRead.current=null;});
  return task;
 },[userId,bookingId]);
 async function refreshAfterWrite(){
  if(pendingRead.current)await pendingRead.current;
  if(currentIdentity())await refresh();
 }
 useEffect(()=>{
  mounted.current=true;let disposed=false;
  setLoading(true);setConfirm(null);setNotice('');setError('');
  void(async()=>{if(pendingRead.current)await pendingRead.current;if(!disposed)await refreshAfterWrite();})();
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible'&&!mutex.current)void refresh();},5000);
  const clock=window.setInterval(()=>{if(document.visibilityState==='visible')setNow(Date.now());},1000);
  return()=>{disposed=true;mounted.current=false;readEpoch.current++;window.clearInterval(timer);window.clearInterval(clock);};
 },[refresh]);
 const ownPending=snapshot?.offers.find(o=>o.driverId===userId&&o.status==='pending');
 const locked=!!snapshot&&(snapshot.paymentStarted||!['pending','pending_admin'].includes(snapshot.bookingStatus));
 const canPropose=role==='driver'&&!locked&&!snapshot?.selectedDriverId;
 const remaining=(offer:FareOffer)=>Math.max(0,Math.ceil((Date.parse(offer.expiresAt)-now-offset.current)/1000));
 const current=(offer:FareOffer)=>offer.status==='pending'&&remaining(offer)>0&&offer.fareVersion===snapshot?.fareVersion;
 async function sendProposal(e:React.FormEvent){
  e.preventDefault();if(mutex.current||!snapshot||!canPropose)return;
  let minor:number;try{minor=fareMinor(amount);}catch(e:any){setError(e.message);return;}
  const draft=proposal.current?.minor===minor&&proposal.current.version===snapshot.fareVersion?proposal.current:{key:offerRequestKey(),minor,version:snapshot.fareVersion};proposal.current=draft;
  mutex.current=true;readEpoch.current++;setBusy(true);setError('');setNotice('');
  try{
   await proposeRideFare(userId,bookingId,draft.key,minor,draft.version);
   if(currentIdentity()){proposal.current=null;setNotice('Offer sent. Wait for customer confirmation before accepting this request.');await refreshAfterWrite();}
  }catch(e:any){if(currentIdentity())setError(e.message||'Could not confirm the offer. Refresh before retrying.');}
  finally{mutex.current=false;if(currentIdentity())setBusy(false);}
 }
 async function decide(offer:FareOffer,decision:'accept'|'decline'|'withdraw'){
  if(mutex.current||!snapshot||locked||!current(offer))return;
  mutex.current=true;readEpoch.current++;setBusy(true);setError('');setNotice('');
  try{
   await decideRideFare(userId,offer.id,decision,snapshot.fareVersion);
   if(currentIdentity()){setConfirm(null);setNotice(decision==='accept'?'Fare agreed. The selected driver must accept; payment has not been taken by this confirmation.':decision==='decline'?'Offer declined.':'Offer withdrawn. You may accept the current request fare.');await refreshAfterWrite();if(currentIdentity()&&decision==='accept')callbacks.current.onAccepted?.();}
  }catch(e:any){if(currentIdentity())setError(e.message||'Could not confirm this action. Refresh the offers.');}
  finally{mutex.current=false;if(currentIdentity())setBusy(false);}
 }
 return <section aria-label="Fare negotiation" className="my-3 space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-3 text-sm">
  <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-bold"><MessageSquare size={17}/> Fare negotiation</h3><button type="button" aria-label="Refresh fare offers" disabled={refreshing||busy} onClick={()=>void refresh()} className="min-h-10 rounded-lg border bg-white p-2 disabled:opacity-50"><RefreshCw size={16} className={refreshing?'animate-spin':''}/></button></div>
  {loading&&!snapshot?<p role="status" className="flex items-center gap-2 text-slate-600"><Loader2 size={16} className="animate-spin"/> Loading fare offers…</p>:null}
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
  {snapshot&&<>
   <p>Current request fare: <b>{money(snapshot.fareMinor)}</b></p>
   {locked?<p className="text-slate-600">Fare changes are closed because acceptance, payment, or cancellation has started.</p>:<>
    {snapshot.selectedDriverId?<p className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{role==='driver'?snapshot.selectedDriverId===userId?'You are the selected driver at the displayed fare. You can now accept the request.':'Another driver is selected for this request.':'A driver is selected at the displayed fare. Waiting for that driver to accept.'} Cancel the trip if you need to start a different request.</p>:role==='driver'?<form onSubmit={e=>void sendProposal(e)} className="space-y-2"><label className="block text-xs font-bold">Propose your total fare (SLE)<input aria-label="Proposed total fare" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);setError('');}} inputMode="decimal" maxLength={12} placeholder={(snapshot.fareMinor/100).toFixed(2)} className="mt-1 w-full rounded-xl border bg-white p-3 text-base font-normal"/></label><button type="submit" disabled={busy||!amount.trim()||!!error} className="min-h-11 w-full rounded-xl bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">{busy?'Sending…':ownPending?'Replace my offer':'Send fare offer'}</button><p className="text-xs text-slate-600">The customer must confirm a changed fare. Sending an offer does not accept the trip or move money.</p></form>:<p className="text-xs text-slate-600">Drivers can propose a different total. You choose whether to accept. The existing platform fee remains included in the agreed total.</p>}
    {!snapshot.offers.length&&!snapshot.selectedDriverId&&role!=='driver'&&<p className="text-slate-600">No driver offers yet. You can keep waiting at your current fare.</p>}
    {snapshot.offers.map(offer=><article key={offer.id} className="space-y-2 rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-2"><span className="font-bold">{role==='driver'?'Your offer':offer.driverName}</span><b>{money(offer.amountMinor)}</b></div><p className="text-xs capitalize text-slate-600">{current(offer)?`Awaiting response · ${Math.ceil(remaining(offer)/60)} min remaining`:offer.status==='pending'?'Expired':offer.status}</p>{current(offer)&&!snapshot.selectedDriverId&&<div className="flex flex-wrap gap-2">{role==='driver'?<button type="button" disabled={busy} onClick={()=>void decide(offer,'withdraw')} className="min-h-11 rounded-lg border px-3 font-bold disabled:opacity-50">Withdraw offer</button>:<><button type="button" disabled={busy} onClick={()=>setConfirm(offer)} className="min-h-11 rounded-lg bg-emerald-700 px-3 font-bold text-white disabled:opacity-50">Review {money(offer.amountMinor)}</button><button type="button" disabled={busy} onClick={()=>void decide(offer,'decline')} className="min-h-11 rounded-lg border px-3 font-bold disabled:opacity-50">Decline offer</button></>}</div>}</article>)}
    {confirm&&current(confirm)&&!snapshot.selectedDriverId&&<div role="group" aria-label="Confirm agreed fare" className="space-y-3 rounded-xl border-2 border-emerald-600 bg-white p-3"><p>Agree to <b>{money(confirm.amountMinor)}</b> with <b>{confirm.driverName}</b>?</p><p className="text-xs text-slate-600">This becomes the full trip fare. The wallet-to-escrow payment starts when this driver accepts through MatMove.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void decide(confirm,'accept')} className="min-h-11 rounded-lg bg-emerald-700 px-3 font-bold text-white disabled:opacity-50">{busy?'Confirming…':`Confirm ${money(confirm.amountMinor)}`}</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)} className="min-h-11 rounded-lg border px-3 font-bold">Keep waiting</button></div></div>}
   </>}
  </>}
 </section>;
}
