import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CalendarDays, CheckCircle2, Clock3, ShieldCheck, Trophy, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Competition = {
  id: string;
  name: string;
  game_name: string;
  status: string;
  capacity: number;
  registration_opens_at: string;
  registration_closes_at: string | null;
  starts_at: string | null;
  entry_fee_minor: number | null;
  prize_minor: number | null;
  registration_open?: boolean;
  message?: string;
};

type RegistrationInfo = {
  gala_name: string | null;
  competition: Competition | null;
  competitions?: Competition[];
  registration_open: boolean;
  message: string;
};

type ExistingApplication = {
  id: string;
  reference_code: string;
  status: string;
  admin_note: string | null;
  submitted_at: string;
  updated_at: string;
} | null;

type ApplicationForm = {
  wallet_lookup: string;
  legal_name: string;
  country: 'Sierra Leone';
  phone: string;
  whatsapp_phone: string;
  email: string;
  efootball_user_id: string;
  team_name: string;
  terms_accepted: boolean;
  rules_accepted: boolean;
};

const emptyForm: ApplicationForm = {
  wallet_lookup: '',
  legal_name: '',
  country: 'Sierra Leone',
  phone: '',
  whatsapp_phone: '',
  email: '',
  efootball_user_id: '',
  team_name: '',
  terms_accepted: false,
  rules_accepted: false,
};

const field = 'mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50';
const dateLabel = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Freetown' }).format(new Date(value))
  : 'To be announced';
const statusLabel: Record<string, string> = {
  submitted: 'Submitted · awaiting review',
  needs_info: 'More information requested',
  approved: 'Approved · place confirmed',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
};

export default function GalaRegistration({ open, competitionId, onClose }: { open: boolean; competitionId?: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingApplication>(null);
  const [form, setForm] = useState<ApplicationForm>(emptyForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    setExisting(null);

    const load = async () => {
      try {
        const [infoResult, sessionResult] = await Promise.all([
          supabase.rpc('matmove_sports_public_registration_info'),
          supabase.auth.getSession(),
        ]);
        if (infoResult.error) throw infoResult.error;
        if (sessionResult.error) throw sessionResult.error;

        const feed = (infoResult.data || null) as RegistrationInfo | null;
        const selectedCompetition = competitionId
          ? feed?.competitions?.find(item => item.id === competitionId)
            || (feed?.competition?.id === competitionId ? feed.competition : null)
          : feed?.competition || null;
        const session = sessionResult.data.session;
        if (!active) return;
        setInfo(feed);
        setUserId(session?.user?.id || null);

        if (session?.user?.id) {
          const [profileResult, applicationResult] = await Promise.all([
            supabase.from('profiles')
              .select('full_name,first_name,last_name,phone,phone_number,email')
              .eq('id', session.user.id)
              .maybeSingle(),
            selectedCompetition?.id
              ? supabase.rpc('matmove_sports_my_application', { p_competition_id: selectedCompetition.id })
              : Promise.resolve({ data: { application: null }, error: null }),
          ]);
          if (profileResult.error) throw profileResult.error;
          if (applicationResult.error) throw applicationResult.error;
          if (!active) return;

          const profile = profileResult.data;
          const name = String(profile?.full_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || '').trim();
          const phone = String(profile?.phone_number || profile?.phone || '');
          setForm(current => ({
            ...current,
            legal_name: current.legal_name || name,
            phone: current.phone || phone,
            whatsapp_phone: current.whatsapp_phone || phone,
            email: current.email || String(profile?.email || session.user.email || ''),
          }));
          setExisting((applicationResult.data as any)?.application || null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Competition information could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [open, competitionId]);

  const pendingExisting = existing && ['submitted', 'approved', 'rejected', 'withdrawn'].includes(existing.status);
  const canResubmit = existing?.status === 'needs_info';
  const registration = useMemo(() => {
    if (!info) return null;
    if (!competitionId) return info.competition || null;
    return info.competitions?.find(item => item.id === competitionId)
      || (info.competition?.id === competitionId ? info.competition : null);
  }, [info, competitionId]);
  const registrationOpen = !!registration && (
    typeof registration.registration_open === 'boolean'
      ? registration.registration_open
      : info?.competition?.id === registration.id && info.registration_open
  );
  const dateWindow = useMemo(() => ({
    opens: dateLabel(registration?.registration_opens_at),
    closes: dateLabel(registration?.registration_closes_at),
  }), [registration?.registration_opens_at, registration?.registration_closes_at]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!userId) {
      setError('Sign in to your active MatMove account before submitting an application.');
      return;
    }
    if (!registration?.id || !registrationOpen) {
      setError('Registration for this season is not currently open.');
      return;
    }
    if (!form.terms_accepted || !form.rules_accepted) {
      setError('Accept both the Terms & Conditions and the competition rules to continue.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await supabase.rpc('matmove_sports_submit_application', {
        p_competition_id: registration.id,
        p_wallet_lookup: form.wallet_lookup.trim(),
        p_legal_name: form.legal_name.trim(),
        p_phone: form.phone.trim(),
        p_whatsapp_phone: form.whatsapp_phone.trim(),
        p_email: form.email.trim(),
        p_efootball_user_id: form.efootball_user_id.trim(),
        p_team_name: form.team_name.trim(),
        p_terms_accepted: form.terms_accepted,
        p_rules_accepted: form.rules_accepted,
      });
      if (result.error) throw result.error;
      const receipt = result.data as { reference_code?: string; status?: string; message?: string };
      setExisting({
        id: String((result.data as any)?.application_id || ''),
        reference_code: String(receipt.reference_code || ''),
        status: String(receipt.status || 'submitted'),
        admin_note: null,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setNotice(receipt.message || 'Your application has been submitted for Sports Admin review.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your application could not be submitted. Please check your details and retry.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="gala-registration-title" className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-[1.8rem] bg-[#f7faf8] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="relative overflow-hidden bg-[linear-gradient(115deg,#0c1e31_0%,#123b43_58%,#155c4e_100%)] px-5 py-6 text-white sm:px-8">
          <button type="button" onClick={onClose} aria-label="Close competition details" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20"><X size={19}/></button>
          <div className="flex items-start gap-4 pr-10">
            <span className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-emerald-200"><Trophy size={27}/></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-200">Official MatMove competition</p>
              <h2 id="gala-registration-title" className="mt-1 text-2xl font-black sm:text-3xl">{registration?.name || 'MatMove competition'}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-200">Player registration and eligibility application</p>
            </div>
          </div>
          {registration && <div className="mt-5 grid gap-2 rounded-2xl border border-white/15 bg-white/10 p-4 sm:grid-cols-3">
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-200">Season</p><p className="mt-1 text-sm font-bold">{registration.name}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-200">Registration opens</p><p className="mt-1 text-sm font-bold">{dateWindow.opens}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-200">Registration closes</p><p className="mt-1 text-sm font-bold">{dateWindow.closes}</p></div>
          </div>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className={'rounded-full px-3 py-1.5 ' + (registration?.status === 'in_progress' ? 'bg-sky-200 text-sky-950' : registrationOpen ? 'bg-emerald-300 text-emerald-950' : 'bg-amber-300 text-amber-950')}>{registration?.status === 'in_progress' ? 'Competition in progress' : registrationOpen ? 'Registration open' : 'Registration closed'}</span>
            <span className="rounded-full border border-white/20 px-3 py-1.5">{registration?.capacity || 16}-player competition</span>
            {registration?.starts_at && <span className="rounded-full border border-white/20 px-3 py-1.5">Starts {dateLabel(registration.starts_at)}</span>}
          </div>
        </header>

        <div className="space-y-5 p-5 sm:p-8">
          <section className="rounded-2xl border border-emerald-100 bg-white p-4 sm:p-5">
            <h3 className="font-black text-slate-950">Qualification requirements</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">You must meet every requirement before your application can be accepted.</p>
            <ul className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              {[
                'An active MatMove account',
                'MatMove KYC already approved',
                'A valid, active MatMove SLE wallet',
                'A valid eFootball User ID',
                'Your eFootball team name',
                'An active WhatsApp contact number',
              ].map(item => <li key={item} className="flex items-start gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700"/><span>{item}</span></li>)}
            </ul>
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Your SLE wallet must belong to the MatMove account you use to sign in and must not be frozen. MatMove Sports Admin checks your eligibility again before confirming a place.</p>
          </section>

          {loading && <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600">Checking the competition schedule…</p>}
          {!loading && error && !info && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          {!loading && !userId && <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="font-bold text-sky-950">Sign in to apply</p>
            <p className="mt-1 text-sm leading-6 text-sky-900">You need an active MatMove account to submit a competition application. Sign in first, then return here and select Apply again.</p>
            <button type="button" onClick={() => navigate('/login')} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1554a0] px-4 font-bold text-white">Sign in to MatMove <span className="ml-2">→</span></button>
          </div>}

          {!loading && userId && existing && !canResubmit && <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Your application</p>
            <p className="mt-1 text-lg font-black text-slate-950">{statusLabel[existing.status] || existing.status}</p>
            <p className="mt-2 text-sm text-slate-600">Reference: <b className="font-mono">{existing.reference_code}</b></p>
            {existing.admin_note && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{existing.admin_note}</p>}
            {existing.status === 'approved' && <p className="mt-3 text-sm text-emerald-800">Your application is approved. MatMove Admin will contact you using your submitted details.</p>}
          </div>}

          {!loading && userId && !pendingExisting && registrationOpen && registration && <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div><h3 className="text-lg font-black text-slate-950">Player application</h3><p className="mt-1 text-xs text-slate-500">All fields are required. Your application goes to MatMove Sports Admin for review.</p></div>
            <label className="block text-sm font-semibold text-slate-700">Legal name<input className={field} required minLength={2} maxLength={120} autoComplete="name" value={form.legal_name} onChange={e=>setForm({...form,legal_name:e.target.value})} placeholder="e.g. John Doe"/></label>
            <label className="block text-sm font-semibold text-slate-700">Country<input className={field+' bg-slate-50'} value="Sierra Leone" readOnly aria-readonly="true"/></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">Contact phone<input className={field} required type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+232…"/></label>
              <label className="block text-sm font-semibold text-slate-700">WhatsApp number<input className={field} required type="tel" value={form.whatsapp_phone} onChange={e=>setForm({...form,whatsapp_phone:e.target.value})} placeholder="+232…"/></label>
            </div>
            <label className="block text-sm font-semibold text-slate-700">Email address<input className={field} required type="email" autoComplete="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="you@example.com"/></label>
            <label className="block text-sm font-semibold text-slate-700">MatMove SLE Wallet ID<input className={field} required autoComplete="off" value={form.wallet_lookup} onChange={e=>setForm({...form,wallet_lookup:e.target.value})} placeholder="Enter your MatMove SLE Wallet ID"/><span className="mt-1 block text-xs font-normal text-slate-500">For your protection, the wallet must be linked to the MatMove account you are signed into.</span></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">eFootball User ID<input className={field} required minLength={2} maxLength={100} value={form.efootball_user_id} onChange={e=>setForm({...form,efootball_user_id:e.target.value})} placeholder="Your in-game account ID"/></label>
              <label className="block text-sm font-semibold text-slate-700">eFootball team name<input className={field} required minLength={2} maxLength={100} value={form.team_name} onChange={e=>setForm({...form,team_name:e.target.value})} placeholder="Your in-game team name"/></label>
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" required checked={form.terms_accepted} onChange={e=>setForm({...form,terms_accepted:e.target.checked})} className="mt-1 h-4 w-4 accent-emerald-700"/><span>I have read and accept the MatMove Terms & Conditions.</span></label>
              <label className="flex items-start gap-3 text-sm leading-6 text-slate-700"><input type="checkbox" required checked={form.rules_accepted} onChange={e=>setForm({...form,rules_accepted:e.target.checked})} className="mt-1 h-4 w-4 accent-emerald-700"/><span>I have read and accept the MatMove eFootball Gala competition rules and permission.</span></label>
              <p className="text-xs leading-5 text-slate-500">Your contact details and player information will be used to review and administer this competition application.</p>
            </div>
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            <button type="submit" disabled={submitting || !registrationOpen} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1554a0] px-5 font-bold text-white transition hover:bg-[#10427f] disabled:opacity-50">{submitting ? 'Submitting application…' : 'Submit player application'} <ShieldCheck size={17}/></button>
            <p className="text-xs leading-5 text-slate-500">Submitting an application does not guarantee a place. A MatMove Sports administrator must review and approve your registration.</p>
          </form>}

          {!loading && userId && !existing && !registrationOpen && registration && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-bold text-amber-950">Registration is currently closed</p>
            <p className="mt-1 text-sm leading-6 text-amber-900">{registration?.message || info?.message || 'Please check the published registration dates and return when applications open.'}</p>
          </div>}

          {!loading && !registration && <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">This competition is no longer published or accepting applications. Refresh the landing page to see current competitions.</div>}

          {notice && existing && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice} Your reference is <b className="font-mono">{existing.reference_code}</b>.</p>}
          <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500"><AlertCircle size={16} className="mt-0.5 shrink-0"/>Only submit details that belong to you. MatMove will verify the linked account, KYC and wallet before confirming a player place.</div>
          <div className="flex justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700">Close</button></div>
        </div>
      </section>
    </div>
  );
}
