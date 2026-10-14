

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { spinOdds, spinSectorCenter, validateSpinSectors, type SpinSector, type SpinTier } from '../../shared/spin-rules.js';

type Receipt = {index:number;sectorIndex:number|null;digit:string|null;amountMinor:number;providerId:string|null;status:string;error:string|null};
type Round = {id:string;state:string;sectors:SpinSector[];entryMinor:number;luckyDigit:string;spinsUsed:number;paidMinor:number;receipts:Receipt[];error:string|null};
type Config = {id:number;enabled:boolean;tiers:SpinTier[]};
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
function Wheel({sectors,rotation}:{sectors:SpinSector[];rotation:number}) {
  const clean=validateSpinSectors(sectors),total=clean.reduce((n,s)=>n+s.weight,0);
  let cursor=0;
  const gradient=clean.map(s=>{const start=cursor;cursor+=s.weight/total*360;return `${color(s.prizeMinor)} ${start}deg ${cursor}deg`;}).join(',');
  return <div className="relative mx-auto my-8 w-full max-w-[420px]">
    <div aria-hidden="true" className="absolute -top-4 left-1/2 z-10 -translate-x-1/2 text-4xl text-amber-300">▼</div>
    <div aria-hidden="true" className="relative aspect-square rounded-full border-[10px] border-amber-300 shadow-[0_0_45px_rgba(251,191,36,0.3)]" style={{background:`conic-gradient(${gradient})`,transform:`rotate(${rotation}deg)`,transition:'transform 3.6s cubic-bezier(.12,.7,.16,1)'}}>
      {clean.map((s,i)=>{const degrees=spinSectorCenter(clean,i),angle=degrees*Math.PI/180;if(s.weight/total*360<10)return null;return <span key={s.digit} className="absolute font-bold text-white" style={{left:`${50+40*Math.sin(angle)}%`,top:`${50-40*Math.cos(angle)}%`,fontSize:'11px',transform:`translate(-50%,-50%) rotate(${degrees}deg)`}}>{money(s.prizeMinor)}</span>;})}
      <div className="absolute inset-[36%] flex items-center justify-center rounded-full border-4 border-amber-300 bg-slate-950 text-center text-sm font-black text-amber-300">MatMove<br/>SPIN</div>
    </div>
  </div>;
}
export function SpinGame({userId,onBack}:{userId:string;onBack:()=>void}) {
  const [config,setConfig]=useState<Config|null>(null);
  const [round,setRound]=useState<Round|null>(null);
  const [eligibility,setEligibility]=useState({eligible:false,reason:null as string|null});
  const [available,setAvailable]=useState<number|null>(null);
  const [balanceError,setBalanceError]=useState('');
  const [tier,setTier]=useState(500);
  const [digit,setDigit]=useState('0');
  const [accepted,setAccepted]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [rotation,setRotation]=useState(0);
  const [animation,setAnimation]=useState(false);
  const draft=useRef<Draft|null>(null);
  const mutex=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const storageKey=`matmove-spin-entry:${userId}`;
  const acceptRound=useCallback((next:Round|null)=>{
    setRound(next);
    if(next){draft.current=null;try{localStorage.removeItem(storageKey);}catch{/* The server round still recovers on reload. */}}
  },[storageKey]);
  const load=useCallback(async()=>{
    const data=await gameRequest({action:'spin_config'});
    setConfig(data.config);setEligibility(data.eligibility);setAvailable(data.availableMinor);setBalanceError(data.balanceError||'');acceptRound(data.round);
    if(!data.round){
      const stored=localStorage.getItem(storageKey);
      draft.current=stored?JSON.parse(stored):null;
      if(draft.current)setTier(draft.current.tierMinor||500);
      if(draft.current)setError('An entry request is awaiting confirmation. Check entry status before paying again.');
    }
  },[acceptRound,storageKey]);
  useEffect(()=>{void load().catch(e=>setError(e.message));return()=>{if(timer.current)clearTimeout(timer.current);};},[load]);
  const perform=useCallback(async(body:Record<string,unknown>,animate=false)=>{
    if(mutex.current)return;
    mutex.current=true;setBusy(true);setError('');
    try{
      const data=await gameRequest(body);
      if(data.canceled===true){draft.current=null;localStorage.removeItem(storageKey);setAccepted(false);await load();return;}
      if(animate&&data.round){
        const receipt=data.round.receipts.find((r:Receipt)=>r.index===body.spinIndex);
        if(receipt?.sectorIndex!==null&&receipt?.sectorIndex!==undefined){
          const target=360-spinSectorCenter(data.round.sectors,receipt.sectorIndex);
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
    const entry:Draft={requestKey:crypto.randomUUID(),configId:config.id,luckyDigit:digit,acceptedEntryMinor:tier,tierMinor:tier,acceptRules:true};
    try{localStorage.setItem(storageKey,JSON.stringify(entry));draft.current=entry;}
    catch{setError('Allow browser storage before paying so this entry can be recovered.');return;}
    void perform({action:'spin_enter',...entry});
  }
  const selected=config?.tiers.find(t=>t.entryMinor===tier);
  const sectors=round?.sectors||selected?.sectors||[];
  useEffect(()=>{if(!round&&!draft.current&&selected)setDigit(old=>selected.sectors.some(s=>s.digit===old)?old:selected.sectors[0].digit);},[selected,round]);
  const affordable=available!==null&&available>=tier;
  const topPrize=sectors.length?Math.max(...sectors.map(s=>s.prizeMinor)):5000;
  const spins=round?.receipts.filter(r=>r.index>0)||[];
  const latest=spins[spins.length-1];
  const finished=round&&['completed','failed'].includes(round.state);
  const odds=sectors.length?spinOdds(sectors):[];
  return <section className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <button onClick={onBack} className="font-semibold text-slate-600">← Account</button>
    <div className="overflow-hidden rounded-3xl border border-amber-400 bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 p-6 text-white">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-300">MatMove Games</p><h1 className="mt-2 text-3xl font-black">Spin & Win</h1>
      <p className="mt-3 text-slate-200">Choose SLE 5, SLE 10 or SLE 20 for three spins. Win up to {money(topPrize)} per spin.</p>
      {sectors.length>0&&<Wheel sectors={sectors} rotation={rotation}/>}
      <p className="text-center text-lg font-bold" aria-live="polite">{animation?'Wheel spinning…':latest?`Number ${latest.digit}: ${money(latest.amountMinor)} — ${latest.status==='completed'?'credited to your wallet':'payment '+latest.status}`:'Three spins. Published prize chances.'}</p>
      {error&&<p role="alert" className="mt-4 rounded-xl bg-red-950 p-3 text-red-200">{error}</p>}
      {round?.error&&<p role="alert" className="mt-4 rounded-xl bg-amber-950 p-3 text-amber-200">{round.error} Your receipt is retained. Contact support with game ID {round.id}.</p>}
      {round?<div className="mt-5 space-y-3 border-t border-white/20 pt-5">
        <p>{money(round.entryMinor)} bundle · {round.spinsUsed}/3 spins used · Total credited: {money(round.paidMinor)}</p>
        {round.state==='active'&&<button disabled={busy||animation} onClick={()=>void perform({action:'spin_draw',roundId:round.id,spinIndex:round.spinsUsed+1},true)} className="w-full rounded-xl bg-amber-300 p-4 font-black text-slate-950 disabled:opacity-50">Spin {round.spinsUsed+1} of 3</button>}
        {['entry_pending','win_pending'].includes(round.state)&&<p role="status">Payment processing. Checking the receipt automatically…</p>}
        <button disabled={busy} onClick={()=>void perform({action:'spin_status',roundId:round.id})} className="rounded-xl border border-white/30 px-4 py-2">Check status</button>
        {finished&&<button disabled={busy||animation} onClick={()=>{setRound(null);setAccepted(false);void load().catch(e=>setError(e.message));}} className="ml-3 rounded-xl bg-white px-4 py-2 font-bold text-slate-950">{round.state==='completed'?'Round completed — new game':'Entry failed — review new game'}</button>}
      </div>:config?<div className="mt-5 space-y-3 border-t border-white/20 pt-5">
        <div className="grid grid-cols-3 gap-3">{config.tiers.map(t=>{const jackpot=spinOdds(t.sectors).find(o=>o.prizeMinor===5000);return <button key={t.entryMinor} disabled={busy||!!draft.current} onClick={()=>{setTier(t.entryMinor);setAccepted(false);}} aria-pressed={tier===t.entryMinor} className={`rounded-xl border p-3 text-center ${tier===t.entryMinor?'border-amber-300 bg-amber-300 text-slate-950':'border-white/30 bg-slate-900 text-white'}`}><b>{money(t.entryMinor)}</b><p className="mt-1 text-xs">3 spins</p><p className="mt-1 text-xs">SLE 50: {((jackpot?.probability||0)*100).toFixed(4)}% per spin</p></button>;})}</div>
        <p>Available SLE balance: {available===null?'Unavailable':money(available)}</p>
        {balanceError&&<p role="alert" className="text-amber-200">{balanceError}</p>}
        {available!==null&&!affordable&&<p>You need {money(tier)} available for this bundle.</p>}
        <label className="block">Choose your lucky number<select value={digit} disabled={!!draft.current} onChange={e=>setDigit(e.target.value)} className="mt-2 w-full rounded-xl bg-slate-900 p-3 text-white">{sectors.map(s=><option key={s.digit} value={s.digit}>{s.digit}</option>)}</select></label>
        <p className="text-sm text-slate-300">Your chosen number is a personal marker. It does not change the prize chances. The selected bundle determines the published odds, and each spin pays the prize where the wheel lands.</p>
        {!config.enabled&&<p>New entries are paused.</p>}{!eligibility.eligible&&<p>{eligibility.reason}</p>}
        <p className="text-sm text-slate-300">No separate game-admin approval is needed. Your profile must meet the adult identity requirements and your wallet must be unfrozen.</p>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I am 18 or older and have reviewed the {money(tier)} fee, three-spin rules and prize chances below.</label>
        {draft.current?<><button disabled={busy} onClick={()=>void perform({action:'spin_enter',...draft.current})} className="w-full rounded-xl bg-amber-300 p-4 font-bold text-slate-950">Check entry status</button><button disabled={busy} onClick={()=>void perform({action:'spin_cancel_entry',requestKey:draft.current?.requestKey})} className="w-full rounded-xl border border-white/30 p-3">Cancel only if entry has not started</button></>:<button disabled={busy||!accepted||!config.enabled||!eligibility.eligible||!affordable} onClick={enter} className="w-full rounded-xl bg-amber-300 p-4 font-black text-slate-950 disabled:opacity-50">Pay {money(tier)} — start 3 spins</button>}
      </div>:<p>Loading game…</p>}
      <p className="mt-5 text-center text-sm text-amber-200">18+ · Play responsibly</p>
    </div>
    {odds.length>0&&<div className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Prize chances per spin</h2><table className="mt-3 w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Prize</th><th>Probability share</th><th>Chance</th></tr></thead><tbody>{odds.map(o=><tr key={o.prizeMinor} className="border-b"><td className="py-3 font-semibold">{money(o.prizeMinor)}</td><td>{o.weight} of {o.totalWeight}</td><td>{(o.probability*100).toFixed(4)}%</td></tr>)}</tbody></table>
      <p className="mt-4 text-sm text-slate-600">Wheel segment sizes match their published probability shares. Prizes in the selected bundle are possible from the first spin. Spins are independent, and continuing does not guarantee a SLE 50 win. Paid-round rules stay fixed. One entry payment buys three spins; no extra fee is taken from winnings. A bundle is not refundable once activated.</p>
      <details className="mt-4 border-t pt-3"><summary className="cursor-pointer font-semibold">All wheel numbers and prizes</summary><div className="mt-3 grid grid-cols-4 gap-2 text-xs sm:grid-cols-6">{sectors.map(s=><div key={s.digit} className="rounded-lg bg-slate-50 p-2">{s.digit}: {money(s.prizeMinor)}</div>)}</div></details>
    </div>}
    {round&&<div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Game receipts</h2><p className="mt-2 break-all text-xs text-slate-500">Game ID: {round.id}</p>{round.receipts.map(r=><div key={r.index} className="mt-3 border-t pt-3"><p>{r.index===0?'Entry fee':`Spin ${r.index} — number ${r.digit}`}: {money(r.amountMinor)} · {r.status}</p><p className="break-all text-xs text-slate-500">{r.providerId||'Provider receipt not confirmed yet'}</p></div>)}</div>}
  </section>;
}
