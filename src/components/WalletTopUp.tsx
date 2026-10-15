
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { walletFetch } from '@/lib/apiFetch';

type Quote={netMode:boolean;requestedMinor:number;walletCreditMinor:number|null;feeMinor:number|null;totalMinor:number;version:string};
type PaymentCode={id:string;ussdCode:string;amount:{currency:string;value:number};expireTime:string;status:string;confirmed:boolean;quote?:Quote|null};
type Saved={amount:string;intentId?:string;quote?:Quote;code?:PaymentCode};
const money=(value:number)=>`SLE ${(value/100).toFixed(2)}`;
const terminal=(c:PaymentCode)=>c.confirmed||['expired','cancelled'].includes(c.status);
function requestBody(s:Saved):Record<string,unknown> {
  return {amount:s.amount,currency:'SLE',...(s.intentId?{topupRequestId:s.intentId}:{}),...(s.quote?.netMode?{acceptedTotalMinor:s.quote.totalMinor,quoteVersion:s.quote.version}:{})};
}
export function WalletTopUp({userId,allowed,onClose,onPaid}:{userId:string;allowed:boolean;onClose:()=>void;onPaid:()=>void|Promise<void>}) {
  const storage=`matmove-topup:${userId}`;
  const initial=useRef<Saved|null>(null),initialized=useRef(false);
  if(!initialized.current){initialized.current=true;try{const value=JSON.parse(sessionStorage.getItem(storage)||'null');if(value&&typeof value.amount==='string')initial.current=value;}catch{/* No usable draft. */}}
  const intent=useRef<Saved|null>(initial.current);
  const [amount,setAmount]=useState(initial.current?.amount||'');
  const [code,setCode]=useState<PaymentCode|null>(initial.current?.code||null);
  const [quote,setQuote]=useState<Quote|null>(initial.current?.quote||null);
  const [uncertain,setUncertain]=useState(!!initial.current&&!initial.current.code);
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(!!initial.current?.code),[verified,setVerified]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(true),inFlight=useRef(false),notified=useRef(''),paidCallback=useRef(onPaid);paidCallback.current=onPaid;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const persist=useCallback((s:Saved)=>{intent.current=s;try{sessionStorage.setItem(storage,JSON.stringify(s));}catch{throw new Error('Allow browser session storage before starting a top-up so an interrupted request can be recovered.');}},[storage]);
  const clear=useCallback(()=>{
    const old=intent.current;
    try{sessionStorage.removeItem(storage);if(old)sessionStorage.removeItem(`matmove-request:${JSON.stringify({user:userId,url:'/api/create-wallet-payment-code',body:requestBody(old)})}`);}catch{/* Finished requests remain confirmed by the provider. */}
    intent.current=null;
  },[storage,userId]);
  const finishCode=useCallback(async(next:PaymentCode)=>{
    clear();
    if(mounted.current){setCode(null);setAmount('');setQuote(null);setUncertain(false);setVerified(false);setError('');setNotice(next.confirmed?'Payment completed. You can start a fresh top-up.':'The previous payment code is closed. You can start a fresh top-up.');}
    if(next.confirmed&&notified.current!==next.id){notified.current=next.id;try{await paidCallback.current();}catch{if(mounted.current)setError('Payment completed, but the wallet balance could not refresh. Refresh your wallet.');}}
  },[clear]);
  const refresh=useCallback(async()=>{
    const old=intent.current;
    if(!old?.code||inFlight.current)return;
    inFlight.current=true;if(mounted.current)setChecking(true);
    try{
      const {response,data,finish}=await walletFetch('/api/create-wallet-payment-code',{operation:'status',paymentCodeId:old.code.id});finish();
      if(!response.ok||!data.paymentCode)throw new Error(data.error||'Unable to verify the previous payment.');
      const next:PaymentCode=data.paymentCode;
      if(terminal(next)){await finishCode(next);return;}
      persist({...old,code:next});
      if(mounted.current){setCode(next);setVerified(true);setError('');}
    }catch(e){if(mounted.current){setVerified(false);setError(e instanceof Error?e.message:'Status unavailable. Check again before another payment.');}}
    finally{inFlight.current=false;if(mounted.current)setChecking(false);}
  },[finishCode,persist]);
  useEffect(()=>{if(initial.current?.code)void refresh();},[refresh]);
  useEffect(()=>{if(!code)return;const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},6000);return()=>window.clearInterval(timer);},[code?.id,refresh]);
  async function review(){
    if(inFlight.current||!allowed)return;
    if(!/^\d+(\.\d{1,2})?$/.test(amount)||Number(amount)<=0){setError('Enter a positive SLE amount with at most two decimal places.');return;}
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{const {response,data,finish}=await walletFetch('/api/create-wallet-payment-code',{operation:'quote',amount,currency:'SLE'});finish();if(!response.ok||!data.quote)throw new Error(data.error||'Top-up quote unavailable.');if(mounted.current)setQuote(data.quote);}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Quote unavailable.');}finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  async function create(){
    if(inFlight.current||!allowed)return;
    const existing=intent.current;
    if(!existing&&!quote)return;
    inFlight.current=true;setBusy(true);setError('');
    try{
      const next=existing||{amount,intentId:crypto.randomUUID(),quote:quote!};
      persist(next);setUncertain(true);
      const {response,data}=await walletFetch('/api/create-wallet-payment-code',requestBody(next));
      // Do not discard the intent on an error: the provider may already have accepted it.
      if(!response.ok||!data.paymentCode)throw new Error(data.error||'Unable to generate payment code.');
      const result:PaymentCode=data.paymentCode;
      if(terminal(result)){await finishCode(result);return;}
      persist({...next,code:result});
      if(mounted.current){setCode(result);setUncertain(false);setVerified(true);}
    }catch(e){if(mounted.current)setError((e instanceof Error?e.message:'Request interrupted.')+' Retry this same request to recover it; do not start a second payment.');}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  const canDial=code&&verified&&code.status==='pending'&&Date.parse(code.expireTime)>Date.now();
  return <section className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 p-4 sm:p-8" aria-label="MatMove wallet top-up"><div className="mx-auto max-w-lg space-y-5 rounded-3xl bg-white p-6 shadow-lg">
    <div className="flex items-center justify-between"><h2 className="text-2xl font-bold">Load your wallet</h2><button type="button" onClick={onClose} aria-label="Close top-up" className="rounded-xl p-2"><X size={22}/></button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}{notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {!code?<>
      <label className="block font-bold">{quote?.netMode?'Amount to receive (SLE)':'Amount (SLE)'}<input inputMode="decimal" value={amount} disabled={busy||uncertain} onChange={e=>{setAmount(e.target.value);setQuote(null);setError('');}} className="mt-2 w-full rounded-xl border p-4 text-xl"/></label>
      {!allowed&&<p className="text-red-700">Wallet payments require an approved, unfrozen account.</p>}
      {quote&&!uncertain&&<div className="space-y-2 rounded-xl bg-blue-50 p-4">
        {quote.netMode?<><p>Wallet credit: <b>{money(quote.walletCreditMinor!)}</b></p><p>Monime processing fee: <b>{money(quote.feeMinor!)}</b></p><p>Mobile-money payment: <b>{money(quote.totalMinor)}</b></p><p className="text-sm">The processing fee is included in the mobile-money payment, above your wallet credit. Your mobile-money operator may separately display its own charges.</p></>:<><p>Mobile-money payment: <b>{money(quote.totalMinor)}</b></p><p className="text-sm">Monime processing fees are currently deducted from this amount. Your wallet receives the net amount. Exact-credit top-ups are awaiting confirmed fee settings.</p></>}
      </div>}
      <button type="button" disabled={busy||!allowed||!amount} onClick={()=>void (uncertain||quote?create():review())} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 p-4 font-bold text-white disabled:opacity-50">{busy&&<Loader2 size={20} className="animate-spin"/>}{uncertain?'Recover same payment request':quote?`Generate code — ${money(quote.totalMinor)}`:'Review top-up'}</button>
    </>:<>
      <p className="font-bold">Mobile-money payment: {money(code.amount.value)}</p>
      {code.quote?.netMode&&<p>Expected wallet credit: {money(code.quote.walletCreditMinor!)} · Processing fee: {money(code.quote.feeMinor!)}</p>}
      {canDial?<><p>Dial this fresh payment code using Orange Money or Afrimoney.</p><p className="break-all rounded-xl bg-slate-100 p-5 text-center font-mono text-3xl font-bold">{code.ussdCode}</p><div className="flex gap-3"><button type="button" onClick={()=>void navigator.clipboard.writeText(code.ussdCode).then(()=>setNotice('Code copied.'),()=>setNotice('Select and copy the code.'))} className="flex-1 rounded-xl border p-3 font-bold">Copy code</button><a href={`tel:${encodeURIComponent(code.ussdCode)}`} className="flex-1 rounded-xl bg-blue-600 p-3 text-center font-bold text-white">Open dialler</a></div></>:<p role="status">{checking?'Verifying your previous payment…':code.status==='processing'?'Payment processing. Checking automatically…':'Check the payment status before using a code or starting another payment.'}</p>}
      <p className="text-sm">Status: {code.status} · Expires {new Date(code.expireTime).toLocaleString()}</p>
      <button type="button" disabled={checking||busy} onClick={()=>void refresh()} className="w-full rounded-xl border p-3 font-bold disabled:opacity-50">{checking?'Checking…':'Check payment status'}</button>
      <p className="text-sm text-slate-500">Closing this screen keeps a pending payment for recovery. Once Monime confirms completion, the next top-up uses a new request and payment code.</p>
    </>}
  </div></section>;
}
