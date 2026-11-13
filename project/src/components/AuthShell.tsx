import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ShieldCheck, ArrowLeft, Check, CarFront, MapPin, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

function AuthJourneyVisual(){
 return <div className="mm-auth-map relative mt-9 overflow-hidden rounded-[2rem] border border-white/15 bg-[#0b263c]/80 p-4 shadow-2xl backdrop-blur-sm">
  <div className="flex items-center justify-between gap-3"><span className="text-[10px] font-black tracking-[.2em] text-emerald-200">MATMOVE ROUTE PREVIEW</span><span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300"><i className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"/> MOVING WITH YOU</span></div>
  <svg viewBox="0 0 520 230" role="img" aria-label="Illustrative animated MatMove journey from Aberdeen through Lumley to central Freetown" className="mt-3 h-auto w-full overflow-visible">
   <defs><pattern id="mm-auth-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#b8d9df" strokeOpacity=".1" strokeWidth="1"/></pattern><linearGradient id="mm-auth-route" x1="0" x2="1"><stop offset="0" stopColor="#6ee7b7"/><stop offset="1" stopColor="#bfdbfe"/></linearGradient></defs>
   <rect width="520" height="230" rx="18" fill="url(#mm-auth-grid)"/>
   <path d="M-12 185 C62 150 74 204 144 158 S235 61 303 112 S401 176 530 42" fill="none" stroke="#1d5363" strokeWidth="23" strokeLinecap="round"/>
   <path d="M-12 185 C62 150 74 204 144 158 S235 61 303 112 S401 176 530 42" fill="none" stroke="url(#mm-auth-route)" strokeWidth="2.5" strokeDasharray="7 11" strokeLinecap="round"/>
   <path d="M32 34 C102 64 136 26 196 55 S318 82 389 30" fill="none" stroke="#477487" strokeWidth="7" strokeLinecap="round" opacity=".6"/>
   <g fill="#a7f3d0" stroke="#0b263c" strokeWidth="4"><circle cx="42" cy="171" r="7"/><circle cx="303" cy="112" r="7"/><circle cx="477" cy="67" r="7"/></g>
   <g fontFamily="sans-serif" fontSize="10" fontWeight="700" fill="#d8e8ee"><text x="20" y="205">ABERDEEN</text><text x="270" y="87">LUMLEY</text><text x="398" y="45">CENTRAL FTN</text></g>
   <g>
    <g transform="translate(-18,-12)">
     <rect x="-14" y="-7" width="28" height="14" rx="5" fill="#a7f3d0" stroke="#063b35" strokeWidth="1.5"/>
     <path d="M-8 -7L-4 -12H6L10 -7" fill="#d1fae5" stroke="#063b35" strokeWidth="1.3"/>
     <circle cx="-8" cy="8" r="3" fill="#082f49"/><circle cx="8" cy="8" r="3" fill="#082f49"/>
     <animateMotion dur="7s" repeatCount="indefinite" rotate="auto" path="M42 171 C62 150 74 204 144 158 S235 61 303 112 S401 176 477 67"/>
    </g>
   </g>
  </svg>
  <div className="mt-1 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs font-semibold text-white"><MapPin size={14} className="text-emerald-300"/> Aberdeen <span className="text-emerald-300">→</span> Central Freetown</span><span className="text-[9px] text-slate-400">Illustrative route</span></div>
 </div>;
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex font-sans bg-[#f7faf9]">
      <aside className="relative hidden overflow-hidden bg-[#0c2740] p-10 text-white lg:flex lg:w-[48%] lg:flex-col lg:justify-between xl:p-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full border-[1px] border-emerald-200/10 shadow-[0_0_0_38px_rgba(255,255,255,.025),0_0_0_85px_rgba(255,255,255,.02)]"/>
        <div className="relative z-10 flex items-center gap-3"><img src="/logo.jpg" alt="MatMove" className="h-14 w-auto rounded-2xl bg-white p-2 shadow-xl"/><div><p className="text-xl font-black tracking-tight">MatMove</p><p className="text-[9px] font-bold uppercase tracking-[.2em] text-emerald-200">Your everyday, connected</p></div></div>
        <div className="relative z-10 mx-auto w-full max-w-xl py-10">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 py-2 text-[10px] font-black uppercase tracking-[.17em] text-emerald-100"><Sparkles size={13}/> Built for Sierra Leone</p>
          <h2 className="max-w-lg text-4xl font-black leading-[1.08] tracking-tight xl:text-5xl">Every journey has a place to start.</h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">Move around town, earn on the road, support local businesses and send what matters — all with MatMove.</p>
          <AuthJourneyVisual/>
          <div className="mt-7 grid grid-cols-3 gap-3">
           <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><CarFront size={19} className="text-emerald-300"/><p className="mt-2 text-xs font-bold">Ride</p><p className="mt-1 text-[10px] text-slate-400">Move freely</p></div>
           <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><MapPin size={19} className="text-sky-300"/><p className="mt-2 text-xs font-bold">Deliver</p><p className="mt-1 text-[10px] text-slate-400">Send with ease</p></div>
           <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><Sparkles size={19} className="text-amber-200"/><p className="mt-2 text-xs font-bold">Earn</p><p className="mt-1 text-[10px] text-slate-400">Grow with us</p></div>
          </div>
        </div>
        <div className="relative z-10 text-xs font-medium text-slate-400">© 2026 MatMove · Sierra Leone</div>
      </aside>
      <section className="relative flex min-h-screen flex-1 flex-col justify-center overflow-hidden px-5 py-12 sm:px-8 lg:px-12 xl:px-20">
        <div aria-hidden="true" className="pointer-events-none absolute -right-36 -top-36 h-96 w-96 rounded-full bg-emerald-100/70 blur-3xl"/>
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-sky-100/70 blur-3xl"/>
        <div className="relative z-10 mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><img src="/logo.jpg" alt="MatMove" className="h-12 w-auto"/><div><p className="font-black text-slate-900">MatMove</p><p className="text-[9px] font-bold uppercase tracking-[.18em] text-emerald-700">Your everyday, connected</p></div></div>
          <div className="mm-auth-map relative mb-7 overflow-hidden rounded-2xl border border-slate-200 bg-[#0b263c] p-3 shadow-lg lg:hidden">
           <div className="flex items-center justify-between"><span className="text-[9px] font-black tracking-[.18em] text-emerald-200">FREETOWN ROUTE PREVIEW</span><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"/></div>
           <svg viewBox="0 0 520 110" className="mt-1 h-24 w-full" aria-hidden="true">
            <path d="M-10 86 C65 52 82 105 155 68 S245 18 318 53 S425 85 530 20" fill="none" stroke="#1d5363" strokeWidth="17" strokeLinecap="round"/>
            <path d="M-10 86 C65 52 82 105 155 68 S245 18 318 53 S425 85 530 20" fill="none" stroke="#a7f3d0" strokeWidth="2" strokeDasharray="6 8"/>
            <g transform="translate(-14 -8)"><rect x="-11" y="-5" width="22" height="10" rx="4" fill="#a7f3d0"/><circle cx="-6" cy="6" r="2.5" fill="#082f49"/><circle cx="6" cy="6" r="2.5" fill="#082f49"/><animateMotion dur="6s" repeatCount="indefinite" rotate="auto" path="M28 83 C65 52 82 105 155 68 S245 18 318 53 S425 85 490 28"/></g>
           </svg>
           <p className="text-[9px] text-slate-300">Aberdeen <span className="text-emerald-300">→</span> Lumley <span className="text-emerald-300">→</span> Central Freetown · Illustrative route</p>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

export function AuthBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="mb-7 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900" onClick={onClick}><ArrowLeft size={17}/>{label}</button>;
}

export function AuthFormCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mm-auth-form animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-7"><p className="mb-3 text-[10px] font-black uppercase tracking-[.2em] text-emerald-700">Welcome to MatMove</p><h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p></div>
      <div className="rounded-[1.8rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_60px_rgba(15,45,68,.08)] backdrop-blur sm:p-7">
       <div className="[&_form]:space-y-4 [&_label>span]:mb-1.5 [&_label>span]:block [&_label>span]:text-xs [&_label>span]:font-bold [&_label>span]:text-slate-700 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-200 [&_input]:bg-slate-50 [&_input]:px-4 [&_input]:py-3.5 [&_input]:text-sm [&_input]:text-slate-900 [&_input]:shadow-none [&_input]:transition [&_input]:placeholder:text-slate-400 focus-within:[&_input]:border-emerald-600 focus-within:[&_input]:bg-white focus-within:[&_input]:ring-2 focus-within:[&_input]:ring-emerald-100 [&_.input-field]:relative [&_.input-field>svg]:absolute [&_.input-field>svg]:left-4 [&_.input-field>svg]:top-4 [&_.input-field>svg]:text-slate-400 [&_.input-field>input]:pl-11 [&_.primary-button]:mt-2 [&_.primary-button]:flex [&_.primary-button]:min-h-12 [&_.primary-button]:w-full [&_.primary-button]:items-center [&_.primary-button]:justify-center [&_.primary-button]:gap-2 [&_.primary-button]:rounded-xl [&_.primary-button]:bg-[#1554a0] [&_.primary-button]:px-4 [&_.primary-button]:py-3 [&_.primary-button]:font-bold [&_.primary-button]:text-white hover:[&_.primary-button]:bg-[#10427f] disabled:[&_.primary-button]:cursor-not-allowed disabled:[&_.primary-button]:opacity-60">
        {children}
       </div>
      </div>
    </div>
  );
}

const stepLabels = ['Account', 'Role', 'Personal', 'Identity', 'Documents', 'Selfie', 'Review'];
export function OnboardingStepper({ current }: { current: number }) {
 return <div className="relative mb-8 flex items-center justify-between"><div className="absolute left-0 top-4 -z-10 h-[2px] w-full bg-slate-200"/><div className="absolute left-0 top-4 -z-10 h-[2px] bg-emerald-500 transition-all duration-500" style={{width:`${((current-1)/(stepLabels.length-1))*100}%`}}/>{stepLabels.map((label,index)=><div key={label} className="flex flex-col items-center gap-2"><div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition ${index+1<current?'bg-emerald-600 text-white':index+1===current?'bg-[#1554a0] text-white ring-4 ring-blue-100':'border-2 border-slate-200 bg-white text-slate-400'}`}>{index+1<current?<Check size={15}/>:index+1}</div><span className={`hidden text-[10px] font-semibold md:block ${index+1<=current?'text-slate-800':'text-slate-400'}`}>{label}</span></div>)}</div>;
}
export function OnboardingShell({ step, children }: { step: number; children: ReactNode }) {
 const navigate=useNavigate();
 return <div className="min-h-screen bg-slate-50 lg:flex"><aside className="hidden w-[35%] flex-col justify-between bg-[#0c2740] p-12 text-white lg:flex"><div><button type="button" onClick={()=>navigate('/')} className="mb-12 rounded-xl bg-white p-2"><img src="/logo.jpg" alt="MatMove" className="h-10 w-auto"/></button><h2 className="mb-4 text-3xl font-black">Let’s get your account verified.</h2><p className="mb-8 leading-7 text-slate-300">We verify every member to help keep the MatMove community trusted.</p><AuthJourneyVisual/></div><p className="text-xs text-slate-400">© 2026 MatMove · Sierra Leone</p></aside><section className="max-h-screen flex-1 overflow-y-auto px-5 py-10 sm:px-8 lg:px-12"><div className="mx-auto w-full max-w-3xl"><div className="mb-8 flex items-center justify-between lg:hidden"><img src="/logo.jpg" alt="MatMove" className="h-10 w-auto"/><span className="text-sm font-semibold text-slate-500">Step {step} of 7</span></div><OnboardingStepper current={step}/><div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-10"><div className="[&_.ob-title]:mb-2 [&_.ob-title]:text-3xl [&_.ob-title]:font-bold [&_.ob-title]:text-slate-900 [&_.ob-subtitle]:mb-8 [&_.ob-subtitle]:text-slate-500 [&_.ob-form-grid]:grid [&_.ob-form-grid]:grid-cols-1 [&_.ob-form-grid]:gap-6 [&_.ob-form-grid]:md:grid-cols-2 [&_.field-full]:md:col-span-2 [&_.ob-actions]:mt-10 [&_.ob-actions]:flex [&_.ob-actions]:justify-between [&_.ob-actions]:border-t [&_.ob-actions]:border-slate-100 [&_.ob-actions]:pt-6 [&_.primary-button]:flex [&_.primary-button]:items-center [&_.primary-button]:gap-2 [&_.primary-button]:rounded-xl [&_.primary-button]:bg-[#1554a0] [&_.primary-button]:px-6 [&_.primary-button]:py-3 [&_.primary-button]:font-semibold [&_.primary-button]:text-white hover:[&_.primary-button]:bg-[#10427f] disabled:[&_.primary-button]:opacity-50 [&_.back-button]:flex [&_.back-button]:items-center [&_.back-button]:gap-2 [&_.back-button]:font-medium [&_.back-button]:text-slate-500 hover:[&_.back-button]:text-slate-900 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-200 [&_input]:bg-slate-50 [&_input]:px-4 [&_input]:py-3 [&_label>span]:mb-1.5 [&_label>span]:block [&_label>span]:text-sm [&_label>span]:font-semibold [&_label>span]:text-slate-700 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-slate-200 [&_select]:bg-slate-50 [&_select]:px-4 [&_select]:py-3">{children}</div></div></div></section></div>;
}
