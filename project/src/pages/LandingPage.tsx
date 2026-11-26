import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bike, Car, ChevronLeft, ChevronRight, MapPin, Package, Store, Truck, Navigation, Sparkles, Trophy, Download, Smartphone, ShieldCheck } from 'lucide-react';
import PublicHomepagePosts from '@/components/PublicHomepagePosts';
import GalaRegistration from '@/components/GalaRegistration';

const journeys=[
 {from:'Freetown',via:'Aberdeen · Lumley',to:'Central Freetown',label:'CITY RIDES',detail:'Move across the capital with a ride that meets you where you are.'},
 {from:'Bo',via:'Mile 91 · Masiaka',to:'Kenema',label:'INTERCITY',detail:'Connect towns and districts with journeys made easier.'},
 {from:'Makeni',via:'Lunsar · Port Loko',to:'Freetown',label:'DELIVERY & TRAVEL',detail:'Keep people, packages and local businesses moving.'}
];

const services=[
 {name:'Ride',detail:'Go where life takes you.',icon:Car,illustration:'/matmove-car.svg'},
 {name:'Earn',detail:'Drive and grow with MatMove.',icon:Navigation,illustration:'/matmove-bike.svg'},
 {name:'Food',detail:'Discover local food and shops.',icon:Store,illustration:null},
 {name:'Package',detail:'Send parcels across town.',icon:Package,illustration:null},
 {name:'Rental',detail:'Find a vehicle for longer trips.',icon:Truck,illustration:'/matmove-van.svg'},
 {name:'Travel',detail:'Plan journeys beyond the city.',icon:Bike,illustration:'/matmove-keke.svg'}
];

export function LandingPage(){
 const navigate=useNavigate();
 const [journey,setJourney]=useState(0);
 const [galaRegistrationOpen,setGalaRegistrationOpen]=useState(false);
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

  <section aria-labelledby="efootball-league-title" className="mx-auto max-w-7xl px-5 pb-3 sm:px-8">
   <div className="flex flex-col gap-5 overflow-hidden rounded-[1.8rem] border border-emerald-200/80 bg-[linear-gradient(115deg,#0c1e31_0%,#123b43_58%,#155c4e_100%)] px-5 py-6 text-white shadow-[0_16px_42px_rgba(13,47,57,.17)] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-7">
    <div className="flex min-w-0 items-start gap-4">
     <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-emerald-200"><Trophy size={27}/></span>
     <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-200">Official competition</p><h2 id="efootball-league-title" className="mt-1 text-xl font-black tracking-tight sm:text-2xl">MatMove eFootball Gala</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">Ready to compete? Review the qualification requirements and submit your official player application.</p></div>
    </div>
    <button type="button" onClick={()=>setGalaRegistrationOpen(true)} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 font-extrabold text-[#082b1b] shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:bg-[#48e17f]"><Trophy size={19}/> Register for the Gala <ArrowRight size={17}/></button>
   </div>
  </section>

  <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-[.92fr_1.08fr] lg:gap-14 lg:pb-24 lg:pt-14">
   <div className="relative z-10">
    <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[.16em] text-emerald-800"><Sparkles size={15}/> Sierra Leone moves with MatMove</p>
    <h1 className="font-display max-w-2xl text-5xl font-black leading-[1.02] tracking-[-.055em] text-slate-950 sm:text-6xl lg:text-7xl">Your world moves. <span className="text-[#168163]">MatMove moves with you.</span></h1>
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
      <svg viewBox="0 0 680 330" className="mm-landing-car-svg pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" aria-hidden="true"><g><image href="/matmove-car.svg" x="-42" y="-28" width="84" height="56" preserveAspectRatio="xMidYMid meet"/><animateMotion dur="5.2s" repeatCount="indefinite" rotate="auto" path="M78 250 C68 220 108 292 201 226 S333 82 418 151 S550 250 630 102"/></g></svg>
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

  <section id="install-matmove" aria-labelledby="install-matmove-title" className="mx-auto max-w-7xl px-5 pb-8 pt-2 sm:px-8 sm:pb-12">
   <div className="mb-5 max-w-2xl"><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">Get MatMove on your phone</p><h2 id="install-matmove-title" className="font-display mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Install MatMove in a few simple steps.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Choose your phone and follow the instructions below.</p></div>
   <div className="grid gap-4 lg:grid-cols-2">
    <article className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
     <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800"><Smartphone size={23}/></span><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-emerald-700">Android</p><h3 className="text-lg font-black text-slate-950">Download and install</h3></div></div>
     <p className="mt-4 text-sm leading-6 text-slate-600">Download the MatMove Android installation file from the official MatMove link, then follow the prompts on your phone.</p>
     {androidDownloadUrl ? <a href={androidDownloadUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1554a0] px-4 font-bold text-white transition hover:bg-[#10427f]"><Download size={18}/> Download MatMove for Android</a> : <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">The Android download button will appear here once the official APK link is connected.</div>}
     <ol className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">1</span><span>Tap <b>Download MatMove</b> and wait for the file to finish downloading.</span></li>
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">2</span><span>Open the downloaded file. If Android asks, allow your browser or Files app to install this app, then return to the installer.</span></li>
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">3</span><span>Tap <b>Install</b>. When installation finishes, tap <b>Open</b> to start using MatMove.</span></li>
     </ol>
     <div className="mt-5 flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-700"/><p className="text-xs leading-5 text-slate-600">Android may show a notice because this app is being installed directly rather than through Google Play. This is expected for an official APK. Only continue when the file came from MatMove’s official download link. Keep Play Protect enabled and stop if your phone says the app is harmful or blocks the installation.</p></div>
    </article>
    <article className="rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
     <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-800"><Smartphone size={23}/></span><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-sky-700">iPhone</p><h3 className="text-lg font-black text-slate-950">Add MatMove to your Home Screen</h3></div></div>
     <p className="mt-4 text-sm leading-6 text-slate-600">Open MatMove in Safari or Chrome, then add it to your Home Screen so you can launch it from its own icon.</p>
     <ol className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">1</span><span>Open <b>Safari</b> or <b>Chrome</b> on your iPhone and visit <a href="https://matmove.space" className="font-bold text-[#1554a0] underline underline-offset-2">matmove.space</a>.</span></li>
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">2</span><span>Tap the browser’s <b>Share</b> button.</span></li>
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">3</span><span>Choose <b>Add to Home Screen</b> from the share options.</span></li>
      <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">4</span><span>Tap <b>Add</b>. The MatMove icon will appear on your Home Screen; tap it whenever you want to open MatMove.</span></li>
     </ol>
     <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-5 text-sky-900">This adds MatMove to your Home Screen for quick access. It does not require an App Store download.</div>
    </article>
   </div>
  </section>

  <PublicHomepagePosts/>

  <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8"><div className="mb-5"><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">MatMove fleet</p><h2 className="font-display mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Choose your way to move.</h2><p className="mt-2 text-sm text-slate-500">A ride for every road and every day.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[{label:'Keke',src:'/matmove-keke.svg',detail:'Easy city trips'},{label:'Bike',src:'/matmove-bike.svg',detail:'Quick solo rides'},{label:'Car',src:'/matmove-car.svg',detail:'Comfortable journeys'},{label:'Van',src:'/matmove-van.svg',detail:'Extra room' }].map(item=><div key={item.label} className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"><div className="flex h-28 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-50 via-white to-emerald-50"><img src={item.src} alt={`MatMove ${item.label}`} className="h-24 w-full object-contain"/></div><p className="mt-3 text-sm font-black text-slate-950">{item.label}</p><p className="mt-1 text-xs text-slate-500">{item.detail}</p></div>)}</div></section>
  <section className="border-y border-slate-200 bg-white py-16 sm:py-20">
   <div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="mb-9 max-w-2xl"><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-700">One platform, many ways to move</p><h2 className="font-display mt-3 text-3xl font-black tracking-tight sm:text-4xl">More than a ride. A whole city connected.</h2><p className="mt-3 leading-7 text-slate-500">Start with what you need today. Your MatMove account brings your services and activity together.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{services.map((service,i)=>{const Icon=service.icon;return <div key={service.name} className="group rounded-3xl border border-slate-200 bg-[#fbfdfc] p-5 transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg"><div className="flex h-16 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-sky-50">{service.illustration?<img src={service.illustration} alt="" className="h-14 w-[4.5rem] object-contain drop-shadow-sm"/>:<Icon size={25} strokeWidth={1.9} className="text-emerald-800"/>}</div><h3 className="mt-4 text-lg font-extrabold">{service.name}</h3><p className="mt-1 text-sm text-slate-500">{service.detail}</p></div>})}</div>
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-[#eaf4f1] p-6"><div><h3 className="text-xl font-black">Ready to move with MatMove?</h3><p className="mt-1 text-sm text-slate-600">Create your account and choose the services that fit you.</p></div><button onClick={()=>navigate('/signup')} className="min-h-12 rounded-xl bg-[#1554a0] px-5 font-bold text-white">Get started <ArrowRight className="ml-1 inline" size={17}/></button></div>
   </div>
  </section>
  <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-xs text-slate-500 sm:px-8"><span>© {new Date().getFullYear()} MatMove · Sierra Leone</span><span>Moving people, businesses and communities forward.</span></footer>
  <GalaRegistration open={galaRegistrationOpen} onClose={()=>setGalaRegistrationOpen(false)}/>
 </main>;
}
