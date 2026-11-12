import { useState } from 'react';

type Provider = 'Orange Money' | 'Afrimoney';
type Stage = 'idle' | 'awaiting' | 'paid';

const referencePattern = /^[A-Za-z0-9-]{4,32}$/;

/**
 * Public guest-payment prototype. Local-only: never sends a payment request.
 * In the live USSD flow the network and subscriber are identified by Monime's
 * session; the server supplies the amount from the validated order reference.
 */
export default function GuestUSSDPaymentPreview() {
  const [reference, setReference] = useState('');
  const [provider, setProvider] = useState<Provider>('Orange Money');
  const [stage, setStage] = useState<Stage>('idle');
  const [demoCode, setDemoCode] = useState('');
  const [error, setError] = useState('');

  function createRequest() {
    setError('');
    if (!referencePattern.test(reference.trim())) {
      setError('Enter the booking or order reference sent to you by MatMove on WhatsApp.');
      return;
    }
    setDemoCode('DEMO-' + reference.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-10));
    setStage('awaiting');
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">MatMove · Guest USSD</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">Pay with mobile money</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Pay a MatMove ride, food order, package delivery or merchant order without creating a MatMove account. In the real flow, dial MatMove’s published Monime USSD code from your Orange or Afrimoney SIM and approve the payment with your mobile-money PIN.</p>
        </header>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          {stage === 'idle' ? <>
            <label className="block text-sm font-semibold">Booking / order reference
              <input value={reference} onChange={e => setReference(e.target.value.toUpperCase())} placeholder="e.g. MM-8A3K29" maxLength={32} className="mt-1 w-full rounded-xl border p-3 font-mono" />
            </label>
            <label className="mt-3 block text-sm font-semibold">Simulated mobile-money network
              <select value={provider} onChange={e => setProvider(e.target.value as Provider)} className="mt-1 w-full rounded-xl border bg-white p-3">
                <option>Orange Money</option><option>Afrimoney</option>
              </select>
            </label>
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Amount from MatMove order</p>
              <p className="mt-1 text-xl font-bold">SLE 100.00 <span className="text-xs font-normal text-slate-500">(demo quote, read-only)</span></p>
              <p className="mt-1 text-xs leading-5 text-slate-500">A real payment amount is looked up and locked by MatMove's server from the booking/order reference. The payer cannot edit it in the USSD menu.</p>
            </div>
            <button type="button" onClick={createRequest} className="mt-4 min-h-11 w-full rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">Create demo USSD session</button>
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </> : <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Demo payment reference</p>
              <p className="mt-1 break-all font-mono text-lg font-bold">{demoCode}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-500">Amount</dt><dd className="font-bold">SLE 100.00</dd></div>
                <div><dt className="text-xs text-slate-500">Detected network</dt><dd className="font-bold">{provider} (simulated)</dd></div>
                <div><dt className="text-xs text-slate-500">MatMove account</dt><dd className="font-bold">Not required</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd className="font-bold">{stage === 'paid' ? 'Paid (simulated)' : 'Awaiting provider confirmation'}</dd></div>
              </dl>
            </div>
            {stage === 'awaiting' ? <button type="button" onClick={() => setStage('paid')} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Simulate verified Monime payment event</button> : <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Mock payment marked paid. A real MatMove order would only update after verifying the signed Monime event and the exact Payment object.</p>}
            <button type="button" onClick={() => {setStage('idle');setDemoCode('');setError('');}} className="mt-3 min-h-11 w-full rounded-xl border px-4 py-3 font-bold">Start another demo</button>
          </>}
          <p className="mt-4 border-t pt-3 text-xs leading-5 text-slate-500">Demo only: no USSD session opens and no money moves. MatMove never asks for or stores your Orange Money or Afrimoney PIN.</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-2xl border bg-white p-4">
            <h2 className="font-bold text-slate-900">For drivers</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">A future authenticated USSD menu can show assigned-trip status and earnings, with payout requests routed through the existing verified payout controls.</p>
          </article>
          <article className="rounded-2xl border bg-white p-4">
            <h2 className="font-bold text-slate-900">For merchants</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">A future authenticated USSD menu can show paid orders and fulfilment status. Merchant payouts remain in the registered merchant settlement ledger.</p>
          </article>
        </section>
      </div>
    </main>
  );
}
