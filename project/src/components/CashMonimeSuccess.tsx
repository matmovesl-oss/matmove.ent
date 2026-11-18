import { CheckCircle2, ShieldCheck, X } from 'lucide-react';

export function CashMonimeSuccess({open,onClose}:{open:boolean;onClose:()=>void}) {
  if(!open)return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-5 py-8" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="cash-monime-title" className="w-full max-w-sm rounded-[1.75rem] border border-slate-200 bg-white p-7 text-center shadow-2xl">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 size={36}/></div>
      <p className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800"><ShieldCheck size={13}/> Verified with Monime</p>
      <h2 id="cash-monime-title" className="mt-3 text-xl font-extrabold text-slate-900">Transaction successful</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Both cash confirmations are complete, and Monime has confirmed MatMove’s fee transaction. This ride payment is settled.</p>
      <button type="button" autoFocus onClick={onClose} className="mt-6 min-h-12 w-full rounded-xl bg-emerald-800 px-5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700">Understood</button>
    </section>
  </div>;
}
