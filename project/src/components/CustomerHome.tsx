import {ArrowRight,Car,MapPin,Wallet,Store,ShoppingBag} from 'lucide-react';
type Props={profile:any;onNavigate:(section:string)=>void};
export default function CustomerHome({profile,onNavigate}:Props){
 const role=String(profile?.role||'rider'),driver=role==='driver',merchant=role==='merchant';
 const name=String(profile?.first_name||profile?.full_name||profile?.business_name||'there').trim().split(/\s+/)[0];
 return <main className="mm-portal-morph mx-auto min-h-[calc(100dvh-136px)] max-w-6xl space-y-4 px-4 pb-28 pt-5 sm:px-6">
  <header className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">{driver?'Driver space':merchant?'Business space':'Your MatMove'}</p><h1 className="mt-1 text-2xl font-black text-slate-950">Hello, {name}.</h1><p className="mt-1 text-sm text-slate-500">{driver?'Ready for your next trip?':'Where will today take you?'}</p></div></header>
  <section className="relative isolate overflow-hidden rounded-[2rem] bg-[#0c1d31] p-6 text-white shadow-xl sm:p-8">
   <svg viewBox="0 0 700 250" className="pointer-events-none absolute inset-0 h-full w-full opacity-50" preserveAspectRatio="xMidYMid slice"><path d="M-20 206 C100 160 130 235 240 165 S390 76 470 137 S590 210 730 64" fill="none" stroke="#2d8a75" strokeWidth="24" strokeLinecap="round"/><path d="M-20 206 C100 160 130 235 240 165 S390 76 470 137 S590 210 730 64" fill="none" stroke="#d7ede7" strokeWidth="2" strokeDasharray="9 12"/></svg>
   <div className="relative max-w-xl"><span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-emerald-100">MatMove · Sierra Leone</span><h2 className="mt-5 text-3xl font-black leading-tight sm:text-4xl">{driver?'Your next journey starts here.':merchant?'Move your business forward.':'Your city. Your journey. One tap away.'}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{driver?'Open the live request map and manage your driving day.':'Set a destination, see your route and choose how you want to move.'}</p><button onClick={()=>onNavigate('ride')} className="mt-6 inline-flex min-h-12 items-center gap-3 rounded-2xl bg-white px-5 py-3 font-bold text-slate-950">{driver?'Open driver radar':'Where to?'} <ArrowRight size={18}/></button></div>
   <div className="mm-road-car absolute bottom-7 right-8 hidden text-white sm:block"><Car size={30}/></div>
  </section>
  <div className="grid gap-3 sm:grid-cols-2">
   <button onClick={()=>onNavigate('account')} className="flex min-h-24 items-center gap-4 rounded-3xl border bg-white p-4 text-left shadow-sm"><span className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Wallet/></span><span><b className="block">My wallet</b><small className="text-slate-500">Balances, top-ups, transfers and payments</small></span><ArrowRight className="ml-auto"/></button>
   <button onClick={()=>onNavigate('ride')} className="flex min-h-24 items-center gap-4 rounded-3xl border bg-white p-4 text-left shadow-sm"><span className="rounded-2xl bg-sky-50 p-3 text-sky-700"><MapPin/></span><span><b className="block">Manage places</b><small className="text-slate-500">Home, Work and favourite locations</small></span><ArrowRight className="ml-auto"/></button>
  </div>
 </main>;
}
