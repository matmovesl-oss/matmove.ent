import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bike, Car, ChevronLeft, ChevronRight, MapPin, Package, Store, Truck, Navigation, Sparkles } from 'lucide-react';

const journeys=[
 {from:'Freetown',via:'Aberdeen · Lumley',to:'Central Freetown',label:'CITY RIDES',detail:'Move across the capital with a ride that meets you where you are.'},
 {from:'Bo',via:'Mile 91 · Masiaka',to:'Kenema',label:'INTERCITY',detail:'Connect towns and districts with journeys made easier.'},
 {from:'Makeni',via:'Lunsar · Port Loko',to:'Freetown',label:'DELIVERY & TRAVEL',detail:'Keep people, packages and local businesses moving.'}
];

const services=[
 {name:'Ride',detail:'Go where life takes you.',icon:Car},
 {name:'Earn',detail:'Drive and grow with MatMove.',icon:Navigation},
 {name:'Food',detail:'Discover local food and shops.',icon:Store},
 {name:'Package',detail:'Send parcels across town.',icon:Package},
 {name:'Rental',detail:'Find a vehicle for longer trips.',icon:Truck},
 {name:'Travel',detail:'Plan journeys beyond the city.',icon:Bike}
];

export function LandingPage(){
 const navigate=useNavigate();
 const [journey,setJourney]=useState(0);
 useEffect(()=>{
  const timer=window.setInterval(()=>setJourney(current=>(current+1)%journeys.length),5200);
  return()=>window.clearInterval(timer);
 },[]);
 const item=journeys[journey];
 const change=(step:number)=>setJourney(current=>(current+step+journeys.length)%journeys.length);
 return <main className="min-h-screen overflow-hidden bg-[#f5f8f7] font-sans text-slate-950">
  <nav className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
   <a href="/" className="flex items-center gap-3" aria-label="MatMove home"><img src="/logo.jpg" alt="MatMove" className="h-12 w-auto object-contain"/><span className="hidden text-xs font-bold uppercase tracking-[.2em] text-emerald-800 sm:block">Move with possibility</span></a>
   <div className="flex items-center gap-2"><button onClick={()=>navigate('/login')} className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-700 hover:bg-white">Log in</button><button onClick={()=>navigate('/signup')} className="min-h-11 rounded-xl bg-[#1554a0] px-5 text-sm font-bold text-white shadow-lg shadow-blue-900/15 hover:bg-[#10427f]">Get started <ArrowRight className="ml-1 inline" size={16}/></button></div>
  </nav>

  <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[.92fr_1.08fr] lg:gap-14 lg:pb-24 lg:pt-14">
   <div className="relative z-10">
    <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[.16em] text-emerald-800"><Sparkles size={15}/> Sierra Leone moves with MatMove</p>
    <h1 className="max-w-2xl text-5xl font-black leading-[1.02] tracking-[-.045em] text-slate-950 sm:text-6xl lg:text-7xl">Your world moves. <span className="text-[#168163]">MatMove moves with you.</span></h1>
    <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">One connected place for rides, earning, food, deliveries, rentals and travel. Built around the way Sierra Leone moves.</p>
    <div className="mt-8 flex flex-wrap gap-3"><button onClick={()=>navigate('/signup')} className="inline-flex min-h-14 items-center gap-3 rounded-2xl bg-[#1554a0] px-7 text-base font-bold text-white shadow-xl shadow-blue-900/20 transition hover:-translate-y-0.5 hover:bg-[#10427f]">Create your account <ArrowRight size={19}/></button><button onClick={()=>navigate('/login')} className="min-h-14 rounded-2xl border border-slate-300 bg-white px-7 font-bold text-slate-800 hover:border-slate-400">I already have an account</button></div>
    <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-slate-500"><span>Ride across town</span><span>Earn on your schedule</span><span>Support local business</span></div>
   </div>

   <div className="relative min-w-0">
    <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-br from-emerald-200/80 via-sky-100 to-blue-100 blur-2xl"/>
    <section className="relative overflow-hidden rounded-[2.25rem] border border-white/60 bg-[#0c1e31] p-5 text-white shadow-[0_28px_90px_rgba(10,34,56,.28)] sm:p-7" aria-label="Animated MatMove journeys">
     <div className="flex items-center justify-between gap-3"><span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-black tracking-[.18em] text-emerald-200">{item.label}</span><div className="flex items-center gap-1.5 text-xs text-slate-300"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"/> LIVE ROUTE PREVIEW</div></div>
     <div className="relative mt-6 h-[290px] overflow-hidden rounded-[1.7rem] border border-white/10 bg-[#102b43] sm:h-[330px]">
      <div className="absolute inset-0 opacity-50" style={{backgroundImage:'linear-gradient(rgba(154,193,205,.09) 1px, transparent 1px),linear-gradient(90deg,rgba(154,193,205,.09) 1px,transparent 1px)',backgroundSize:'32px 32px'}}/>
      <svg viewBox="0 0 680 330" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
       <path d="M-30 265 C68 220 108 292 201 226 S333 82 418 151 S550 250 713 61" fill="none" stroke="#24546a" strokeWidth="34" strokeLinecap="round"/>
       <path d="M-30 265 C68 220 108 292 201 226 S333 82 418 151 S550 250 713 61" fill="none" stroke="#c5e4dc" strokeWidth="2.5" strokeDasharray="9 13" strokeLinecap="round"/>
       <path d="M50 48 C115 90 176 37 244 77 S363 120 452 55" fill="none" stroke="#315b72" strokeWidth="9" strokeLinecap="round"/>
       <path d="M50 48 C115 90 176 37 244 77 S363 120 452 55" fill="none" stroke="#7698a4" strokeWidth="1.5" strokeDasharray="5 9"/>
       <g fill="#8de0bf"><circle cx="78" cy="250" r="7"/><circle cx="418" cy="151" r="7"/><circle cx="630" cy="102" r="7"/></g>
       <g fill="#d8e9e8" opacity=".22"><circle cx="78" cy="250" r="20"/><circle cx="418" cy="151" r="20"/><circle cx="630" cy="102" r="20"/></g>
      </svg>
      <div className="absolute left-[7%] top-[69%] rounded-xl border border-white/10 bg-[#0b1d2e]/90 px-3 py-2 backdrop-blur"><p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Start</p><p className="mt-0.5 text-sm font-bold">{item.from}</p></div>
      <div className="absolute left-[54%] top-[36%] rounded-xl border border-white/10 bg-[#0b1d2e]/90 px-3 py-2 backdrop-blur"><p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Passing</p><p className="mt-0.5 text-sm font-bold">{item.via.split(' · ')[0]}</p></div>
      <div className="absolute bottom-[10%] right-[5%] rounded-xl border border-white/10 bg-[#0b1d2e]/90 px-3 py-2 backdrop-blur"><p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Destination</p><p className="mt-0.5 text-sm font-bold">{item.to}</p></div>
      <svg viewBox="0 0 680 330" className="mm-landing-car-svg pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden="true"><g transform="translate(-18 -12)"><rect x="-15" y="-7" width="30" height="14" rx="5" fill="#a7f3d0" stroke="#063b35" strokeWidth="1.5"/><path d="M-9 -7L-5 -12H6L11 -7" fill="#d1fae5" stroke="#063b35" strokeWidth="1.3"/><circle cx="-8" cy="8" r="3" fill="#082f49"/><circle cx="8" cy="8" r="3" fill="#082f49"/><animateMotion dur="5.2s" repeatCount="indefinite" rotate="auto" path="M78 250 C68 220 108 292 201 226 S333 82 418 151 S550 250 630 102"/></g></svg>
      <div className="absolute bottom-4 left-4 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-slate-200 backdrop-blur">Illustrative route preview · not live tracking</div>
     </div>
     <div className="mt-5 flex items-center justify-between gap-4">
      <div className="min-w-0"><p className="text-lg font-extrabold">{item.from} <span className="text-emerald-300">→</span> {item.to}</p><p className="mt-1 text-sm leading-5 text-slate-300">{item.detail}</p></div>
      <div className="flex shrink-0 gap-2"><button type="button" onClick={()=>change(-1)} aria-label="Previous route" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 hover:bg-white/10"><ChevronLeft size={19}/></button><button type="button" onClick={()=>change(1)} aria-label="Next route" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 hover:bg-white/10"><ChevronRight size={19}/></button></div>
     </div>
     <div className="mt-4 flex gap-2">{journeys.map((j,i)=><button key={j.from} type="button" aria-label={'Show '+j.from+' route'} aria-current={i===journey?'true':undefined} onClick={()=>setJourney(i)} className={i===journey?'h-1.5 flex-1 rounded-full bg-emerald-300':'h-1.5 flex-1 rounded-full bg-white/20'}/>)}</div>
    </section>
   </div>
  </section>

  <section className="border-y border-slate-200 bg-white py-16 sm:py-20">
   <div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="mb-9 max-w-2xl"><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">One platform, many ways to move</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">More than a ride. A whole city connected.</h2><p className="mt-3 leading-7 text-slate-500">Start with what you need today. Your MatMove account brings your services and activity together.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{services.map((service,i)=>{const Icon=service.icon;return <div key={service.name} className="group rounded-3xl border border-slate-200 bg-[#fbfdfc] p-5 transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800"><Icon size={22}/></div><h3 className="mt-4 text-lg font-extrabold">{service.name}</h3><p className="mt-1 text-sm text-slate-500">{service.detail}</p></div>})}</div>
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-[#eaf4f1] p-6"><div><h3 className="text-xl font-black">Ready to move with MatMove?</h3><p className="mt-1 text-sm text-slate-600">Create your account and choose the services that fit you.</p></div><button onClick={()=>navigate('/signup')} className="min-h-12 rounded-xl bg-[#1554a0] px-5 font-bold text-white">Get started <ArrowRight className="ml-1 inline" size={17}/></button></div>
   </div>
  </section>
  <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-xs text-slate-500 sm:px-8"><span>© {new Date().getFullYear()} MatMove · Sierra Leone</span><span>Moving people, businesses and communities forward.</span></footer>
 </main>;
}
