
import { useEffect, useRef, useState } from 'react';
import { merchantPaymentRequest, type CheckoutItem, type MerchantQuote, type MerchantPayment, type MerchantSubmit } from '@/services/merchantPaymentService';
const sle = (value: number) => `SLE ${(value / 100).toFixed(2)}`;
const terminal = (state: string) => ['completed', 'failed', 'review_required'].includes(state);
type Saved = { request: MerchantSubmit; payment?: MerchantPayment };
type Props = { userId: string; items: CheckoutItem[]; initialPhone?: string; onPaid?: (payment: MerchantPayment) => unknown };
export default function MerchantCheckout({ userId, items, initialPhone = '', onPaid }: Props) {
  const storageKey = `matmove-merchant-payment:${userId}`;
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [quote, setQuote] = useState<MerchantQuote | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageAvailable, setStorageAvailable] = useState(true);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const notified = useRef<string | null>(null);
  const inputKey = JSON.stringify(items);
  useEffect(() => { setQuote(null); }, [inputKey]);
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const value = JSON.parse(raw) as Saved;
        if (value.request?.action === 'merchant_submit' && typeof value.request.idempotencyKey === 'string') {
          if (value.payment && ['completed', 'failed'].includes(value.payment.state)) localStorage.removeItem(storageKey);
          else setSaved(value);
        }
      }
    } catch { setStorageAvailable(false); setError('Enable browser storage before making a payment.'); }
    return () => { mounted.current = false; };
  }, [storageKey]);
  function persist(value: Saved) {
    if (value.payment && ['completed', 'failed'].includes(value.payment.state)) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(value));
    setSaved(value);
  }
  async function review() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await merchantPaymentRequest({ action: 'merchant_quote', items, delivery, city: 'Freetown', address, phone, idempotencyKey: crypto.randomUUID() });
      if (!result.quote) throw new Error('No checkout quote returned.');
      if (mounted.current) setQuote(result.quote);
    } catch (e: any) { if (mounted.current) setError(e.message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function submitOrCheck() {
    if (inFlight.current || (!saved && (!quote?.affordable || !storageAvailable))) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const value: Saved = saved || { request: { action: 'merchant_submit', items: JSON.parse(inputKey), delivery, city: 'Freetown', address, phone, acceptedTotalMinor: quote!.totalMinor, idempotencyKey: crypto.randomUUID() } };
      if (!saved) persist(value);
      const result = await merchantPaymentRequest(value.payment ? { action: 'merchant_status', paymentId: value.payment.id } : value.request);
      if (!result.payment) throw new Error('No payment receipt returned.');
      if (mounted.current) persist({ ...value, payment: result.payment });
      if (result.payment.state === 'completed' && notified.current !== result.payment.id) {
        notified.current = result.payment.id;
        try { await onPaid?.(result.payment); } catch { /* Payment remains completed even if the cart refresh fails. */ }
      }
    } catch (e: any) {
      if (mounted.current) {
        if (e.code === 'MERCHANT_PAYMENT_NOT_STARTED') {
          try { localStorage.removeItem(storageKey); setSaved(null); setQuote(null); setError(`${e.message} No payment was started. Review checkout again.`); }
          catch { setError('Could not clear the rejected checkout. Check this same payment again.'); }
        } else setError(`${e.message} Check this same payment again; do not start a duplicate payment.`);
      }
    }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!saved || busy || (saved.payment && terminal(saved.payment.state))) return;
    const timer = window.setTimeout(() => { void submitOrCheck(); }, 5000);
    return () => window.clearTimeout(timer);
  }, [saved, busy]);
  const payment = saved?.payment;
  const breakdown = payment || quote;
  const resetQuote = () => { setQuote(null); setError(''); };
  function newPayment() {
    try { localStorage.removeItem(storageKey); setSaved(null); setQuote(null); setError(''); }
    catch { setError('Unable to clear completed payment.'); }
  }
  if (!items.length && !saved) return null;
  return <section className="my-4 space-y-4 rounded-2xl border border-blue-200 bg-white p-5">
    <h2 className="text-xl font-bold">Pay merchant with your MatMove wallet</h2>
    <p className="text-sm text-slate-600">A 1% MatMove payment fee is added to products plus any delivery charge. The merchant receives the full product price.</p>
    {!saved && <div className="space-y-3">
      <label className="block font-medium">Delivery option<select disabled={busy} value={delivery ? 'delivery' : 'pickup'} onChange={e => { setDelivery(e.target.value === 'delivery'); resetQuote(); }} className="mt-1 w-full rounded-xl border p-3">
        <option value="pickup">Product only — arrange pickup with merchant</option>
        <option value="delivery">Freetown delivery — SLE 50.00</option>
      </select></label>
      {delivery && <label className="block font-medium">Freetown street address<input disabled={busy} value={address} maxLength={500} onChange={e => { setAddress(e.target.value); resetQuote(); }} className="mt-1 w-full rounded-xl border p-3" placeholder="Street, building and area" /></label>}
      <label className="block font-medium">Contact phone<input disabled={busy} value={phone} onChange={e => { setPhone(e.target.value); resetQuote(); }} type="tel" placeholder="077123456" className="mt-1 w-full rounded-xl border p-3" /></label>
      <button disabled={busy || !items.length || !phone || (delivery && !address)} onClick={() => void review()} className="rounded-xl border px-4 py-3 font-bold disabled:opacity-50">{busy ? 'Checking...' : 'Review payment'}</button>
    </div>}
    {breakdown && <dl className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
      {breakdown.items.map(item => <div key={item.productId} className="flex justify-between gap-3"><dt>{item.name} × {item.quantity}</dt><dd>{sle(item.unitMinor * item.quantity)}</dd></div>)}
      <div className="flex justify-between"><dt>Merchant receives</dt><dd>{sle(breakdown.productMinor)}</dd></div>
      <div className="flex justify-between"><dt>Delivery to escrow</dt><dd>{sle(breakdown.deliveryMinor)}</dd></div>
      <div className="flex justify-between"><dt>MatMove payment fee (1%) to escrow</dt><dd>{sle(breakdown.feeMinor)}</dd></div>
      <div className="flex justify-between border-t pt-2 font-bold"><dt>Total wallet debit</dt><dd>{sle(breakdown.totalMinor)}</dd></div>
      {!payment && quote && <div className="flex justify-between"><dt>Available wallet balance</dt><dd>{sle(quote.availableMinor)}</dd></div>}
    </dl>}
    {quote && !quote.affordable && !saved && <p role="alert" className="text-red-700">Insufficient balance for this payment and fees.</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {payment && <div role="status" className={`rounded-xl p-4 ${payment.state === 'completed' ? 'bg-emerald-50' : 'bg-amber-50'}`}>
      <strong>{payment.state === 'completed' ? 'Payment completed — merchant credited' : payment.state === 'failed' ? 'Payment failed — merchant was not credited' : payment.state === 'review_required' ? 'Support review required' : 'Payment processing — checking automatically'}</strong>
      {payment.error && <p className="mt-2">{payment.error}</p>}
      {payment.deliveryState === 'funded' && <p className="mt-2">SLE 50.00 is held in escrow for delivery. Delivery has not been marked completed.</p>}
      <p className="mt-2 break-all text-xs">Payment reference: {payment.id}</p>
      {payment.receipts.map(r => <p className="mt-1 break-all text-xs" key={r.kind}>{r.kind}: {r.status}{r.id ? ` — ${r.id}` : ''}</p>)}
      {payment.state === 'review_required' && <p className="mt-2">Keep this reference for support. Do not pay for this order again.</p>}
    </div>}
    {(saved || quote) && (!payment || !terminal(payment.state)) && <button disabled={busy || (!saved && (!quote?.affordable || !storageAvailable))} onClick={() => void submitOrCheck()} className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Processing...' : saved ? 'Check payment status' : `Confirm payment — ${sle(quote!.totalMinor)}`}</button>}
    {payment && ['completed', 'failed'].includes(payment.state) && <button disabled={busy} onClick={newPayment} className="rounded-xl border px-4 py-3 font-bold">New payment</button>}
  </section>;
}
