import {ArrowRight,Car,MapPin,Wallet,Store,ShoppingBag,Package,Utensils,KeyRound,Navigation,Sparkles} from 'lucide-react';
import CustomerHomePosts from '@/components/CustomerHomePosts';
import CustomerHomeMap from '@/components/CustomerHomeMap';

type Props={profile:any;onNavigate:(section:'ride'|'account'|'services'|'trips'|'shop'|'inventory')=>void};

const customerServices=[
 {label:'Ride',detail:'Book a Keke, bike or car',icon:Car,accent:'bg-emerald-50 text-emerald-700'},
 {label:'Food',detail:'Order from local vendors',icon:Utensils,accent:'bg-orange-50 text-orange-700'},
 {label:'Package',detail:'Send a parcel across town',icon:Package,accent:'bg-sky-50 text-sky-700'},
 {label:'Rental',detail:'Find a vehicle for longer',icon:KeyRound,accent:'bg-violet-50 text-violet-700'},
];
const driverServices=[
 {label:'Driver radar',detail:'Go online and view requests',icon:Navigation,accent:'bg-emerald-50 text-emerald-700'},
 {label:'My trips',detail:'Review your recent journeys',icon:Car,accent:'bg-sky-50 text-sky-700'},
 {label:'Earnings',detail:'See your wallet and payouts',icon:Wallet,accent:'bg-amber-50 text-amber-700'},
 {label:'Vehicle rental',detail:'Explore rental opportunities',icon:KeyRound,accent:'bg-violet-50 text-violet-700'},
];
const merchantServices=[
 {label:'My shop',detail:'Manage products and orders',icon:Store,accent:'bg-emerald-50 text-emerald-700'},
 {label:'Orders',detail:'Keep up with customer orders',icon:ShoppingBag,accent:'bg-orange-50 text-orange-700'},
 {label:'Earnings',detail:'View your business wallet',icon:Wallet,accent:'bg-amber-50 text-amber-700'},
 {label:'Promote business',detail:'Reach more MatMove customers',icon:Sparkles,accent:'bg-violet-50 text-violet-700'},
];

export default function CustomerHome({profile,onNavigate}:Props){
 const role=String(profile?.role||'rider'),driver=role==='driver',merchant=role==='merchant';
 const name=String(profile?.first_name||profile?.full_name||profile?.business_name||'there').trim().split(/\\s+/)[0];
 const services=driver?driverServices:merchant?merchantServices:customerServices;
 const openRide=()=>onNavigate('ride');
 return <main className="mm-portal-morph mx-auto min-h-[calc(100dvh-136px)] max-w-6xl space-y-6 px-4 pb-28 pt-5 sm:px-6">
  <header className="flex items-center justify-between gap-3">
   <div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">{driver?'Driver space':merchant?'Business space':'Your MatMove'}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Hello, {name}.</h1><p className="mt-1 text-sm text-slate-500">{driver?'Your next earning journey starts here.':merchant?'Let’s grow your business today.':'Where will today take you?'}</p></div>
   <button type="button" onClick={()=>onNavigate('account')} aria-label="Open account and wallet" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm"><Wallet size={21}/></button>
  </header>

  <section className="relative isolate overflow-hidden rounded-[2rem] bg-[#0b2236] p-6 text-white shadow-xl sm:p-9">
   <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border-[38px] border-emerald-400/10"/>
   <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 right-20 h-72 w-72 rounded-full border-[2px] border-dashed border-white/20"/>
   <div className="relative max-w-xl">
    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-100"><Sparkles size={13}/> MATMOVE · SIERRA LEONE</span>
    <h2 className="mt-5 text-3xl font-black leading-[1.08] sm:text-4xl">{driver?'Ready to get moving and earn?':merchant?'Your business, moving forward.':'Your city. Your journey. One tap away.'}</h2>
    <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{driver?'Go online when you are ready and connect with nearby customers.':merchant?'Manage your shop, serve customers and follow your business activity.':'Rides, food, parcels and rentals — the everyday services you need in one place.'}</p>
    <button type="button" onClick={driver||!merchant?openRide:()=>onNavigate('services')} className="mt-6 inline-flex min-h-12 items-center gap-3 rounded-2xl bg-white px-5 py-3 font-bold text-slate-950 transition hover:bg-emerald-50">{driver?'Open driver radar':merchant?'Explore business tools':'Where to?'} <ArrowRight size={18}/></button>
   </div>
   <div aria-hidden="true" className="absolute bottom-7 right-8 hidden items-center justify-center rounded-3xl border border-white/15 bg-white/10 p-5 text-emerald-100 sm:flex"><Car size={46} strokeWidth={1.4}/></div>
  </section>

  <CustomerHomeMap role={role} onNavigate={onNavigate}/>

  <section aria-labelledby="quick-services-title">
   <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Made for your day</p><h2 id="quick-services-title" className="mt-1 text-xl font-black text-slate-950">Quick access</h2></div><button type="button" onClick={()=>onNavigate('services')} className="inline-flex min-h-10 items-center gap-1 text-sm font-bold text-emerald-700">All services <ArrowRight size={16}/></button></div>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {services.map(item=>{const Icon=item.icon;return <button key={item.label} type="button" onClick={()=>onNavigate(driver?(item.label==='Driver radar'?'ride':item.label==='My trips'?'trips':item.label==='Earnings'?'account':'services'):merchant?(item.label==='My shop'||item.label==='Orders'?'inventory':item.label==='Earnings'?'account':'services'):item.label==='Ride'?'ride':item.label==='Food'?'shop':'services')} className="group min-h-36 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"><span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl ${item.accent}`}><Icon size={21}/></span><span className="block font-bold text-slate-950">{item.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{item.detail}</span></button>})}
   </div>
  </section>

  <CustomerHomePosts userId={profile.id}/>

  <section className="grid gap-3 sm:grid-cols-2">
   <button type="button" onClick={()=>onNavigate('account')} className="flex min-h-24 items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200"><span className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Wallet size={22}/></span><span className="min-w-0"><b className="block text-slate-950">My wallet</b><small className="text-slate-500">Balances, top-ups and payments</small></span><ArrowRight className="ml-auto shrink-0 text-slate-400"/></button>
   <button type="button" onClick={openRide} className="flex min-h-24 items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200"><span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><MapPin size={22}/></span><span className="min-w-0"><b className="block text-slate-950">Manage places</b><small className="text-slate-500">Home, Work and favourite locations</small></span><ArrowRight className="ml-auto shrink-0 text-slate-400"/></button>
  </section>
 </main>;
}
