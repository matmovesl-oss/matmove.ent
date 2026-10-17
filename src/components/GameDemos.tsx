
import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight, CirclePlay, Crown, Diamond, Dice5, RefreshCw, Sparkles, Trophy, X} from 'lucide-react';
import {defaultBundleTiers, validateBundleTiers, sampleBundle, type BundleSector} from '../../shared/bundle-spin-rules.js';
import {defaultArcadeSettings, validateArcadeSettings, arcadeEntry, arcadeResult, drawArcadeValues, type ArcadeSettings, type DiceQuote} from '../../shared/arcade-payment-rules.js';
import {FRUITS, FRUITY_ATTEMPTS, FRUITY_PERIOD_MS, CRANKLING_ATTEMPTS, CRANKLING_ENTRY_MINOR, secureDraw, fruityOutcome, cranklingOutcome, diceQuote, diceOutcome, fruityWindow, takeFruityAttempt, type GameId, type Comparison, type FruityWindow} from '../../shared/arcade-rules.js';

const games = [
 {id:'spin' as GameId, name:'MatMove Spin', subtitle:'A little colour. A little chance.', icon:Crown, colour:'from-violet-600 via-indigo-700 to-slate-950', tags:'Three wheels · One spin per entry'},
 {id:'dice' as GameId, name:'RICH DICE', subtitle:'Gold edges. Diamond possibilities.', icon:Diamond, colour:'from-amber-700 via-stone-800 to-slate-950', tags:'Two dice · Above, equal or below'},
 {id:'fruity' as GameId, name:'Fruity Flue', subtitle:'Four reels. Fifty different fruits.', icon:Sparkles, colour:'from-emerald-600 via-teal-800 to-slate-950', tags:'Free game · Three attempts in 24 hours'},
 {id:'crankling' as GameId, name:'CRANKLING', subtitle:'Your number. Three perfect matches.', icon:Dice5, colour:'from-cyan-600 via-blue-800 to-slate-950', tags:'Pick 1–10 · Three attempts per entry'},
];
const credits = (minor:number) => (minor / 100).toLocaleString(undefined,{maximumFractionDigits:2});
const previewTiers = defaultBundleTiers();
const previewSettings = defaultArcadeSettings();
type Published = {id:number;settings:ArcadeSettings;tiers:ReturnType<typeof defaultBundleTiers>;wheelId:number};
const key = 'matmove-demo-fruity-v1';
type DemoResult = {title:string;detail:string;prizeMinor:number};
function readWindow():FruityWindow {
 try { return fruityWindow(JSON.parse(window.localStorage.getItem(key)||'null')); }
 catch { return {startedAt:0,used:0}; }
}
function readFruitPrize():number {
 try {const v=JSON.parse(window.localStorage.getItem(key)||'null');return Number.isSafeInteger(v?.prizeMinor)&&v.prizeMinor>=100&&v.prizeMinor<=100000?v.prizeMinor:5000;}catch{return 5000;}
}
function clock(ms:number) {
 const seconds=Math.max(0,Math.ceil(ms/1000));
 return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
}
function Die({value, rolling}:{value:number;rolling:boolean}) {
 const dots:Record<number,number[]>={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
 return <div aria-label={`Die ${value}`} className={`grid aspect-square w-24 grid-cols-3 gap-2 rounded-3xl border border-amber-100/70 bg-gradient-to-br from-white via-stone-100 to-stone-400 p-4 shadow-[0_16px_35px_#0008] sm:w-32 sm:gap-3 sm:p-5 ${rolling?'mm-demo-dice-rolling':''}`} style={{transform:`rotate(${value%2?'-8':'8'}deg)`}}>{Array.from({length:9},(_,i)=><span key={i} className={`rounded-full ${dots[value].includes(i)?'bg-slate-900 shadow-inner':'bg-transparent'}`}/>)}</div>;
}
function Wheel({sectors,rotation,small=false}:{sectors:BundleSector[];rotation:number;small?:boolean}) {
 const palette=['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ec4899','#475569'];
 const point=(angle:number,radius:number)=>[150+radius*Math.cos(angle*Math.PI/180),150+radius*Math.sin(angle*Math.PI/180)];
 return <div className={`relative mx-auto ${small?'w-32':'w-full max-w-[310px]'}`} aria-label="Demo prize wheel">
  <div className="absolute -top-2 left-1/2 z-10 h-7 w-7 -translate-x-1/2 bg-amber-200 shadow-lg" style={{clipPath:'polygon(0 0,100% 0,50% 100%)'}}/>
  <svg viewBox="0 0 300 300" className="w-full rounded-full border-[6px] border-amber-200 shadow-[0_0_45px_#a78bfa40] transition-transform duration-1000 motion-reduce:transition-none" style={{transform:`rotate(${rotation}deg)`,transitionTimingFunction:'cubic-bezier(.12,.75,.13,1)'}} role="img" aria-label={sectors.map(s=>s.kind==='cash'?`${credits(s.prizeMinor)} credits`:s.kind==='again'?'Spin again':'No prize').join(', ')}>
   {sectors.map((s,i)=>{const start=-90+i*360/sectors.length,end=start+360/sectors.length,mid=(start+end)/2,a=point(start,144),b=point(end,144),label=point(mid,100);return <g key={s.digit}><path d={`M150 150 L${a[0]} ${a[1]} A144 144 0 0 1 ${b[0]} ${b[1]} Z`} fill={palette[i%palette.length]} stroke="#ffffff40"/><text x={label[0]} y={label[1]} fill="white" fontSize={s.kind==='cash'?24:13} fontWeight="800" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid+90},${label[0]},${label[1]})`}>{s.kind==='cash'?credits(s.prizeMinor):s.kind==='again'?'AGAIN':'NO PRIZE'}</text></g>;})}
   <circle cx="150" cy="150" r="26" fill="#0f172a" stroke="#fde68a" strokeWidth="4"/><text x="150" y="156" textAnchor="middle" fill="#fde68a" fontWeight="900" fontSize="16">M</text>
  </svg>
 </div>;
}

export default function GameDemos() {
 const [published,setPublished]=useState<Published|null>(null),[settingsNotice,setSettingsNotice]=useState('Preview defaults — published settings are loading.');
 const tiers=published?.tiers||previewTiers,settings=published?.settings||previewSettings;
 const [wheelSnapshot,setWheelSnapshot]=useState<ReturnType<typeof defaultBundleTiers>[number]|null>(null);
 const [crankRules,setCrankRules]=useState<ArcadeSettings['crankling']|null>(null);
 const [fruitPrize,setFruitPrize]=useState(readFruitPrize);
 const [active,setActive]=useState<GameId|null>(null),[busy,setBusy]=useState(false),[result,setResult]=useState<DemoResult|null>(null),[error,setError]=useState('');
 const [history,setHistory]=useState<Array<DemoResult&{game:string}>>([]);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),lock=useRef(false),panel=useRef<HTMLDivElement>(null);
 const [tier,setTier]=useState(0),[bonus,setBonus]=useState(false),[rotation,setRotation]=useState(0);
 const keepBonus=useRef(false);keepBonus.current=bonus;
 const [target,setTarget]=useState(7),[comparison,setComparison]=useState<Comparison>('above'),[stake,setStake]=useState('5'),[dice,setDice]=useState([3,4]);
 const [fruitState,setFruitState]=useState<FruityWindow>(readWindow),[now,setNow]=useState(Date.now),[fruits,setFruits]=useState([0,5,7,10]);
 const [lucky,setLucky]=useState(5),[remaining,setRemaining]=useState(CRANKLING_ATTEMPTS),[lockedLucky,setLockedLucky]=useState<number|null>(null),[numbers,setNumbers]=useState([1,5,10]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);lock.current=false;},[]);
 useEffect(()=>{
  let live=true,sequence=0;const pending=new Set<AbortController>();
  const load=async()=>{
   if(lock.current)return;const n=++sequence,controller=new AbortController();pending.add(controller);
   const timeout=window.setTimeout(()=>controller.abort(),10000);
   try {
    const response=await fetch('/api/get-live-wallet?action=arcade_public',{method:'GET',credentials:'omit',signal:controller.signal});
    const body=await response.json();if(!response.ok||!body?.config||!body?.spin||!Number.isSafeInteger(body.config.id)||!Number.isSafeInteger(body.spin.id))throw new Error('Published settings unavailable.');
    const next={id:body.config.id,settings:validateArcadeSettings(body.config.settings),tiers:validateBundleTiers(body.spin.tiers),wheelId:body.spin.id};
    if(live&&n===sequence&&!lock.current){setPublished(next);if(!keepBonus.current)setWheelSnapshot(null);setSettingsNotice(`Published game settings v${next.id} · wheel v${next.wheelId}. Demos remain free, even when account entries are paused.`);}
   } catch {if(live&&n===sequence)setSettingsNotice('Published settings could not be refreshed. Any previously loaded settings remain in use; otherwise these are preview defaults. Account play always checks the current server rules.');}
   finally {window.clearTimeout(timeout);pending.delete(controller);}
  };
  void load();const interval=window.setInterval(()=>{if(!document.hidden)void load();},15000);
  return()=>{live=false;sequence++;window.clearInterval(interval);for(const controller of pending)controller.abort();};
 },[]);

 useEffect(()=>{
  if(!fruitState.startedAt)return;
  const t=setInterval(()=>{const time=Date.now();setNow(time);setFruitState(old=>fruityWindow(old,time));},1000);
  return()=>clearInterval(t);
 },[fruitState.startedAt]);
 useEffect(()=>{
  const update=(event:StorageEvent)=>{if(event.key===key){setFruitState(readWindow());setFruitPrize(readFruitPrize());}};
  window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);
 },[]);
 useEffect(()=>{if(active)panel.current?.focus({preventScroll:true});},[active]);
 let quote:DiceQuote|null=null,quoteError='';
 const stakeMinor=/^\d+(\.\d{1,2})?$/.test(stake)?Math.round(Number(stake)*100):NaN;
 try {quote=arcadeEntry('dice',{stakeMinor,target,comparison},settings).quote||null;}catch(e){quoteError=e instanceof Error?e.message:'Choose your prediction.';}
 const windowState=fruityWindow(fruitState,now),fruitRemaining=FRUITY_ATTEMPTS-windowState.used;
 const currentTier=wheelSnapshot||tiers[tier],wheelSectors=bonus?currentTier.sectors.filter(s=>s.kind!=='again'):currentTier.sectors;
 const current=games.find(g=>g.id===active);
 function show(outcome:DemoResult) {
  setResult(outcome);setHistory(old=>[{...outcome,game:current?.name||'Demo'},...old].slice(0,5));
 }
 function play() {
  if(lock.current||!active)return;
  lock.current=true;setError('');setResult(null);
  try {
   let finish:()=>void;
   if(active==='spin') {
    const chosenTier=bonus?currentTier:tiers[tier];setWheelSnapshot(chosenTier);
    const shownSectors=bonus?chosenTier.sectors.filter(s=>s.kind!=='again'):chosenTier.sectors;
    const sectorIndex=sampleBundle(chosenTier.sectors,secureDraw,bonus),sector=chosenTier.sectors[sectorIndex];
    const displayed=shownSectors.findIndex(s=>s.digit===sector.digit),angle=360/shownSectors.length;
    const desired=(360-(displayed+.5)*angle)%360;
    setRotation(old=>old+1440+(desired-old%360+360)%360);
    finish=()=>{setBonus(sector.kind==='again');show({title:sector.kind==='again'?'One free bonus spin':sector.kind==='cash'?'Demo win!':'No prize this time',detail:sector.kind==='again'?'Use your one free bonus spin. The bonus draws only from the four cash segments.':'One paid-entry demo spin is complete. All prizes are virtual.',prizeMinor:sector.prizeMinor});};
   } else if(active==='dice') {
    const outcome=arcadeResult('dice',drawArcadeValues('dice',secureDraw),{stakeMinor,target,comparison},settings.dice);
    finish=()=>{setDice(outcome.values);show({title:outcome.prizeMinor?'Demo win!':'No win this roll',detail:`Dice total ${outcome.total}. Your prediction: ${comparison} ${target}. Any winning return includes the demo stake.`,prizeMinor:outcome.prizeMinor});};
   } else if(active==='fruity') {
    const oldWindow=readWindow(),state=takeFruityAttempt(oldWindow);
    let prize=oldWindow.startedAt?fruitPrize:settings.fruity.prizeMinor;
    try {const saved=JSON.parse(window.localStorage.getItem(key)||'null');if(oldWindow.startedAt&&saved?.startedAt===oldWindow.startedAt&&Number.isSafeInteger(saved.prizeMinor)&&saved.prizeMinor>=100&&saved.prizeMinor<=100000)prize=saved.prizeMinor;}catch{/* Keep the existing window prize. */}
    const outcome=arcadeResult('fruity',drawArcadeValues('fruity',secureDraw),{},{...settings.fruity,prizeMinor:prize});
    try {window.localStorage.setItem(key,JSON.stringify({...state,prizeMinor:prize}));}catch{throw new Error('Enable browser storage to keep your three demo attempts and reset timer.');}
    setFruitState(state);setFruitPrize(prize);setNow(Date.now());
    finish=()=>{setFruits(outcome.values);show({title:outcome.prizeMinor?'Four fruits matched!':'No four-fruit match',detail:outcome.prizeMinor?'You matched four identical fruits. Demo prize only.':'All four fruit names must match. Each column independently draws from 50 fruits.',prizeMinor:outcome.prizeMinor});};
   } else {
    if(remaining<=0)throw new Error('Start a new demo set to try again.');
    const chosen=lockedLucky??lucky,rules=crankRules||settings.crankling,outcome=arcadeResult('crankling',drawArcadeValues('crankling',secureDraw),{luckyNumber:chosen},rules);
    if(!crankRules)setCrankRules({...rules});
    setLockedLucky(chosen);setRemaining(old=>old-1);
    finish=()=>{setNumbers(outcome.values);show({title:outcome.prizeMinor?'Your lucky number matched!':'No winning match',detail:`Chosen number: ${chosen}. All three columns must show ${chosen}; another matching number does not win.`,prizeMinor:outcome.prizeMinor});};
   }
   setBusy(true);
   timer.current=setTimeout(()=>{finish();setBusy(false);lock.current=false;timer.current=null;},1100);
  } catch(e) {setError(e instanceof Error?e.message:'Demo unavailable. Try again.');setBusy(false);lock.current=false;}
 }
 const buttonClass='rounded-2xl bg-amber-200 px-6 py-4 font-extrabold text-slate-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40';
 const inputClass='mt-2 w-full rounded-xl border border-white/20 bg-slate-900 px-4 py-3 text-white';
 return <section aria-labelledby="demo-games-title" className="relative overflow-hidden border-y border-slate-200 bg-[#080c18] px-4 py-10 text-white sm:px-6 lg:py-14">
  <style>{`@keyframes mm-demo-dice-roll{0%{transform:rotate(-12deg) translateY(0)}25%{transform:rotate(85deg) translateY(-14px)}65%{transform:rotate(205deg) translateY(4px)}100%{transform:rotate(348deg) translateY(0)}}@keyframes mm-demo-reel-roll{0%,100%{transform:translateY(0);filter:blur(0)}50%{transform:translateY(-8px);filter:blur(1px)}}.mm-demo-dice-rolling{animation:mm-demo-dice-roll .45s linear infinite}.mm-demo-reel-rolling{animation:mm-demo-reel-roll .18s linear infinite}@media(prefers-reduced-motion:reduce){.mm-demo-dice-rolling,.mm-demo-reel-rolling{animation:none}}`}</style>
  <div className="pointer-events-none absolute -right-28 top-0 h-80 w-80 rounded-full bg-violet-700/20 blur-3xl"/>
  <div className="relative mx-auto max-w-7xl">
   <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.22em] text-amber-200"><Sparkles size={15}/>The MatMove play lounge</p><h1 id="demo-games-title" className="text-3xl font-black tracking-tight sm:text-4xl">Four games. Your kind of fun.</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">Explore every game for free. These demos use virtual credits with no cash value. No wallet is connected.</p></div><span className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300">18+ · Play responsibly</span></div>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
    {games.map(g=>{const Icon=g.icon;return <button key={g.id} type="button" aria-expanded={active===g.id} aria-controls="demo-game-panel" disabled={busy} onClick={()=>{setActive(g.id);setResult(null);setError('');}} className={`group relative flex min-h-[230px] flex-col overflow-hidden rounded-3xl border p-4 text-left transition hover:-translate-y-1 disabled:opacity-50 sm:p-5 ${active===g.id?'border-amber-200 ring-2 ring-amber-200/30':'border-white/15'} bg-gradient-to-br ${g.colour}`}>
     <div className="flex items-start justify-between"><Icon size={28} className="text-amber-100"/><span className="rounded-full bg-black/25 px-2 py-1 text-[9px] font-black tracking-widest text-white">DEMO</span></div>
     <div className="my-5 flex h-12 items-center justify-center text-4xl" aria-hidden="true">{g.id==='spin'?'◉':g.id==='dice'?'⚄ ⚂':g.id==='fruity'?'🍒 🍋':<span className="font-black tracking-wider text-cyan-100">7 7 7</span>}</div>
     <h2 className="mt-auto text-lg font-black leading-tight sm:text-xl">{g.name}</h2><p className="mt-2 hidden text-xs text-white/65 sm:block">{g.tags}</p><span className="mt-4 flex items-center gap-2 text-xs font-extrabold text-amber-100"><CirclePlay size={17}/>Play free demo</span>
    </button>;})}
   </div>
   {active&&current&&<div id="demo-game-panel" ref={panel} tabIndex={-1} aria-label={`${current.name} demo`} className="mt-6 overflow-hidden rounded-[2rem] border border-white/15 bg-slate-950/80 outline-none focus-visible:ring-2 focus-visible:ring-amber-200">
    <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-5 py-4 sm:px-8"><div><p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Free demo · No cash prizes</p><h2 className="mt-1 text-xl font-black sm:text-2xl">{current.name}</h2></div><button type="button" disabled={busy} onClick={()=>setActive(null)} aria-label="Close game demo" className="rounded-xl border border-white/15 p-2 disabled:opacity-40"><X size={20}/></button></div>
    <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_300px]">
     <div className="min-w-0 space-y-6">
      {active==='spin'&&<><div className="flex flex-wrap justify-center gap-2">{tiers.map((t,i)=><button key={t.id} type="button" disabled={busy||bonus} onClick={()=>{setTier(i);setWheelSnapshot(null);setRotation(0);setResult(null);}} className={`rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-40 ${tier===i?'border-amber-200 bg-amber-200/10 text-amber-100':'border-white/15 text-slate-300'}`}>{credits(t.entryMinor)} demo credits</button>)}</div><Wheel sectors={wheelSectors} rotation={rotation}/><p className="text-center text-sm text-slate-300">{bonus?'One free bonus: four cash segments, each with a 25% chance.':`Each of the ${wheelSectors.length} segments has the same chance. One spin per demo entry.`}</p><div className="text-center"><button type="button" disabled={busy} onClick={play} className={buttonClass}>{busy?'Spinning…':bonus?'Use free bonus spin':'Spin demo wheel'}</button></div></>}
      {active==='dice'&&<><div className="flex min-h-[190px] items-center justify-center gap-8 rounded-3xl border border-amber-200/10 bg-gradient-to-br from-amber-200/10 via-slate-900 to-slate-950"><Die value={dice[0]} rolling={busy}/><Die value={dice[1]} rolling={busy}/></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Demo stake ({credits(settings.dice.minStakeMinor)}–{credits(settings.dice.maxStakeMinor)} credits)<input value={stake} disabled={busy} inputMode="decimal" onChange={e=>setStake(e.target.value)} className={inputClass}/></label><label className="text-sm font-bold">Target total (2–12)<select value={target} disabled={busy} onChange={e=>setTarget(Number(e.target.value))} className={inputClass}>{Array.from({length:11},(_,i)=><option key={i} value={i+2}>{i+2}</option>)}</select></label></div><div className="grid grid-cols-3 gap-2">{(['above','equal','below'] as Comparison[]).map(c=><button key={c} type="button" disabled={busy} aria-pressed={comparison===c} onClick={()=>setComparison(c)} className={`rounded-xl border p-3 text-sm font-bold capitalize ${comparison===c?'border-amber-200 bg-amber-200/10 text-amber-100':'border-white/15 text-slate-300'}`}>{c}</button>)}</div>{quote?<div className="flex flex-wrap justify-between gap-3 rounded-xl bg-white/5 p-4 text-sm"><span>Chance: <b>{(quote.probability*100).toFixed(2)}%</b></span><span>Multiplier: <b>×{(quote.multiplierHundredths/100).toFixed(2)}</b></span><span>Total return: <b>{credits(quote.payoutMinor)} credits</b></span></div>:<p role="alert" className="text-amber-200">{quoteError}</p>}<p className="text-xs text-slate-400">Two independent dice. The winning return includes your demo stake. No win is guaranteed.</p><button type="button" disabled={busy||!quote} onClick={play} className={`${buttonClass} w-full`}>{busy?'Rolling…':'Roll RICH DICE demo'}</button></>}
      {active==='fruity'&&<><div className="grid grid-cols-4 gap-2 rounded-3xl border border-emerald-200/15 bg-emerald-950/20 p-3 sm:gap-4 sm:p-6">{fruits.map((id,i)=><div key={i} className={`flex min-h-[145px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-black/30 px-1 text-center ${busy?'mm-demo-reel-rolling':''}`}><span className="text-3xl sm:text-5xl" aria-hidden="true">{FRUITS[id].icon}</span><b className="mt-4 text-[10px] sm:text-xs">{FRUITS[id].name}</b></div>)}</div><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-4 text-sm"><b>{fruitRemaining} of 3 demo attempts left</b>{windowState.startedAt>0&&<span>Resets in {clock(windowState.startedAt+FRUITY_PERIOD_MS-now)}</span>}</div><p className="text-sm leading-relaxed text-slate-300">Match all four fruit names for <b className="text-amber-100">{credits(windowState.startedAt?fruitPrize:settings.fruity.prizeMinor)} virtual credits</b>. Every column draws from 50 equally likely fruits. Chance per attempt: <b>1 in 125,000</b>. Three attempts; the 24-hour timer starts on the first.</p><button type="button" disabled={busy||fruitRemaining===0} onClick={play} className={`${buttonClass} w-full`}>{busy?'Revealing fruits…':fruitRemaining?'Play Fruity Flue demo':'Three attempts used — waiting for reset'}</button><p className="text-xs text-slate-400">The demo limit is stored in this browser. Real reward eligibility and attempt limits will be verified by the server.</p></>}
      {active==='crankling'&&<><div className="grid grid-cols-3 gap-3 rounded-3xl border border-cyan-200/15 bg-gradient-to-b from-cyan-950/40 to-slate-950 p-5 sm:p-8">{numbers.map((n,i)=><div key={i} className={`flex min-h-[130px] items-center justify-center rounded-2xl border border-cyan-100/20 bg-slate-900 text-5xl font-black text-cyan-100 shadow-inner sm:text-7xl ${busy?'mm-demo-reel-rolling':''}`}>{n}</div>)}</div><div className="grid items-end gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Your lucky number<select value={lockedLucky??lucky} disabled={busy||lockedLucky!==null} onChange={e=>setLucky(Number(e.target.value))} className={inputClass}>{Array.from({length:10},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label><p className="rounded-xl bg-white/5 p-4 text-sm"><b>{remaining} of 3 attempts left</b><br/><span className="text-slate-400">Demo entry: {credits((crankRules||settings.crankling).entryMinor)} virtual credits</span></p></div><p className="text-sm leading-relaxed text-slate-300">All three columns must land on <b className="text-cyan-100">your chosen number</b> for {credits((crankRules||settings.crankling).prizeMinor)} virtual credits. The number stays fixed for the set. Chance per attempt: <b>1 in 1,000</b>.</p>{remaining>0?<button type="button" disabled={busy} onClick={play} className={`${buttonClass} w-full`}>{busy?'Rolling numbers…':'Play CRANKLING demo'}</button>:<button type="button" disabled={busy} onClick={()=>{setRemaining(CRANKLING_ATTEMPTS);setLockedLucky(null);setCrankRules(null);setResult(null);}} className={`${buttonClass} flex w-full items-center justify-center gap-2`}><RefreshCw size={18}/>Start a new three-attempt demo set</button>}</>}
      {error&&<p role="alert" className="rounded-xl border border-red-300/30 bg-red-500/10 p-4 text-red-200">{error}</p>}
      {result&&<div role="status" aria-live="polite" className={`relative rounded-2xl border p-5 ${result.prizeMinor?'border-amber-200/50 bg-amber-200/10':'border-white/15 bg-white/5'}`}><div className="flex items-center gap-3"><Trophy size={24} className={result.prizeMinor?'text-amber-200':'text-slate-400'}/><h3 className="text-xl font-black">{result.title}</h3></div>{result.prizeMinor>0&&<p className="mt-3 text-3xl font-black text-amber-100">+{credits(result.prizeMinor)} virtual credits</p>}<p className="mt-3 text-sm leading-relaxed text-slate-300">{result.detail}</p><p className="mt-2 text-xs font-bold text-amber-100">DEMO RESULT — no money credited or debited.</p></div>}
     </div>
     <aside className="space-y-5 rounded-2xl border border-white/10 bg-white/[.03] p-5"><div className="flex items-center gap-2 text-amber-200"><Diamond size={20}/><h3 className="font-extrabold">Just exploring?</h3></div><p className="text-sm leading-relaxed text-slate-300">You are playing for fun. Virtual credits cannot be withdrawn or added to a wallet.</p><Link to="/signup" className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-slate-950">Create an account<ArrowRight size={16}/></Link><Link to="/login" className="block rounded-xl border border-white/20 px-4 py-3 text-center text-sm font-bold">Log in for real play</Link><p className="text-xs leading-relaxed text-slate-400">Real-money play requires an eligible account, sufficient funds where an entry fee applies, and an available game. Demo results never become real prizes.</p><div className="border-t border-white/10 pt-4"><h3 className="mb-3 text-sm font-bold">Your recent demo results</h3>{!history.length?<p className="text-xs text-slate-400">Play a demo to see your own results here.</p>:<ul className="space-y-3">{history.map((h,i)=><li key={i} className="flex justify-between gap-3 text-xs"><span className="text-slate-400">{h.game}</span><b className={h.prizeMinor?'text-amber-100':'text-slate-300'}>{h.prizeMinor?`+${credits(h.prizeMinor)} credits`:'No cash prize'}</b></li>)}</ul>}</div></aside>
    </div>
   </div>}
   <p className="mt-5 text-center text-xs text-slate-400">All four games are free demos here. {settingsNotice} Started demo sets keep their original prize settings. Demo results never credit or debit money.</p>
  </div>
 </section>;
}
