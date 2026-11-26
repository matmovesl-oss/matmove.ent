import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Link2, Loader2, Share2, Smartphone, ShieldCheck, X } from 'lucide-react';
import { walletFetch } from '@/lib/apiFetch';

type ReceiveLink = {
  enabled: boolean;
  featureEnabled?: boolean;
  publicName?: string;
  publicUrl: string | null;
  recipientCode: string | null;
  smsReceiptsEnabled: boolean;
};

export default function ReceiveMoneyPanel({ sleWallet, role, onClose }: { sleWallet: any; role: 'rider' | 'driver' | 'merchant'; onClose: () => void }) {
  const [link, setLink] = useState<ReceiveLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [notice, setNotice] = useState('');
  const [copiedLabel, setCopiedLabel] = useState('');
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState('');

  const available = Boolean(
    sleWallet?.monime_account_id ||
    sleWallet?.metadata?.monime_account_id
  );

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const result = await walletFetch('/api/get-live-wallet', {
        action: 'receive_link_manage',
        operation: 'status'
      });
      if (!result.response.ok) throw new Error(result.data?.error || 'Could not load your receive-money link.');
      setLink(result.data as ReceiveLink);
      setSmsEnabled(Boolean(result.data?.smsReceiptsEnabled));
      setError('');
      result.finish();
    } catch (cause: any) {
      setError(cause?.message || 'Could not load your receive-money link.');
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function saveLink(nextSms = smsEnabled) {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = await walletFetch('/api/get-live-wallet', {
        action: 'receive_link_manage',
        enabled: true,
        smsReceiptsEnabled: nextSms
      });
      if (!result.response.ok) throw new Error(result.data?.error || 'Could not create your payment link.');
      setLink(result.data as ReceiveLink);
      setSmsEnabled(Boolean(result.data?.smsReceiptsEnabled));
      setNotice('Your secure MatMove payment link is ready to share.');
      result.finish();
    } catch (cause: any) {
      setError(cause?.message || 'Could not create your payment link.');
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('');
      setCopiedLabel(label);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedLabel(''), 1000);
    } catch {
      setError(`Unable to copy ${label.toLowerCase()}. Use your browser's share option instead.`);
    }
  }

  async function share() {
    if (!link?.publicUrl) return;
    try {
      const text = `Pay ${link.publicName || 'this MatMove account'} securely using MatMove.\n${link.publicUrl}\nRecipient code: ${link.recipientCode}`;
      if (navigator.share) await navigator.share({ title: 'MatMove — Receive Money', text, url: link.publicUrl });
      else await copy(text, 'Payment details');
    } catch (cause: any) {
      if (cause?.name !== 'AbortError') setError('Unable to share. Copy your payment link instead.');
    }
  }

  async function setSmsPreference(next: boolean) {
    setSmsEnabled(next);
    await saveLink(next);
  }

  async function disableLink() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await walletFetch('/api/get-live-wallet', {
        action: 'receive_link_manage',
        enabled: false
      });
      if (!result.response.ok) throw new Error(result.data?.error || 'Could not disable your payment link.');
      setLink({ enabled: false, publicUrl: null, recipientCode: result.data?.recipientCode || null, smsReceiptsEnabled: false });
      setSmsEnabled(false);
      setNotice('Your MatMove payment link has been disabled.');
      result.finish();
    } catch (cause: any) {
      setError(cause?.message || 'Could not disable your payment link.');
    } finally {
      setSaving(false);
    }
  }

  if (!available) return null;

  const roleTitle = role === 'driver' ? 'MatMove Driver Get Paid' : role === 'merchant' ? 'MatMove Merchant Get Paid' : 'MatMove Rider Get Paid';

  // The receiving alias comes from the authenticated wallet API, which verifies
  // ownership of this user's Monime financial account before returning it.
  // Preserve leading zeroes and build only the documented Monime payment URL.
  const monimeUvan = typeof sleWallet?.monime_uvan === 'string' && /^\d{6,20}$/.test(sleWallet.monime_uvan.trim())
    ? sleWallet.monime_uvan.trim()
    : null;
  const monimePaymentUrl = monimeUvan
    ? `https://pay.monime.io/${monimeUvan}`
    : null;

  async function shareMonimeLink() {
    if (!monimePaymentUrl) return;
    try {
      const shareText = `Pay me securely through Monime: ${monimePaymentUrl}\nMonime UVAN: ${monimeUvan}`;
      if (navigator.share) {
        await navigator.share({ title: 'MatMove — Get Paid', text: shareText, url: monimePaymentUrl });
      } else {
        await copy(monimePaymentUrl, 'MatMove payment link');
      }
    } catch (cause: any) {
      if (cause?.name !== 'AbortError') setError('Unable to share your Monime link. Copy it instead.');
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" className="mm-glass-tile max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl p-4 text-slate-800 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5" aria-labelledby="receive-money-title">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
        <div className="mm-glass-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <Link2 size={21}/>
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="receive-money-title" className="text-base font-extrabold">{roleTitle}</h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">Receive money securely into your MatMove SLE wallet.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Get paid" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-slate-600"><X size={19}/></button>
        </div>
      </div>

      {monimePaymentUrl && (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-100 bg-white/75 p-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">MatMove Get Paid</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">Receive money into your MatMove SLE wallet. Share your MatMove payment link or give someone your receiving code.</p>
            <p className="mt-2 break-all font-mono text-lg font-extrabold tracking-wide text-slate-900">{monimeUvan}</p>
            <p className="mt-2 text-xs font-medium text-slate-500">Your secure payment page is ready to share.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy(monimePaymentUrl, 'Monime Get Paid link')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"><Copy size={15}/>{copiedLabel === 'MatMove payment link' ? 'Copied ✓' : 'Copy link'}</button>
            <button type="button" onClick={() => void copy(monimeUvan, 'MatMove receiving code')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700"><Copy size={15}/>{copiedLabel === 'MatMove receiving code' ? 'Copied ✓' : 'Copy UVAN'}</button>
            <button type="button" onClick={() => void shareMonimeLink()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-blue-700 px-3 py-2 text-sm font-bold text-white"><Share2 size={15}/> Share payment link</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500" role="status"><Loader2 className="animate-spin" size={16}/> Checking your MatMove payment page…</div>
      ) : link?.enabled && link.publicUrl ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-white/90 bg-white/65 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Your secure MatMove link</p>
            <a href={link.publicUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm font-bold text-blue-800 underline decoration-blue-300 underline-offset-4 hover:text-blue-950" aria-label="Open your personal MatMove payment page in a new tab">{link.publicUrl}</a>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={link.publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 shadow-sm"><ExternalLink size={15}/> Open payment page</a>
              <button type="button" onClick={() => void copy(link.publicUrl!, 'Payment link')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm"><Copy size={15}/>{copiedLabel === 'Payment link' ? 'Copied ✓' : 'Copy link'}</button>
              <button type="button" onClick={() => void share()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 to-blue-700 px-3 py-2 text-sm font-bold text-white shadow-sm"><Share2 size={15}/> Share details</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/90 bg-white/60 p-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Recipient code</p>
              <p className="mt-1 font-mono text-lg font-extrabold tracking-widest text-blue-800">{link.recipientCode}</p>
            </div>
            <button type="button" onClick={() => void copy(link.recipientCode || '', 'Recipient code')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm"><Copy size={15}/>{copiedLabel === 'Recipient code' ? 'Copied ✓' : 'Copy code'}</button>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/90 bg-white/60 p-3">
            <input type="checkbox" checked={smsEnabled} disabled={saving} onChange={event => void setSmsPreference(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-700"/>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-800"><Smartphone size={15}/> SMS receipt to my phone</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">Send me an SMS after MatMove confirms an incoming payment. Your registered MatMove phone number is used.</span>
            </span>
          </label>
          <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-700"/> MatMove verifies incoming payments before crediting your wallet. Your payment link does not expose provider account details.</p>
          <button type="button" disabled={saving} onClick={() => void disableLink()} className="text-xs font-semibold text-slate-500 underline underline-offset-4 disabled:opacity-50">{saving ? 'Saving…' : 'Disable this payment link'}</button>
        </div>
      ) : link?.featureEnabled === false ? (
        <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/75 p-3 text-sm leading-6 text-blue-900">
          {monimePaymentUrl
            ? 'Your direct Monime Get Paid link is ready above. The additional MatMove-branded payment page is not enabled yet.'
            : 'Monime has not returned a valid receiving number for this wallet yet. Refresh your wallet and try again, or contact MatMove support.'}
        </p>
      ) : (
        <div className="mt-4">
          <button type="button" disabled={saving} onClick={() => void saveLink(false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-700 to-blue-700 px-4 py-3 text-sm font-extrabold text-white shadow-lg disabled:opacity-60">
            {saving ? <Loader2 className="animate-spin" size={16}/> : <Link2 size={16}/>}
            {saving ? 'Creating secure link…' : 'Create my pay link'}
          </button>
          <p className="mt-2 text-xs leading-5 text-slate-500">Your MatMove payment URL stays the same until you disable it. You can share it by WhatsApp, SMS or any messaging app.</p>
        </div>
      )}

      {copiedLabel && <p role="status" aria-live="polite" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">✓ {copiedLabel} copied</p>}
      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
    </div>
  );
}
