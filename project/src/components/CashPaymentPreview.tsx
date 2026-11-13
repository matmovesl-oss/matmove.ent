import { useMemo, useState } from 'react';
import { calculateCashRideSplit } from '../../shared/cash-payment-rules.js';

type Stage = 'idle' | 'reserved' | 'completed' | 'refunded';

function sle(minor: number) {
  return (minor / 100).toLocaleString('en-SL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Isolated, local-only product preview. This component deliberately makes no
 * API, Supabase, Monime, wallet, booking or ledger calls.
 */
export default function CashPaymentPreview({ fare }: { fare: string | number }) {
  const split = useMemo(() => {
    try { return calculateCashRideSplit(fare); } catch { return null; }
  }, [fare]);
  const [demoBalance, setDemoBalance] = useState('30.00');
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('');

  const balanceMinor = /^\d{1,7}(?:\.\d{1,2})?$/.test(demoBalance)
    ? Math.round(Number(demoBalance) * 100)
    : -1;
  const canReserve = !!split && balanceMinor >= split.matmoveFeeMinor;

  function reserve() {
    if (!split) return;
    if (!canReserve) {
      setMessage('Insufficient demo SLE wallet balance. The real cash booking must be blocked until the MatMove fee can be secured.');
      return;
    }
    setStage('reserved');
    setMessage('Demo only: the MatMove fee is shown as reserved. No real wallet funds were moved.');
  }

  function reset(next: Stage = 'idle') {
    setStage(next);
    setMessage(next === 'refunded'
      ? 'Demo only: the reserved fee was released back to the customer.'
      : next === 'completed'
        ? 'Demo only: the driver cash handover and MatMove fee capture are shown as complete.'
        : '');
  }

  return (
    <section aria-label="Cash payment preview" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900">Cash payment</h3>
          <p className="text-xs text-slate-600">Pay the driver physically; secure MatMove’s fee digitally.</p>
        </div>
        <span className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Preview only</span>
      </div>

      {split ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-white p-3">
              <p className="text-xs text-slate-500">Total fare</p>
              <p className="text-lg font-bold">SLE {sle(split.fareMinor)}</p>
            </div>
            <div className="rounded-xl bg-white p-3">
              <p className="text-xs text-slate-500">Cash to driver</p>
              <p className="text-lg font-bold text-emerald-700">SLE {sle(split.driverCashMinor)}</p>
            </div>
            <div className="col-span-2 rounded-xl bg-white p-3">
              <p className="text-xs text-slate-500">MatMove fee (15%) — secured from SLE wallet</p>
              <p className="text-lg font-bold text-blue-700">SLE {sle(split.matmoveFeeMinor)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            The customer’s combined cost remains SLE {sle(split.fareMinor)}. The driver receives SLE {sle(split.driverCashMinor)} in physical cash; MatMove receives SLE {sle(split.matmoveFeeMinor)} digitally.
          </p>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <label className="block text-xs font-semibold text-slate-700">
              Demo SLE wallet balance
              <input aria-label="Demo SLE wallet balance" inputMode="decimal" value={demoBalance} onChange={e => { setDemoBalance(e.target.value); setStage('idle'); setMessage(''); }} className="mt-1 w-full rounded-lg border p-2 text-sm" />
            </label>
            <p className="mt-1 text-xs text-slate-500">Required to secure MatMove’s fee: SLE {sle(split.matmoveFeeMinor)}. This field is simulated and does not read or debit your real wallet.</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {stage === 'idle' && <button type="button" onClick={reserve} className="min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Simulate fee reservation</button>}
            {stage === 'reserved' && <>
              <button type="button" onClick={() => reset('completed')} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Simulate completed ride</button>
              <button type="button" onClick={() => reset('refunded')} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold">Simulate fee release</button>
            </>}
            {stage !== 'idle' && <button type="button" onClick={() => reset()} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold">Reset preview</button>}
          </div>
          <p role="status" className="mt-2 text-xs font-semibold text-slate-700">
            {stage === 'idle' ? 'Status: not reserved (demo)' : stage === 'reserved' ? 'Status: fee reserved (demo) · awaiting trip completion' : stage === 'completed' ? 'Status: completed · fee captured (demo)' : 'Status: cancelled · fee released (demo)'}
          </p>
          {message && <p role="status" className="mt-2 text-xs text-amber-950">{message}</p>}
        </>
      ) : <p role="alert" className="mt-3 text-sm text-red-700">Enter a valid positive fare to preview the cash split.</p>}
      <p className="mt-3 border-t border-amber-200 pt-2 text-[11px] leading-5 text-amber-950">
        Mock screen only. It does not create a cash booking, reserve money, contact Monime, or change your live wallet. Live Cash checkout remains disabled until its separate ledger and verified server APIs are installed.
      </p>
    </section>
  );
}
