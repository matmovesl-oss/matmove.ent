import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, ShieldCheck, Wallet, CircleCheck, Smartphone } from 'lucide-react';

type PublicLink = { id: string; publicName: string; recipientCode: string; currency: 'SLE' };

export default function ReceivePayLinkPage() {
  const { slug = '' } = useParams();
  const [search] = useSearchParams();
  const [recipient, setRecipient] = useState<PublicLink | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(search.get('cancelled') === '1' ? 'The previous payment was cancelled. You can start again.' : '');

  useEffect(() => {
    let live = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/get-live-wallet?action=receive_link_public&slug=${encodeURIComponent(slug)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.id || !data?.publicName) throw new Error(data?.error || 'This MatMove payment link is unavailable.');
        if (live) setRecipient(data as PublicLink);
      } catch (cause: any) {
        if (live) setError(cause?.message || 'This MatMove payment link is unavailable.');
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => { live = false; };
  }, [slug]);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 1000000 || Math.round(value * 100) !== value * 100) {
      setError('Enter an amount from SLE 1 to SLE 1,000,000, with no more than two decimal places.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/create-monime-checkout?action=receive_checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          slug,
          amount: value,
          idempotencyKey: crypto.randomUUID()
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'MatMove could not start this payment.');
      if (data?.completed === true) {
        setNotice('This payment request has already been confirmed by MatMove.');
        return;
      }
      const target = new URL(data?.link);
      if (target.protocol !== 'https:' || !(target.hostname === 'monime.io' || target.hostname.endsWith('.monime.io'))) {
        throw new Error('The payment provider returned an unverified checkout link. Contact MatMove support.');
      }
      window.location.assign(target.toString());
    } catch (cause: any) {
      setError(cause?.message || 'Payment could not be started. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="portal-shell min-h-screen px-4 py-8 text-slate-800 sm:py-14">
      <div className="mx-auto max-w-lg">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/> MatMove</Link>
        <section className="mm-glass-tile mt-5 overflow-hidden rounded-[2rem] p-5 shadow-xl sm:p-7">
          <div className="mm-glass-hero relative overflow-hidden rounded-3xl p-5 text-white">
            <div className="relative z-10 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Wallet size={24}/></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-white/75">MatMove</p>
                <h1 className="text-2xl font-extrabold">Receive money</h1>
              </div>
            </div>
            <p className="relative z-10 mt-4 text-sm leading-6 text-white/85">Pay securely to a MatMove SLE wallet. Your payment goes directly to the recipient's verified Monime financial account.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status"><Loader2 className="animate-spin" size={18}/> Checking payment link…</div>
          ) : error && !recipient ? (
            <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700" role="alert">{error}</div>
          ) : recipient ? (
            <form onSubmit={pay} className="mt-6 space-y-5">
              <div className="rounded-2xl border border-white/90 bg-white/70 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">You're paying</p>
                <p className="mt-1 text-xl font-extrabold text-slate-900">{recipient.publicName}</p>
                <p className="mt-1 text-xs text-slate-500">MatMove verified receiving profile</p>
              </div>

              <label className="block">
                <span className="text-sm font-bold text-slate-700">Amount (SLE)</span>
                <span className="mt-2 flex items-center rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-inner focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100">
                  <span className="mr-3 text-sm font-bold text-emerald-800">SLE</span>
                  <input type="number" inputMode="decimal" min="1" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Enter amount" required className="min-w-0 flex-1 border-0 bg-transparent text-xl font-extrabold outline-none focus:ring-0"/>
                </span>
              </label>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/75 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-900"><ShieldCheck size={17}/> Protected by Monime</div>
                <p className="mt-1 text-xs leading-5 text-blue-800">Choose an available mobile-money option at checkout and approve the payment with your mobile-money PIN. Orange Money and Afrimoney availability is configured by the payment provider.</p>
              </div>

              <button type="submit" disabled={submitting || !amount} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-700 via-teal-700 to-blue-700 px-5 py-3 font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-55">
                {submitting ? <Loader2 className="animate-spin" size={18}/> : <ShieldCheck size={18}/>}
                {submitting ? 'Connecting securely…' : 'Continue to secure payment'}
              </button>
              {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
              {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            </form>
          ) : null}
        </section>
        <div className="mt-5 flex items-start justify-center gap-2 text-center text-xs leading-5 text-slate-500"><Smartphone size={14} className="mt-0.5 shrink-0"/> Paying from a basic phone? MatMove USSD is being configured. Use this link on a smartphone until the USSD code is published.</div>
        <p className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400"><CircleCheck size={13}/> MatMove · Secure payments in Sierra Leone</p>
      </div>
    </main>
  );
}

export function ReceivePaymentCompletePage() {
  const [search] = useSearchParams();
  const reference = search.get('ref') || '';
  return (
    <main className="portal-shell flex min-h-screen items-center justify-center px-4 py-10">
      <section className="mm-glass-tile w-full max-w-md rounded-[2rem] p-7 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-800"><CircleCheck size={30}/></div>
        <h1 className="mt-5 text-2xl font-extrabold text-slate-900">Payment submitted</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Monime has returned you to MatMove. The recipient's payment status is updated only after MatMove verifies the completed transaction.</p>
        {reference && <p className="mt-4 rounded-xl bg-white/80 p-3 font-mono text-sm font-bold text-blue-800">Reference: {reference}</p>}
        <Link to="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-700 to-blue-700 px-5 py-3 text-sm font-bold text-white">Return to MatMove</Link>
      </section>
    </main>
  );
}
