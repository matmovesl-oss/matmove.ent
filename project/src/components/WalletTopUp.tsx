

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { walletFetch } from '@/lib/apiFetch';

type Quote = {
  netMode: boolean; requestedMinor: number; walletCreditMinor: number | null;
  feeMinor: number | null; totalMinor: number; version: string;
};
type PaymentCode = {
  id: string; ussdCode: string | null; amount: {currency: string; value: number};
  expireTime: string | null; status: string; confirmed: boolean; closed?: boolean; quote?: Quote | null;
  settlement?: {paymentId: string; feeMinor: number; creditMinor: number} | null;
};
type Saved = {amount: string; intentId?: string; quote?: Quote; code?: PaymentCode};
const money = (minor: number) => `SLE ${(minor / 100).toFixed(2)}`;
const terminal = (code: PaymentCode) => code.closed === true || ['completed', 'expired', 'cancelled'].includes(code.status);
function requestBody(saved: Saved): Record<string, unknown> {
  return {
    amount: saved.amount, currency: 'SLE',
    ...(saved.intentId ? {topupRequestId: saved.intentId} : {}),
    ...(saved.quote?.netMode ? {
      acceptedTotalMinor: saved.quote.totalMinor, quoteVersion: saved.quote.version,
    } : {}),
  };
}

export function WalletTopUp({userId, allowed, onClose, onPaid}: {
  userId: string; allowed: boolean; onClose: () => void; onPaid: () => void | Promise<void>;
}) {
  const storage = `matmove-topup:${userId}`;
  const [initial] = useState<Saved | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storage) || 'null');
      return value && typeof value.amount === 'string' ? value : null;
    } catch { return null; }
  });
  const intent = useRef<Saved | null>(initial);
  const [amount, setAmount] = useState(initial?.amount || '');
  const [code, setCode] = useState<PaymentCode | null>(initial?.code || null);
  const [completion, setCompletion] = useState<PaymentCode | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedAmount, setQuotedAmount] = useState('');
  const [uncertain, setUncertain] = useState(!!initial && !initial.code);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeRequested = useRef(false);
  const closeAction = useRef<() => Promise<void>>(async () => {});
  const [checking, setChecking] = useState(!!initial?.code);
  const [quoting, setQuoting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const quoteSequence = useRef(0);
  const notified = useRef('');
  const paidCallback = useRef(onPaid);
  paidCallback.current = onPaid;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; quoteSequence.current++; };
  }, []);

  const persist = useCallback((saved: Saved) => {
    // Storage must succeed BEFORE creating a payment code.
    sessionStorage.setItem(storage, JSON.stringify(saved));
    intent.current = saved;
  }, [storage]);

  const clear = useCallback(() => {
    const old = intent.current;
    try {
      sessionStorage.removeItem(storage);
      if (old) sessionStorage.removeItem(`matmove-request:${JSON.stringify({
        user: userId, url: '/api/create-wallet-payment-code', body: requestBody(old),
      })}`);
    } catch { /* The provider still retains the completed receipt. */ }
    intent.current = null;
  }, [storage, userId]);

  const finishCode = useCallback(async (next: PaymentCode) => {
    clear();
    if (mounted.current) {
      setCode(null); setAmount(''); setQuote(null); setQuotedAmount('');
      setUncertain(false); setVerified(false); setError(''); setQuoteError('');
      setCompletion(next.status === 'completed' ? next : null);
      setNotice(next.status === 'completed' ? '' : 'The previous code has closed. Start a fresh load.');
    }
    if (next.status === 'completed' && notified.current !== next.id) {
      notified.current = next.id;
      try { await paidCallback.current(); }
      catch { if (mounted.current) setError('Payment completed. Refresh your wallet to see its current balance.'); }
    }
  }, [clear]);

  const refresh = useCallback(async () => {
    const old = intent.current;
    if (!old?.code || inFlight.current) return;
    inFlight.current = true;
    if (mounted.current) setChecking(true);
    try {
      const {response, data, finish} = await walletFetch('/api/create-wallet-payment-code', {
        operation: 'status', paymentCodeId: old.code.id,
      });
      finish();
      if (!response.ok || !data.paymentCode) throw new Error(data.error || 'Unable to verify the previous payment.');
      const next: PaymentCode = data.paymentCode;
      if (terminal(next)) { await finishCode(next); return; }
      persist({...old, code: next});
      if (mounted.current) { setCode(next); setVerified(true); setError(''); }
    } catch (e) {
      if (mounted.current) { setVerified(false); setError(e instanceof Error ? e.message : 'Status unavailable. Check again before another payment.'); }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setChecking(false); if (closeRequested.current) void closeAction.current(); }
    }
  }, [finishCode, persist]);

  useEffect(() => { if (initial?.code) void refresh(); }, [initial, refresh]);
  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [code?.id, refresh]);

  // Read-only fee quotes appear while typing. Only Generate code creates a
  // collection request; the user still authorizes payment on their phone.
  useEffect(() => {
    const sequence = ++quoteSequence.current;
    setQuote(null); setQuotedAmount(''); setQuoteError(''); setQuoting(false);
    if (code || completion || uncertain || !allowed || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return;
    setQuoting(true);
    const timer = window.setTimeout(async () => {
      try {
        const {response, data, finish} = await walletFetch('/api/create-wallet-payment-code', {
          operation: 'quote', amount, currency: 'SLE',
        });
        finish();
        if (!response.ok || !data.quote) throw new Error(data.error || 'Fee quote unavailable.');
        if (mounted.current && sequence === quoteSequence.current) {
          setQuote(data.quote); setQuotedAmount(amount);
        }
      } catch (e) {
        if (mounted.current && sequence === quoteSequence.current) setQuoteError(e instanceof Error ? e.message : 'Fee quote unavailable.');
      } finally {
        if (mounted.current && sequence === quoteSequence.current) setQuoting(false);
      }
    }, 400);
    return () => { window.clearTimeout(timer); if (quoteSequence.current === sequence) quoteSequence.current++; };
  }, [amount, allowed, code, completion, uncertain]);

  async function create() {
    if (inFlight.current || !allowed) return;
    const existing = intent.current;
    if (!existing && (!quote || quotedAmount !== amount || quoting)) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = existing || {amount, intentId: crypto.randomUUID(), quote: quote!};
      persist(next); setUncertain(true);
      const {response, data} = await walletFetch('/api/create-wallet-payment-code', requestBody(next));
      if (!response.ok || !data.paymentCode) throw new Error(data.error || 'Unable to generate a code.');
      const result: PaymentCode = data.paymentCode;
      if (terminal(result)) { await finishCode(result); return; }
      persist({...next, code: result});
      if (mounted.current) { setCode(result); setUncertain(false); setVerified(true); }
    } catch (e) {
      if (mounted.current) setError((e instanceof Error ? e.message : 'Request interrupted.') + ' Recover this same request before starting another load.');
    } finally {
      inFlight.current = false;
      if (mounted.current) { setBusy(false); if (closeRequested.current && (intent.current?.code || !intent.current)) void closeAction.current(); else if (closeRequested.current) { closeRequested.current = false; setClosing(false); } }
    }
  }

  async function closeLoad() {
    closeRequested.current = true;
    setClosing(true); setError('');
    if (inFlight.current) { setNotice('Finishing the current check before closing…'); return; }
    const old = intent.current;
    if (!old) { clear(); closeRequested.current = false; setClosing(false); onClose(); return; }
    if (!old.code) {
      if (!allowed) {
        closeRequested.current = false; setClosing(false);
        setError('The previous request is unconfirmed. Keep its reference and contact support; a new load cannot safely replace it yet.'); return;
      }
      setNotice('Recovering the previous request so its unused code can be closed…');
      await create(); return;
    }
    closeRequested.current = false;
    inFlight.current = true;
    try {
      const {response, data, finish} = await walletFetch('/api/create-wallet-payment-code', {
        operation: 'close', paymentCodeId: old.code.id,
      });
      if (!response.ok || !data.paymentCode || data.paymentCode.id !== old.code.id) throw new Error(data.error || 'Unable to confirm that the previous code has closed.');
      const next: PaymentCode = data.paymentCode;
      finish();
      if (!terminal(next)) {
        persist({...old, code: next});
        if (mounted.current) { setCode(next); setVerified(true); setNotice('Your payment is already processing. Wait for its result before starting a fresh load.'); }
        return;
      }
      await finishCode(next);
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) { setVerified(false); setError((e instanceof Error ? e.message : 'Closing was not confirmed.') + ' Retry Close to check the same code.'); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setClosing(false);
    }
  }
  closeAction.current = closeLoad;

  const canDial = code && verified && code.status === 'pending' && code.ussdCode && code.expireTime && Date.parse(code.expireTime) > Date.now();
  const discrepancy = completion?.settlement && completion.quote?.netMode && completion.settlement.creditMinor !== completion.quote.walletCreditMinor;
  return <section className="fixed inset-0 z-50 overflow-y-auto bg-slate-50 p-4 sm:p-8" aria-label="MatMove wallet top-up">
    <div className="mx-auto max-w-lg space-y-5 rounded-3xl bg-white p-6 shadow-lg">
      <div className="flex items-center justify-between"><h2 className="text-2xl font-bold">Load your wallet</h2><button type="button" onClick={() => void closeLoad()} disabled={closing} aria-label="Close top-up" className="rounded-xl p-2"><X size={22}/></button></div>
      {closing && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">Closing the previous load safely…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-800">{notice}</p>}
      {completion ? <>
        <div role="status" className="space-y-2 rounded-2xl bg-emerald-50 p-5 text-emerald-900">
          <h3 className="text-xl font-bold">Payment completed</h3>
          <p>Collection payment: <b>{money(completion.amount.value)}</b></p>
          {completion.settlement ? <><p>Monime processing fee: {money(completion.settlement.feeMinor)}</p><p>Net wallet credit: <b>{money(completion.settlement.creditMinor)}</b></p></> : <p>Your wallet balance has been refreshed from Monime. The detailed settlement receipt is not yet available here.</p>}
        </div>
        {discrepancy && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">Monime's actual credit differs from the estimate. Contact support with payment {completion.settlement?.paymentId} so the collection fee settings can be reconciled.</p>}
        <button type="button" onClick={() => {setCompletion(null); setNotice('Enter an amount for a fresh load.');}} className="w-full rounded-xl bg-blue-600 p-4 font-bold text-white">New load</button>
        <button type="button" onClick={() => void closeLoad()} disabled={closing} className="w-full rounded-xl border p-3 font-bold disabled:opacity-50">{closing ? 'Closing…' : 'Close'}</button>
      </> : !code ? <>
        <label className="block font-bold">Amount to add (SLE)<input inputMode="decimal" value={amount} disabled={busy || uncertain} onChange={e => {quoteSequence.current++; setAmount(e.target.value); setQuote(null); setQuotedAmount(''); setError('');}} className="mt-2 w-full rounded-xl border p-4 text-xl"/></label>
        {!allowed && <p className="text-red-700">Wallet payments require an approved, unfrozen account.</p>}
        {quoting && <p role="status" className="text-sm text-slate-600">Calculating fees…</p>}
        {quoteError && <p role="alert" className="text-red-700">{quoteError} Edit the amount to retry.</p>}
        {quote && quotedAmount === amount && !uncertain && <div className="space-y-2 rounded-xl bg-blue-50 p-4">
          {quote.netMode ? <><p>Expected wallet credit: <b>{money(quote.walletCreditMinor!)}</b></p><p>Collection processing fee: <b>{money(quote.feeMinor!)}</b></p><p>Payment requested from mobile money: <b>{money(quote.totalMinor)}</b></p><p className="text-sm">The collection fee is added above your wallet amount. Your network may separately charge a mobile-money service fee; confirm its final charge on your phone.</p></> : <><p>Payment amount: <b>{money(quote.totalMinor)}</b></p><p className="text-sm">Processing fees are deducted from this amount. Your wallet receives the net amount.</p></>}
        </div>}
        <button type="button" disabled={busy || closing || !allowed || (!uncertain && (quoting || !quote || quotedAmount !== amount))} onClick={() => void create()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 p-4 font-bold text-white disabled:opacity-50">{busy && <Loader2 size={20} className="animate-spin"/>}{uncertain ? 'Recover same payment request' : quote ? `Generate code — ${money(quote.totalMinor)}` : 'Generate payment code'}</button>
      </> : <>
        <p className="font-bold">Collection payment: {money(code.amount.value)}</p>
        {code.quote?.netMode && <p>Expected wallet credit: {money(code.quote.walletCreditMinor!)} · Processing fee: {money(code.quote.feeMinor!)}</p>}
        {canDial ? <><p>Dial this code with your Orange Money or Afrimoney SIM.</p><p className="break-all rounded-xl bg-slate-100 p-5 text-center font-mono text-3xl font-bold">{code.ussdCode}</p><div className="flex gap-3"><button type="button" onClick={() => void navigator.clipboard.writeText(code.ussdCode!).then(() => setNotice('Code copied.'), () => setNotice('Select and copy the code.'))} className="flex-1 rounded-xl border p-3 font-bold">Copy code</button><a href={`tel:${encodeURIComponent(code.ussdCode!)}`} className="flex-1 rounded-xl bg-blue-600 p-3 text-center font-bold text-white">Open dialler</a></div></> : <p role="status">{checking ? 'Verifying your previous payment…' : 'Checking payment status. No new payment is being created.'}</p>}
        <p className="text-sm">Status: {code.status}{code.expireTime ? ` · Expires ${new Date(code.expireTime).toLocaleString()}` : ''}</p>
        <button type="button" disabled={checking || busy || closing} onClick={() => void refresh()} className="w-full rounded-xl border p-3 font-bold disabled:opacity-50">{checking ? 'Checking…' : 'Check payment status'}</button>
        <button type="button" onClick={() => void closeLoad()} disabled={closing} className="w-full rounded-xl border p-3 font-bold disabled:opacity-50">{closing ? 'Closing…' : 'Close'}</button>
        {code.status === 'processing' && <button type="button" disabled={closing} onClick={onClose} className="w-full rounded-xl border p-3 text-sm font-bold">Return to dashboard — payment still processing</button>}
        <p className="text-sm text-slate-500">Close disables an unused code and clears this form. Next time you open Load, enter a new amount. A payment already processing must finish before another load.</p>
      </>}
    </div>
  </section>;
}
