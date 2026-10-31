

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck, Gem, Crown, CircleDollarSign, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SpinGame } from '@/components/SpinGame';
import { FRUITS } from '../../shared/arcade-rules.js';
import { arcadeEntry, validateArcadeSettings, type ArcadeGame, type ArcadeSettings, type ArcadePrediction } from '../../shared/arcade-payment-rules.js';

type Outcome = {index:number;values:number[];prizeMinor:number;createdAt:string;paymentStatus:string};
type Receipt = {index:number;kind:'entry'|'win';amountMinor:number;providerId:string|null;status:string;error:string|null};
export type ArcadeRound = {id:string;game:ArcadeGame;state:string;configId:number;rules:any;prediction:ArcadePrediction;entryMinor:number;attemptCount:number;attemptsUsed:number;expiresAt:string|null;createdAt:string;paidMinor:number;error:string|null;outcomes:Outcome[];receipts:Receipt[]};
type GameConfig = {id:number;settings:ArcadeSettings};
type Envelope = {config:GameConfig;moneyEnabled:boolean;eligibility:{eligible:boolean;reason:string|null};availableMinor:number|null;balanceError:string|null;rounds:ArcadeRound[]};
type EntryDraft = {action:'arcade_enter';game:ArcadeGame;requestKey:string;configId:number;prediction:ArcadePrediction;acceptedEntryMinor:number;acceptedPayoutMinor?:number;acceptRules:true};
type Reply = Partial<Envelope> & {round?:ArcadeRound;canceled?:boolean;error?:string};
const names = {dice:'RICH DICE',fruity:'Fruity Flue',crankling:'CRANKLING'};
const money = (minor:number) => `SLE ${(minor/100).toFixed(2)}`;
const isPending = (r:ArcadeRound|null) => !!r && ['entry_pending','win_pending'].includes(r.state);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (text:string) => {if(!/^\d+(\.\d{1,2})?$/.test(text))return NaN;const [whole,decimal='']=text.split('.');const n=Number(whole)*100+Number(decimal.padEnd(2,'0'));return Number.isSafeInteger(n)?n:NaN;};
export async function arcadeRequest(userId:string,body:Record<string,unknown>):Promise<Reply> {
  const {data:{session},error}=await supabase.auth.getSession();
  if(error||!session||session.user.id!==userId)throw new Error('Your sign-in changed. Sign in again before using Games.');
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch('/api/get-live-wallet',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body),signal:controller.signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data)throw new Error(data?.error||'Game confirmation is unavailable. Keep your saved request and check its status.');
    return data;
  } finally {window.clearTimeout(timeout);}
}
function validateEnvelope(data:Reply):Envelope {
  if(!data.config||!Number.isSafeInteger(data.config.id)||!data.eligibility||typeof data.eligibility.eligible!=='boolean'||!Array.isArray(data.rounds))throw new Error('The game settings could not be confirmed.');
  const settings=validateArcadeSettings(data.config.settings);
  if(data.availableMinor!==null&&(!Number.isSafeInteger(data.availableMinor)||(data.availableMinor as number)<0))throw new Error('The available balance could not be confirmed.');
  return {...data,config:{id:data.config.id,settings}} as Envelope;
}
function readDraft(key:string,game:ArcadeGame):{draft:EntryDraft|null;error:string} {
  if(typeof window==='undefined')return {draft:null,error:''};
  try {
    const raw=localStorage.getItem(key);if(!raw)return {draft:null,error:''};
    const d=JSON.parse(raw);
    if(d?.action!=='arcade_enter'||d.game!==game||!uuid.test(d.requestKey||'')||!Number.isSafeInteger(d.configId)||!Number.isSafeInteger(d.acceptedEntryMinor)||d.acceptedEntryMinor<0||d.acceptRules!==true||!d.prediction||typeof d.prediction!=='object'||Array.isArray(d.prediction))throw new Error('Invalid saved request.');
    return {draft:d,error:''};
  } catch {return {draft:null,error:'A saved game request could not be read. Refresh Games to recover the server receipt. Contact support before starting another payment if this message remains.'};}
}
function duration(ms:number) {const s=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}

export function ArcadeGames({userId,onBack,initialGame='menu'}:{userId:string;onBack:()=>void;initialGame?:'menu'|'spin'|ArcadeGame}) {
  const [game,setGame]=useState<'menu'|'spin'|ArcadeGame>(initialGame);
  if(game==='spin')return <div><button type="button" onClick={()=>setGame('menu')} className="mx-6 mt-5 inline-flex items-center gap-2 font-bold text-slate-600"><ArrowLeft size={18}/>All games</button><SpinGame key={userId} userId={userId} onBack={onBack}/></div>;
  if(game!=='menu')return <AccountArcade key={`${userId}:${game}`} userId={userId} game={game} onBack={()=>setGame('menu')} onAccount={onBack}/>;
  const games=[
    {id:'spin',name:'MatMove Spin',icon:'🎡',text:'Choose a published wheel fee, pay, then spin. Existing purchased games stay available.',colors:'from-purple-950 via-fuchsia-950 to-slate-950'},
    {id:'dice',name:'RICH DICE',icon:'🎲',text:'Predict above, equal to, or below a two-dice total. See your exact possible return before paying.',colors:'from-amber-950 via-slate-900 to-slate-950'},
    {id:'fruity',name:'Fruity Flue',icon:'🍍',text:'Three free attempts every rolling 24 hours. Match the same fruit on all four reels.',colors:'from-emerald-950 via-teal-950 to-slate-950'},
    {id:'crankling',name:'CRANKLING',icon:'777',text:'Choose your number from 1 to 10. One entry buys three attempts to match it across all three reels.',colors:'from-indigo-950 via-violet-950 to-slate-950'},
  ] as const;
  return <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-2 font-bold text-slate-600"><ArrowLeft size={18}/>Account</button>
    <div><p className="font-bold uppercase tracking-widest text-purple-700">MatMove Games</p><h1 className="mt-2 text-3xl font-black text-slate-950">Choose your game</h1><p className="mt-3 text-slate-600">Your account games use real SLE. Free landing-page demos use virtual credits. Every game shows its rules before you start.</p></div>
    <div className="grid gap-5 sm:grid-cols-2">{games.map(g=><button key={g.id} type="button" onClick={()=>setGame(g.id)} className={`rounded-3xl border border-amber-300/40 bg-gradient-to-br ${g.colors} p-6 text-left text-white shadow-xl transition hover:-translate-y-1 focus-visible:outline focus-visible:outline-4 focus-visible:outline-purple-500`}><span aria-hidden="true" className="text-4xl font-black text-amber-200">{g.icon}</span><h2 className="mt-4 text-2xl font-black">{g.name}</h2><p className="mt-3 text-sm leading-relaxed text-slate-200">{g.text}</p><span className="mt-5 inline-flex rounded-xl bg-amber-300 px-4 py-2 font-black text-slate-950">Open game →</span></button>)}</div>
    <p className="flex items-center gap-2 rounded-2xl border bg-white p-4 text-sm text-slate-600"><ShieldCheck size={20} className="shrink-0 text-emerald-700"/>18+ · Verified identity and an unfrozen SLE wallet are required. No separate game-admin approval. Play responsibly.</p>
  </section>;
}

export function AccountArcade({userId,game,onBack,onAccount}:{userId:string;game:ArcadeGame;onBack:()=>void;onAccount:()=>void}) {
  const storageKey=`matmove-arcade-entry:v1:${userId}:${game}`;
  const [initial]=useState(()=>readDraft(storageKey,game));
  const [draft,setDraft]=useState<EntryDraft|null>(initial.draft);
  const draftRef=useRef<EntryDraft|null>(initial.draft);
  const [storageError,setStorageError]=useState(initial.error);
  const [data,setData]=useState<Envelope|null>(null);
  const [round,setRound]=useState<ArcadeRound|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [accepted,setAccepted]=useState(false);
  const [stake,setStake]=useState('5');
  const [target,setTarget]=useState(7);
  const [comparison,setComparison]=useState<'above'|'equal'|'below'>('above');
  const [lucky,setLucky]=useState(7);
  const [now,setNow]=useState(()=>Date.now());
  const [animating,setAnimating]=useState(false);
  const [balanceVisible,setBalanceVisible]=useState(false);
  const [style,setStyle]=useState<'gold'|'platinum'|'diamond'>('gold');
  const [notice,setNotice]=useState<{title:string;message:string}|null>(null);
  const dialog=useRef<HTMLDialogElement|null>(null);
  const shown=useRef('');
  const mutex=useRef(false),alive=useRef(true),generation=useRef(0),configId=useRef<number|null>(null),readSequence=useRef(0),dismissedRound=useRef('');
  const animationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const clearDraft=useCallback(()=>{
    try {localStorage.removeItem(storageKey);setStorageError('');}catch{setStorageError('The confirmed request could not be removed from browser storage. Enable storage and refresh before a new payment.');}
    draftRef.current=null;setDraft(null);
  },[storageKey]);
  const load=useCallback(async()=>{
    const version=generation.current,sequence=++readSequence.current;
    const next=validateEnvelope(await arcadeRequest(userId,{action:'arcade_config'}));
    if(!alive.current||version!==generation.current||sequence!==readSequence.current)return;
    if(configId.current!==null&&configId.current!==next.config.id)setAccepted(false);
    configId.current=next.config.id;setData(next);
    // Never discard an unresolved entry because some OTHER round was found.
    // Its request key is resolved atomically through arcade_cancel below.
    const own=next.rounds.filter(r=>r.game===game&&r.id!==dismissedRound.current);
    setRound(previous=>own.find(r=>r.id===previous?.id)||own.find(r=>!['completed','failed'].includes(r.state))||own[0]||(['completed','failed'].includes(previous?.state||'')?previous:null));
    setLoading(false);
  },[userId,game]);
  useEffect(()=>{
    alive.current=true;void load().catch(e=>{if(alive.current){setError(e.message);setLoading(false);}});
    const timer=window.setInterval(()=>{if(!document.hidden&&!mutex.current)void load().catch(e=>{if(alive.current)setError(e.message);});},15000);
    const clock=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>{alive.current=false;window.clearInterval(timer);window.clearInterval(clock);if(animationTimer.current)clearTimeout(animationTimer.current);};
  },[load]);
  const perform=useCallback(async(body:Record<string,unknown>,options:{draw?:boolean;resolveDraft?:boolean}={})=>{
    if(mutex.current)return;mutex.current=true;generation.current++;setBusy(true);setError('');
    try {
      const reply=await arcadeRequest(userId,body);
      if(!alive.current)return;
      if(reply.canceled===true){clearDraft();setAccepted(false);setNotice({title:'Unstarted entry canceled',message:'The server confirmed this request had not started and blocked any delayed entry using its key. You can review a fresh game.'});}
      else {
        if(!reply.round||reply.round.game!==game)throw new Error('The game response could not be confirmed. Keep your request and check again.');
        if(options.resolveDraft)clearDraft();
        if(options.draw&&reply.round.outcomes.some(o=>o.index===body.attemptIndex)){
          setAnimating(true);if(animationTimer.current)clearTimeout(animationTimer.current);
          animationTimer.current=setTimeout(()=>{if(alive.current)setAnimating(false);},1400);
        }
        setRound(reply.round);
        
      }
      await load().catch(e=>{if(alive.current)setError(`Your receipt is retained. ${e.message}`);});
    } catch(e) {if(alive.current)setError(e instanceof Error?e.message:'Confirmation unavailable. Keep the original request.');}
    finally {mutex.current=false;if(alive.current)setBusy(false);}
  },[userId,game,clearDraft,load]);
  useEffect(()=>{
    if(!round||!isPending(round))return;
    const timer=window.setInterval(()=>{if(!document.hidden&&!mutex.current)void perform({action:'arcade_status',roundId:round.id});},5000);
    return()=>window.clearInterval(timer);
  },[round?.id,round?.state,perform]);
  const latest=round?.outcomes[round.outcomes.length-1];
  useEffect(()=>{
    if(!round||!latest||animating||draftRef.current)return;
    const key=`${round.id}:${latest.index}`;
    if(shown.current===key)return;
    if(latest.prizeMinor>0&&latest.paymentStatus!=='completed')return;
    shown.current=key;
    setNotice(latest.prizeMinor>0?{title:`You won ${money(latest.prizeMinor)}!`,message:'The full prize is confirmed credited to your wallet. No MatMove winnings fee was deducted.'}:{title:'No match this attempt',message:round.attemptsUsed<round.attemptCount?'Your remaining attempts are still available.':game==='fruity'?'Your three attempts are used. Your next free window opens at the displayed reset time.':'This game is complete. Another game requires a new entry payment.'});
  },[round,latest,animating,game]);
  useEffect(()=>{if(notice&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[notice]);
  const prediction:ArcadePrediction=game==='dice'?{stakeMinor:cents(stake),target,comparison}:game==='crankling'?{luckyNumber:lucky}:{};
  let entry:ReturnType<typeof arcadeEntry>|null=null,validation='';
  if(data){try{entry=arcadeEntry(game,prediction,data.config.settings);}catch(e){validation=e instanceof Error?e.message:'Check your prediction.';}}
  const rules=round?.rules||data?.config.settings[game];
  const expires=Date.parse(round?.expiresAt||'');
  const cooldown=game==='fruity'&&Number.isFinite(expires)&&expires>now;
  const freeExpired=game==='fruity'&&Number.isFinite(expires)&&expires<=now&&!!round&&['active','completed'].includes(round.state);
  const ended=!!round&&(['completed','failed'].includes(round.state)||freeExpired);
  const balance=data?.availableMinor??null;
  const affordable=!!entry&&balance!==null&&balance>=entry.entryMinor;
  const canEnter=!!data&&!!entry&&!round&&!draft&&!storageError&&!busy&&accepted&&data.moneyEnabled&&data.config.settings[game].enabled&&data.eligibility.eligible&&affordable;
  const canDraw=round?.state==='active'&&!freeExpired&&!draft&&!storageError&&!busy&&!animating;
  function enter() {
    if(!canEnter||!data||!entry||mutex.current||draftRef.current)return;
    const next:EntryDraft={action:'arcade_enter',game,requestKey:crypto.randomUUID(),configId:data.config.id,prediction:entry.prediction,acceptedEntryMinor:entry.entryMinor,...(game==='dice'?{acceptedPayoutMinor:entry.maximumPrizeMinor}:{}),acceptRules:true};
    try {localStorage.setItem(storageKey,JSON.stringify(next));}catch{setStorageError('Allow browser storage before starting so your payment request can be recovered.');return;}
    draftRef.current=next;setDraft(next);
    void perform(next,{resolveDraft:true});
  }
  const refresh=()=>{if(mutex.current)return;setError('');void load().catch(e=>setError(e.message));};
  const theme=style==='gold'?'from-amber-950 via-slate-950 to-purple-950':style==='platinum'?'from-slate-700 via-slate-950 to-zinc-800':'from-cyan-950 via-slate-950 to-indigo-950';
  const shownValues=animating?[]:latest?.values||[];
  return <section className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 font-bold text-slate-600"><ArrowLeft size={18}/>All games</button><button type="button" onClick={onAccount} className="font-bold text-slate-600">Account</button></div>
    <dialog ref={dialog} onClose={()=>setNotice(null)} aria-labelledby={`arcade-result-${game}`} className="w-[calc(100%-2rem)] max-w-md rounded-3xl border-2 border-amber-300 bg-slate-950 p-7 text-center text-white shadow-2xl backdrop:bg-slate-950/75">
      {notice&&<><p className="font-bold uppercase tracking-widest text-amber-300">{names[game]}</p><h2 id={`arcade-result-${game}`} className="mt-4 text-3xl font-black">{notice.title}</h2><p className="mt-4 text-slate-200">{notice.message}</p><button type="button" autoFocus onClick={()=>dialog.current?.close()} className="mt-6 w-full rounded-xl bg-amber-300 p-3 font-black text-slate-950">Continue</button></>}
    </dialog>
    <div className={`overflow-hidden rounded-[2rem] border border-amber-300/50 bg-gradient-to-br ${game==='fruity'?'from-emerald-950 via-slate-950 to-teal-950':game==='crankling'?'from-violet-950 via-slate-950 to-indigo-950':theme} p-5 text-white shadow-2xl sm:p-8`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-200">MatMove Games · Account play</p><h1 className="mt-3 text-3xl font-black tracking-wide sm:text-4xl">{names[game]}</h1></div><Gem size={35} aria-hidden="true" className="shrink-0 text-amber-200"/></div>
      <p className="mt-4 leading-relaxed text-slate-200">{game==='dice'?'Two independent dice. Your prediction, your published chance, your exact possible return.':game==='fruity'?'Four reels, 50 distinct fruit identities on each reel. Match the same fruit across all four to win.':'Three reels, numbers 1 to 10. All three must match the number you chose before paying.'}</p>
      {game==='dice'&&<div className="mt-5 flex flex-wrap gap-2" aria-label="Dice appearance">{(['gold','platinum','diamond'] as const).map(s=><button key={s} type="button" aria-pressed={style===s} onClick={()=>setStyle(s)} className={`rounded-full border px-4 py-2 text-sm font-bold capitalize ${s===style?'border-amber-200 bg-amber-200 text-slate-950':'border-white/25 text-slate-200'}`}>{s}</button>)}<span className="self-center text-xs text-slate-300">Appearance only</span></div>}
      <div role="img" aria-label={animating?'Drawing your server-confirmed result':shownValues.length?shownValues.map(v=>game==='fruity'?FRUITS[v]?.name:String(v)).join(', '):`${game==='fruity'?4:game==='crankling'?3:2} reels ready`} className={`my-7 grid gap-2 sm:gap-4 ${game==='fruity'?'grid-cols-4':game==='crankling'?'grid-cols-3':'grid-cols-2'}`}>
        {Array.from({length:game==='fruity'?4:game==='crankling'?3:2},(_,i)=>{const v=shownValues[i],fruit=game==='fruity'&&v!==undefined?FRUITS[v]:null;return <div key={i} className={`flex min-h-28 flex-col items-center justify-center rounded-2xl border-2 border-amber-200/60 bg-white/10 px-1 py-5 shadow-inner sm:min-h-36 ${animating?'motion-safe:animate-pulse':''}`}><span aria-hidden="true" className={`${game==='dice'?'text-7xl':'text-4xl sm:text-5xl'} font-black text-amber-100`}>{animating?'•':fruit?fruit.icon:v!==undefined?game==='dice'?['','⚀','⚁','⚂','⚃','⚄','⚅'][v]:v:game==='fruity'?FRUITS[i*6].icon:game==='crankling'?'?':'⚄'}</span>{fruit&&<span className="mt-2 break-words text-center text-[10px] font-bold sm:text-xs">{fruit.name}</span>}</div>;})}
      </div>
      <p role="status" className="min-h-6 text-center font-bold text-amber-200">{animating?'Drawing…':latest?latest.prizeMinor>0?latest.paymentStatus==='completed'?`${money(latest.prizeMinor)} credited`:`You won ${money(latest.prizeMinor)} — payment ${latest.paymentStatus.replace(/_/g,' ')}`:'No match on this attempt.':round?.state==='active'?'Your game is ready. Tap to play.':'Choose your settings and review the rules below.'}</p>
      {error&&<p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-950 p-3 text-red-100">{error}</p>}
      {storageError&&<p role="alert" className="mt-4 rounded-xl bg-red-950 p-3 text-red-100">{storageError}</p>}
      {round?.error&&<p role="alert" className="mt-4 rounded-xl bg-amber-950 p-3 text-amber-100">{round.error} Your receipt and any unpaid prize are retained. Contact support with game ID {round.id}.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/20 pt-4"><div className="flex items-center gap-3 text-sm"><p>Available wallet balance: <b>{balance===null?'Not confirmed':balanceVisible?money(balance):'••••••'}</b></p><button type="button" aria-label={balanceVisible?'Hide wallet balance':'Show wallet balance'} aria-pressed={balanceVisible} onClick={()=>setBalanceVisible(v=>!v)} className="rounded-lg border border-white/25 p-2">{balanceVisible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><button type="button" disabled={busy} onClick={refresh} className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-3 py-2 text-sm font-bold disabled:opacity-50"><RefreshCw size={16}/>Refresh</button></div>
      {data?.balanceError&&<p className="mt-2 text-sm text-amber-200">{data.balanceError}</p>}
      {loading&&!data&&<p className="mt-5" role="status">Loading your game settings and receipts…</p>}
      {draft&&<div className="mt-5 rounded-2xl border border-amber-300 bg-amber-300/10 p-4"><h2 className="font-black">Resolve your saved entry first</h2><p className="mt-2 text-sm">Your original {money(draft.acceptedEntryMinor)} request is retained. This checks its server receipt, or atomically cancels it if it never started. It does not create a fresh payment request.</p><button type="button" disabled={busy} onClick={()=>void perform({action:'arcade_cancel',requestKey:draft.requestKey},{resolveDraft:true})} className="mt-4 w-full rounded-xl bg-amber-300 p-3 font-black text-slate-950 disabled:opacity-50">Check entry / cancel if unstarted</button></div>}
      {round?<div className="mt-5 space-y-4 border-t border-white/20 pt-5">
        <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">Attempts used</p><p className="mt-1 text-2xl font-black">{round.attemptsUsed} / {round.attemptCount}</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">Confirmed winnings</p><p className="mt-1 text-2xl font-black">{money(round.paidMinor)}</p></div></div>
        <p className="text-sm">{game==='fruity'?'Free entry':`Entry: ${money(round.entryMinor)}`} · {round.state.replace(/_/g,' ')}{game==='crankling'?` · Chosen number: ${round.prediction.luckyNumber}`:''}</p>
        {game==='dice'&&<p className="text-sm">Your prediction: {round.prediction.comparison} {round.prediction.target} · Stake {money(round.entryMinor)}. Purchased rules remain fixed.</p>}
        {cooldown&&<p className="rounded-xl bg-white/10 p-3 text-sm">Next free window: <time dateTime={round.expiresAt||''}>{new Date(expires).toLocaleString()}</time> · <b>{duration(expires-now)}</b> remaining</p>}
        {round.state==='active'&&!freeExpired&&<button type="button" disabled={!canDraw} onClick={()=>void perform({action:'arcade_draw',roundId:round.id,attemptIndex:round.attemptsUsed+1},{draw:true})} className="w-full rounded-2xl bg-amber-300 p-4 text-lg font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{animating?'Drawing…':busy?'Confirming…':game==='dice'?'Roll your dice':`Play attempt ${round.attemptsUsed+1} of ${round.attemptCount}`}</button>}
        {isPending(round)&&<p role="status">{round.state==='entry_pending'?'Your entry payment is processing.':'Your prize transfer is processing.'} Checking the original receipt automatically…</p>}
        <button type="button" disabled={busy} onClick={()=>void perform({action:'arcade_status',roundId:round.id})} className="rounded-xl border border-white/30 px-4 py-2 font-bold disabled:opacity-50">Check payment status</button>
        {ended&&(!cooldown||game!=='fruity')&&<button type="button" disabled={busy||animating||!!draft||!!storageError} onClick={()=>{dismissedRound.current=round.id;setRound(null);setAccepted(false);setNotice(null);}} className="ml-3 rounded-xl bg-white px-4 py-2 font-bold text-slate-950 disabled:opacity-50">{game==='fruity'?'Start a new free window':'Review a new game'}</button>}
        {ended&&cooldown&&<p className="text-sm text-slate-200">Your free attempts are finished. Return when this window resets.</p>}
      </div>:data?<div className="mt-5 space-y-4 border-t border-white/20 pt-5">
        {game==='dice'&&<div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-bold">Stake (SLE)<input type="text" inputMode="decimal" value={stake} disabled={busy||!!draft} onChange={e=>{setStake(e.target.value);setAccepted(false);}} className="mt-2 w-full rounded-xl border border-white/25 bg-slate-900 p-3 text-white"/></label><label className="text-sm font-bold">Prediction<select value={comparison} disabled={busy||!!draft} onChange={e=>{setComparison(e.target.value as typeof comparison);setAccepted(false);}} className="mt-2 w-full rounded-xl border border-white/25 bg-slate-900 p-3 text-white"><option value="above">Above</option><option value="equal">Equal to</option><option value="below">Below</option></select></label><label className="text-sm font-bold">Dice total<select value={target} disabled={busy||!!draft} onChange={e=>{setTarget(Number(e.target.value));setAccepted(false);}} className="mt-2 w-full rounded-xl border border-white/25 bg-slate-900 p-3 text-white">{Array.from({length:11},(_,i)=><option key={i} value={i+2}>{i+2}</option>)}</select></label></div>}
        {game==='crankling'&&<label className="block text-sm font-bold">Choose your number before paying<select value={lucky} disabled={busy||!!draft} onChange={e=>{setLucky(Number(e.target.value));setAccepted(false);}} className="mt-2 w-full rounded-xl border border-white/25 bg-slate-900 p-3 text-white">{Array.from({length:10},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>}
        {validation&&<p role="alert" className="text-amber-200">{validation}</p>}
        {entry&&<div className="rounded-2xl border border-amber-300/30 bg-white/10 p-4"><p className="flex items-center gap-2 font-black"><CircleDollarSign size={20}/>{entry.entryMinor===0?'Free entry':`Wallet debit: ${money(entry.entryMinor)}`}</p><p className="mt-2 text-sm">Includes {entry.attempts} attempt{entry.attempts===1?'':'s'}. {game==='dice'?`Winning return: ${money(entry.maximumPrizeMinor)}, including your stake. Multiplier ${(entry.quote!.multiplierHundredths/100).toFixed(2)}×. Chance ${(entry.quote!.probability*100).toFixed(4)}% (${entry.quote!.wins} of 36 equally likely combinations).`:`Winning prize: ${money(data.config.settings[game].prizeMinor)} per matching attempt.`}</p></div>}
        {!data.moneyEnabled||!data.config.settings[game].enabled?<p>New entries for this game are paused.</p>:null}
        {!data.eligibility.eligible&&<p className="text-amber-200">{data.eligibility.reason}</p>}
        {entry&&balance!==null&&!affordable&&<p className="text-amber-200">You need {money(entry.entryMinor)} available for this entry.</p>}
        <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={accepted} disabled={busy||!!draft} onChange={e=>setAccepted(e.target.checked)} className="mt-1"/>I am 18 or older and have reviewed this game's entry amount, attempt count, prize chances and rules.</label>
        <button type="button" disabled={!canEnter} onClick={enter} className="w-full rounded-2xl bg-amber-300 p-4 text-lg font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{busy?'Confirming…':entry?.entryMinor===0?'Start my 3 free attempts':entry?`Pay ${money(entry.entryMinor)} — start ${entry.attempts} attempt${entry.attempts===1?'':'s'}`:'Check your settings'}</button>
      </div>:null}
      {rules&&<div className="mt-6 space-y-3 border-t border-white/20 pt-5 text-sm leading-relaxed text-slate-200"><h2 className="flex items-center gap-2 text-lg font-black text-white"><Crown size={20} className="text-amber-200"/>Rules and chances</h2>
        {game==='dice'?<><p>Each die independently rolls 1–6. The total is 2–12, with 36 equally likely combinations. Your selected prediction determines your chance and multiplier. The quoted winning return includes your stake; a losing roll returns zero.</p><p>Published stake range: {money(rules.minStakeMinor)}–{money(rules.maxStakeMinor)}. Daily entry limit: {money(rules.dailyEntryLimitMinor)} (UTC). Target average payout: {(rules.returnBps/100).toFixed(2)}% before multiplier rounding; this is an average across many plays and does not promise a personal return.</p></>:game==='fruity'?<><p>Each of four independent reels draws one of 50 equally likely fruit identities. All four must be identical. Matching colours or matching artwork with different fruit names do not count.</p><p>Win {money(rules.prizeMinor)} with a probability of 1 in 125,000 per attempt (0.0008%). You get three free attempts per rolling 24 hours, beginning when your first game request starts. Unused attempts expire at the reset time. Pending prizes remain owed.</p></>:<><p>Your chosen number is fixed for all three purchased attempts. Each reel independently draws a number from 1–10. All three must equal your chosen number; a different matching triple does not win.</p><p>Each attempt has a 1 in 1,000 chance (0.1%) of winning {money(rules.prizeMinor)}. One {money(round?.entryMinor??rules.entryMinor)} entry buys three attempts. Daily entry limit: {money(rules.dailyEntryLimitMinor)} (UTC).</p></>}
        <p>Entry funds move from your wallet to the dedicated Spin Account. Confirmed prizes move from Spin to your wallet in full. No MatMove winnings fee. Purchased rules stay fixed when Admin publishes future changes.</p><p className="font-bold text-amber-200">18+ · Play responsibly</p>
      </div>}
    </div>
    {round&&<div className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-black">Your game receipts</h2><p className="mt-2 break-all font-mono text-xs text-slate-500">Game ID: {round.id}</p>{round.receipts.length===0&&<p className="mt-3 text-sm text-slate-600">Free entry — no wallet debit.</p>}{round.receipts.map(r=><div key={r.index} className="mt-3 border-t pt-3"><p className="font-bold">{r.kind==='entry'?'Game entry payment':`Attempt ${r.index} winning`}: {money(r.amountMinor)}</p><p className="mt-1 text-sm text-slate-600">{r.status==='completed'?r.kind==='entry'?'Confirmed paid to Spin Account':'Confirmed credited to your wallet':`Payment ${r.status.replace(/_/g,' ')}`}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{r.providerId||'Provider receipt not confirmed yet'}</p>{r.error&&<p role="alert" className="mt-1 text-sm text-red-700">{r.error}</p>}</div>)}</div>}
  </section>;
}
