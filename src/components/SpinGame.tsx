


import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { spinOdds, spinSectorCenter, validateSpinSectors, type SpinSector } from '../../shared/spin-rules.js';

import { SIX_MODE, sixLabel, type SixSector } from '../../shared/six-spin-rules.js';
type DisplaySector=SpinSector & {kind?:'cash'|'again'|'lose'};
const center=(sectors:DisplaySector[],index:number)=>sectors[0]?.kind?(index+0.5)*60:spinSectorCenter(sectors,index);
const label=(s:DisplaySector)=>s.kind?sixLabel(s as SixSector):money(s.prizeMinor);

type Receipt = {kind?:string;index:number;sectorIndex:number|null;digit:string|null;amountMinor:number;providerId:string|null;status:string;error:string|null};
type Round = {id:string;mode?:string;spinCount:number;state:string;sectors:DisplaySector[];entryMinor:number;luckyDigit:string;spinsUsed:number;paidMinor:number;receipts:Receipt[];error:string|null};
type Config = {id:number;mode?:string;enabled:boolean;tiers:Array<{entryMinor:number;sectors:DisplaySector[]}>};
type Draft = {requestKey:string;configId:number;luckyDigit:string;acceptedEntryMinor:number;tierMinor?:number;acceptRules:true};
const money = (minor:number) => `SLE ${(minor/100).toFixed(2)}`;
const color=(prize:number)=>prize===5000?'#f59e0b':`hsl(${(prize/100*39)%360} 65% 35%)`;
async function gameRequest(body:Record<string,unknown>) {
  const {data:{session}}=await supabase.auth.getSession();
  if (!session) throw new Error('Sign in again to use Games.');
  const response=await fetch('/api/get-live-wallet',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if (!response.ok||!data) throw new Error(data?.error||'Game unavailable. Check status before another payment.');
  return data;
}
function Wheel({sectors,rotation,canSpin,onSpin,buttonLabel}:{sectors:DisplaySector[];rotation:number;canSpin:boolean;onSpin:()=>void;buttonLabel:string}) {
  const clean=sectors[0]?.kind?sectors.map(s=>({...s,weight:1})):validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  let cursor=0;
  const gradient=clean.map(s=>{const start=cursor;cursor+=s.weight/total*360;return `${color(s.prizeMinor)} ${start}deg ${cursor}deg`;}).join(',');
  return <div className="relative mx-auto my-8 w-full max-w-[420px]">
    <div aria-hidden="true" className="absolute -top-4 left-1/2 z-10 -translate-x-1/2 text-4xl text-amber-300">▼</div>
    <div aria-hidden="true" className="relative aspect-square rounded-full border-[10px] border-amber-300 shadow-[0_0_45px_rgba(251,191,36,0.3)]" style={{background:`conic-gradient(${gradient})`,transform:`rotate(${rotation}deg)`,transition:'transform 3.6s cubic-bezier(.12,.7,.16,1)'}}>
      {clean.map((s,i)=>{const degrees=center(clean,i),angle=degrees*Math.PI/180;if(s.weight/total*360<10)return null;return <span key={s.digit} className="absolute font-bold text-white" style={{left:`${50+40*Math.sin(angle)}%`,top:`${50-40*Math.cos(angle)}%`,fontSize:'11px',transform:`translate(-50%,-50%) rotate(${degrees}deg)`}}>{label(s)}</span>;})}
    </div>
    <button type="button" disabled={!canSpin} onClick={onSpin} aria-label={buttonLabel} className="absolute inset-[36%] flex flex-col items-center justify-center rounded-full border-4 border-amber-300 bg-slate-950 text-center text-sm font-black text-amber-300 shadow-lg focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-70"><span>MatMove</span><span>{buttonLabel}</span></button>
  </div>;
}
export function SpinGame({userId,onBack}:{userId:string;onBack:()=>void}) {
  const [config,setConfig]=useState<Config|null>(null);
  const [round,setRound]=useState<Round|null>(null);
  const [eligibility,setEligibility]=useState({eligible:false,reason:null as string|null});
  const [available,setAvailable]=useState<number|null>(null);
  const [balanceError,setBalanceError]=useState('');
  const [tier,setTier]=useState(500);
  const [accepted,setAccepted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [rotation,setRotation]=useState(0);
  const [animation,setAnimation]=useState(false);
  const [resultNotice,setResultNotice]=useState<{title:string;message:string}|null>(null);
  const resultDialog=useRef<HTMLDialogElement|null>(null);
  const shownResult=useRef('');
  const draft=useRef<Draft|null>(null);
  const mutex=useRef(false);
  const configVersion=useRef<number|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const storageKey=`matmove-spin-entry:${userId}`;
  const acceptRound=useCallback((next:Round|null)=>{
    setRound(next);
    if(next){draft.current=null;try{localStorage.removeItem(storageKey);}catch{/* The server round still recovers on reload. */}}
  },[storageKey]);
  const load=useCallback(async()=>{
    const data=await gameRequest({action:'spin_config'});
    if(configVersion.current!==null&&configVersion.current!==data.config.id)setAccepted(false);
    configVersion.current=data.config.id;
    setConfig(data.config);setTier(old=>data.config.tiers.some((t:{entryMinor:number})=>t.entryMinor===old)?old:data.config.tiers[0].entryMinor);setEligibility(data.eligibility);setAvailable(data.availableMinor);setBalanceError(data.balanceError||'');acceptRound(data.round);
    if(!data.round){
      const stored=localStorage.getItem(storageKey);
      draft.current=stored?JSON.parse(stored):null;
      if(draft.current)setTier(draft.current.tierMinor||500);
      if(draft.current)setError('An entry request is awaiting confirmation. Check entry status before paying again.');
    }
  },[acceptRound,storageKey]);
  useEffect(()=>{void load().catch(e=>setError(e.message));return()=>{if(timer.current)clearTimeout(timer.current);};},[load]);
  useEffect(()=>{if(round)return;const refresh=setInterval(()=>{if(!document.hidden&&!mutex.current&&!draft.current)void load().catch(e=>setError(e.message));},15000);return()=>clearInterval(refresh);},[round,load]);
  const perform=useCallback(async(body:Record<string,unknown>,animate=false)=>{
    if(mutex.current)return;
    mutex.current=true;setBusy(true);setError('');
    try{
      const data=await gameRequest(body);
      if(data.canceled===true){draft.current=null;localStorage.removeItem(storageKey);setAccepted(false);await load();return;}
      if(animate&&data.round){
        const receipt=data.round.receipts.find((r:Receipt)=>r.index===body.spinIndex);
        if(receipt?.sectorIndex!==null&&receipt?.sectorIndex!==undefined){
          const target=360-center(data.round.sectors,receipt.sectorIndex);
          setRotation(previous=>previous+1800+((target-previous%360+360)%360));setAnimation(true);
          if(timer.current)clearTimeout(timer.current);
          timer.current=setTimeout(()=>setAnimation(false),3700);
        }
      }
      acceptRound(data.round);
    }catch(e){setError(e instanceof Error?e.message:'Game request failed. Check status.');}
    finally{mutex.current=false;setBusy(false);}
  },[acceptRound,load,storageKey]);
  useEffect(()=>{
    if(!round||!['entry_pending','win_pending'].includes(round.state))return;
    const interval=setInterval(()=>{if(!document.hidden)void perform({action:'spin_status',roundId:round.id});},5000);
    return()=>clearInterval(interval);
  },[round,perform]);
  function enter(){
    if(!config||!accepted||draft.current||mutex.current)return;
    const entry:Draft={requestKey:crypto.randomUUID(),configId:config.id,luckyDigit:selected?.sectors[0]?.digit||'0',acceptedEntryMinor:tier,tierMinor:tier,acceptRules:true};
    try{localStorage.setItem(storageKey,JSON.stringify(entry));draft.current=entry;}
    catch{setError('Allow browser storage before paying so this entry can be recovered.');return;}
    void perform({action:'spin_enter',...entry});
  }
  const selected=config?.tiers.find(t=>t.entryMinor===tier);
  const sectors=round?.sectors||selected?.sectors||[];
  const affordable=available!==null&&available>=tier;
  const six=(round?.mode||config?.mode)===SIX_MODE;
  const topPrize=sectors.length?Math.max(...sectors.map(s=>s.prizeMinor)):5000;
  const spins=round?.receipts.filter(r=>r.index>0)||[];
  const latest=spins[spins.length-1];
  const finished=round&&['completed','failed'].includes(round.state);
  useEffect(()=>{
    if(!round||!latest||latest.status!=='completed'||animation)return;
    const key=`${round.id}:${latest.index}`;
    if(shownResult.current===key)return;
    shownResult.current=key;
    if(latest.kind==='again')setResultNotice({title:'One free final spin!',message:'You earned one extra spin without another payment. Close this message and tap the wheel to use it.'});
    else if(latest.kind==='lose')setResultNotice({title:'Better luck next time',message:'This game has finished with no cash prize. You can choose a fee and start a new game.'});
    else setResultNotice({title:`You won ${money(latest.amountMinor)}!`,message:'The full prize has been credited to your wallet. No MatMove winnings fee was deducted.'});
  },[round,latest,animation]);
  useEffect(()=>{if(resultNotice&&resultDialog.current&&!resultDialog.current.open)resultDialog.current.showModal();},[resultNotice]);
  const canSpin=round?.state==='active'&&!busy&&!animation;
  const spinNow=()=>{if(round&&canSpin)void perform({action:'spin_draw',roundId:round.id,spinIndex:round.spinsUsed+1},true);};
  const spinLabel=animation?'Spinning…':busy?'Checking…':round?.state==='active'?(six&&round.spinsUsed===1?'FREE SPIN':'SPIN'):round?.state==='completed'?'FINISHED':round?'WAIT':'PAY FIRST';
  const odds=sectors.length&&!six?spinOdds(sectors):[];
  return <section className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <dialog ref={resultDialog} onClose={()=>setResultNotice(null)} aria-labelledby="spin-result-title" aria-describedby="spin-result-message" className="w-[calc(100%-2rem)] max-w-md rounded-3xl border-2 border-amber-400 bg-slate-950 p-6 text-center text-white shadow-2xl backdrop:bg-slate-950/70">
      {resultNotice&&<><p className="text-sm font-bold uppercase tracking-widest text-amber-300">MatMove Games</p><h2 id="spin-result-title" className="mt-4 text-3xl font-black">{resultNotice.title}</h2><p id="spin-result-message" className="mt-4 text-slate-200">{resultNotice.message}</p><button autoFocus type="button" onClick={()=>resultDialog.current?.close()} className="mt-6 w-full rounded-xl bg-amber-300 p-3 font-bold text-slate-950">Continue</button></>}
    </dialog>
    <button onClick={onBack} className="font-semibold text-slate-600">← Account</button>
    <div className="overflow-hidden rounded-3xl border border-amber-400 bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 p-6 text-white">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-300">MatMove Games</p><h1 className="mt-2 text-3xl font-black">Spin & Win</h1>
      <p className="mt-3 text-slate-200">{six?'Choose a fee for one spin, with at most one free bonus spin.':'Your purchased legacy game includes three spins.'} Win up to {money(topPrize)}.</p>
      {sectors.length>0&&<Wheel sectors={sectors} rotation={rotation} canSpin={!!canSpin} onSpin={spinNow} buttonLabel={spinLabel}/>}
      <p className="text-center text-lg font-bold" aria-live="polite">{animation?'Wheel spinning…':latest?(latest.kind==='again'?'You earned one free final spin.':latest.kind==='lose'?'Better luck next time — game finished.':`${money(latest.amountMinor)} — ${latest.status==='completed'?'credited to your wallet':'payment '+latest.status}`):six?'Six equal segments. One possible bonus.':'Three spins. Published prize chances.'}</p>
      {error&&<p role="alert" className="mt-4 rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}
      {round?.error&&<p role="alert" className="mt-4 rounded-xl bg-amber-950 p-3 text-amber-200">{round.error} Your receipt is retained. Contact support with game ID {round.id}.</p>}
      {round?<div className="mt-5 space-y-3 border-t border-white/20 pt-5">
        <p>{money(round.entryMinor)} bundle · {round.spinsUsed}/{six?'2 maximum':3} spins used · Total credited: {money(round.paidMinor)}</p>
        {round.state==='active'&&<button disabled={busy||animation} onClick={spinNow} className="w-full rounded-xl bg-amber-300 p-4 font-black text-slate-950 disabled:opacity-50">{six?(round.spinsUsed===0?'Spin now':'Use your one free final spin'):`Spin ${round.spinsUsed+1} of 3`}</button>}
        {['entry_pending','win_pending'].includes(round.state)&&<p role="status">Payment processing. Checking the receipt automatically…</p>}
        <button disabled={busy} onClick={()=>void perform({action:'spin_status',roundId:round.id})} className="rounded-xl border border-white/30 px-4 py-2">Check status</button>
        {finished&&<button disabled={busy||animation} onClick={()=>{setRound(null);setAccepted(false);void load().catch(e=>setError(e.message));}} className="ml-3 rounded-xl bg-white px-4 py-2 font-bold text-slate-950">{round.state==='completed'?'Round completed — new game':'Entry failed — review new game'}</button>}
      </div>:config?<div className="mt-5 space-y-3 border-t border-white/20 pt-5">
        <div className="grid grid-cols-3 gap-3">{config.tiers.map(t=>{const jackpot=six?null:spinOdds(t.sectors).find(o=>o.prizeMinor===5000);return <button key={t.entryMinor} disabled={busy||!!draft.current} onClick={()=>{setTier(t.entryMinor);setAccepted(false);}} aria-pressed={tier===t.entryMinor} className={`rounded-xl border p-3 text-center ${tier===t.entryMinor?'border-amber-300 bg-amber-300 text-slate-950':'border-white/30 bg-slate-900 text-white'}`}><b>{money(t.entryMinor)}</b><p className="mt-1 text-xs">{six?"1 spin + possible bonus":"3 spins"}</p>{!six&&<p className="mt-1 text-xs">SLE 50: {((jackpot?.probability||0)*100).toFixed(4)}% per spin</p>}</button>;})}</div>
        <p>Available SLE balance: {available===null?'Unavailable':money(available)}</p>
        {balanceError&&<p role="alert" className="text-amber-200">{balanceError}</p>}
        {available!==null&&!affordable&&<p>You need {money(tier)} available for this bundle.</p>}
        {!config.enabled&&<p>New entries are paused.</p>}{!eligibility.eligible&&<p>{eligibility.reason}</p>}
        <p className="text-sm text-slate-300">No separate game-admin approval is needed. Your profile must meet the adult identity requirements and your wallet must be unfrozen.</p>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I am 18 or older and have reviewed the {money(tier)} fee, displayed game rules and prize chances below.</label>
        {draft.current?<><button disabled={busy} onClick={()=>void perform({action:'spin_enter',...draft.current})} className="w-full rounded-xl bg-amber-300 p-4 font-bold text-slate-950">Check entry status</button><button disabled={busy} onClick={()=>void perform({action:'spin_cancel_entry',requestKey:draft.current?.requestKey})} className="w-full rounded-xl border border-white/30 p-3">Cancel only if entry has not started</button></>:<button disabled={busy||!accepted||!config.enabled||!eligibility.eligible||!affordable} onClick={enter} className="w-full rounded-xl bg-amber-300 p-4 font-black text-slate-950 disabled:opacity-50">Pay {money(tier)} — {six?"start one spin":"start 3 spins"}</button>}
      </div>:<p>Loading game…</p>}
      {six&&<div className="mt-5 space-y-2 border-t border-white/20 pt-4 text-sm"><p>First spin: each of the six segments has a 1 in 6 chance (16.67%). A cash result ends the game after its full prize is credited. Better luck next time pays nothing and ends the game.</p><p>Spin again grants one free final spin. Its four cash segments and Better luck next time each have a 1 in 5 chance (20%). The Spin again segment is excluded on that final spin.</p><div className="grid grid-cols-2 gap-2">{sectors.map((s,i)=><p key={i} className="rounded-lg bg-white/10 p-2">{label(s)}</p>)}</div><p>Starting another game requires a new payment. No winnings fee. Purchased rules stay fixed.</p></div>}
      <p className="mt-5 text-center text-sm text-amber-200">18+ · Play responsibly</p>
    </div>
    {odds.length>0&&<div className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Prize chances per spin</h2><table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Prize</th><th>Probability share</th><th>Chance</th></tr></thead><tbody>{odds.map(o=><tr key={o.prizeMinor} className="border-b"><td className="py-3 font-semibold">{money(o.prizeMinor)}</td><td>{o.weight} of {o.totalWeight}</td><td>{(o.probability*100).toFixed(4)}%</td></tr>)}</tbody></table>
      <p className="mt-4 text-sm text-slate-600">Wheel segment sizes match their published probability shares. Prizes in the selected bundle are possible from the first spin. Spins are independent, and continuing does not guarantee a SLE 50 win. Paid-round rules stay fixed. One entry payment buys three spins; no extra fee is taken from winnings. A bundle is not refundable once activated.</p>
      <details className="mt-4 border-t pt-3"><summary className="cursor-pointer font-semibold">All wheel numbers and prizes</summary><div className="mt-3 grid grid-cols-4 gap-2 text-xs sm:grid-cols-6">{sectors.map(s=><div key={s.digit} className="rounded-lg bg-slate-50 p-2">{s.digit}: {money(s.prizeMinor)}</div>)}</div></details>
    </div>}
    {round&&<div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Game receipts</h2><p className="mt-2 break-all text-xs text-slate-500">Game ID: {round.id}</p>{round.receipts.map(r=><div key={r.index} className="mt-3 border-t pt-3"><p>{r.index===0?'Entry fee':r.kind==='again'?'Free final spin earned':r.kind==='lose'?'Better luck next time':`Spin ${r.index} — number ${r.digit}`}: {money(r.amountMinor)} · {r.status}</p><p className="break-all text-xs text-slate-500">{r.kind==='again'||r.kind==='lose'?'No money transfer for this outcome':r.providerId||'Provider receipt not confirmed yet'}</p></div>)}</div>}
  </section>;
}
