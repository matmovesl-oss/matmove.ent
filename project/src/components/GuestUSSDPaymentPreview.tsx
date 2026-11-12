import { useState } from 'react';

type Provider = 'Orange Money' | 'Afrimoney';
type Stage = 'idle' | 'awaiting' | 'paid';

const referencePattern = /^[A-Za-z0-9-]{4,32}$/;
const phonePattern = /^\+232\d{8,9}$/;

/**
 * Public guest-payment prototype. Local-only: never sends a payment request.
 * No MatMove account is required in the intended USSD product flow.
 */
export default function GuestUSSDPaymentPreview() {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('+232');
  const [provider, setProvider] = useState<Provider>('Orange Money');
  const [amount, setAmount] = useState('100.00');
  const [stage, setStage] = useState<Stage>('idle');
  const [demoCode, setDemoCode] = useState('');
  const [error, setError] = useState('');

  function createRequest() {
    setError('');
    if (!referencePattern.test(reference.trim())) {
      setError('Enter the booking or order reference sent to you by MatMove on WhatsApp.');
      return;
    }
    if (!phonePattern.test(phone.trim())) {
      setError('Enter a valid Sierra Leone mobile number beginning with +232.');
      return;
    }
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1000000) {
      setError('Enter a valid SLE payment amount.');
      return;
    }
    setDemoCode('DEMO-' + reference.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-10));
    setStage('awaiting');
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">MatMove · Guest checkout</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">Pay with mobile money</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">A customer can pay a MatMove ride, food order, package delivery or merchant order without creating a MatMove account. In the real flow, the customer dials MatMove’s Monime USSD code and approves payment with the mobile-money operator PIN.</p>
        </header>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          {stage === 'idle' ? <>
            <label className="block text-sm font-semibold">Booking / order reference
              <input value={reference} onChange={e => setReference(e.target.value.toUpperCase())} placeholder="e.g. MM-8A3K29" maxLength={32} className="mt-1 w-full rounded-xl border p-3 font-mono" />
            </label>
            <label className="mt-3 block text-sm font-semibold">Mobile-money number
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" maxLength={13} placeholder="+232XXXXXXXX" className="mt-1 w-full rounded-xl border p-3" />
            </label>
            <label className="mt-3 block text-sm font-semibold">Network
              <select value={provider} onChange={e => setProvider(e.target.value as Provider)} className="mt-1 w-full rounded-xl border bg-white p-3">
                <option>Orange Money</option><option>Afrimoney</option>
              </select>
            </label>
            <label className="mt-3 block text-sm font-semibold">Amount (SLE)
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border p-3" />
            </label>
            <button type="button" onClick={createRequest} className="mt-4 min-h-11 w-full rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">Create demo payment request</button>
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </> : <>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Demo payment reference</p>
              <p className="mt-1 break-all font-mono text-lg font-bold">{demoCode}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-500">Amount</dt><dd className="font-bold">SLE {Number(amount).toFixed(2)}</dd></div>
                <div><dt className="text-xs text-slate-500">Network</dt><dd className="font-bold">{provider}</dd></div>
                <div><dt className="text-xs text-slate-500">Payer</dt><dd className="font-bold">{phone}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd className="font-bold">{stage === 'paid' ? 'Paid (simulated)' : 'Awaiting provider confirmation'}</dd></div>
              </dl>
            </div>
            {stage === 'awaiting' ? <button type="button" onClick={() => setStage('paid')} className="mt-4 min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Simulate verified Monime payment event</button> : <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Mock payment marked paid. A real MatMove order would only update after verifying the signed Monime event and the exact Payment object.</p>}
            <button type="button" onClick={() => {setStage('idle');setDemoCode('');setError('');}} className="mt-3 min-h-11 w-full rounded-xl border px-4 py-3 font-bold">Start another demo</button>
          </>}
          <p className="mt-4 border-t pt-3 text-xs leading-5 text-slate-500">Demo only: no mobile-money PIN is requested, no USSD session is opened and no money moves. Never share your Orange Money or Afrimoney PIN with MatMove.</p>
        </section>
      </div>
    </main>
  );
}
