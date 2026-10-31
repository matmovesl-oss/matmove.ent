import {referralSignupNotice,recordSignupReferral,acknowledgeReferralNotice,type ReferralNotice} from '@/services/referralSignup';



import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef, useContext, createContext, type ReactNode, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { CarFront, Truck, Store, ArrowRight, ArrowLeft, Check, ShieldCheck, UploadCloud, Camera } from 'lucide-react';
import { OnboardingShell } from '@/components/AuthShell';
import { DocumentUpload, SelfieUpload, isUploadedKyc, verifyKycDocument } from '@/components/DocumentUpload';
import { useAuth } from '@/context/AuthContext';
import { roleLabels, roleDescriptions } from '@/services/roleService';
import type { UserRole, PersonalInfo, IdentityInfo, DriverInfo, MerchantInfo, UploadedDocument, DocumentType } from '@/types';

function ReferralSignupNotice({userId}:{userId:string}){
 const [notice,setNotice]=useState<ReferralNotice|null>(()=>referralSignupNotice(userId)),[busy,setBusy]=useState(false);const mounted=useRef(true),mutex=useRef(false);const identity=useRef(userId);identity.current=userId;
 useEffect(()=>{mounted.current=true;setNotice(referralSignupNotice(userId));return()=>{mounted.current=false;};},[userId]);
 async function retry(){if(mutex.current)return;mutex.current=true;setBusy(true);try{const next=await recordSignupReferral(userId);if(mounted.current&&identity.current===userId)setNotice(next);}finally{mutex.current=false;if(mounted.current&&identity.current===userId)setBusy(false);}}
 if(!notice||notice.acknowledged)return null;
 return <section aria-label="Signup referral status" className="mx-auto my-3 max-w-5xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800"><h2 className="font-bold">Signup referral</h2><p className="mt-1">{notice.message}</p>{notice.state!=='recorded'&&<><p className="mt-2">Check the same code before completing KYC, or continue without waiting for a referral. Your account and dashboard remain available. Continuing does not cancel a request already recorded by the server.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={()=>void retry()} className="min-h-11 rounded-xl border bg-white px-3 font-bold">{busy?'Checking referral…':'Retry referral code'}</button><button type="button" disabled={busy} onClick={()=>{try{acknowledgeReferralNotice(userId);setNotice(referralSignupNotice(userId));}catch{setNotice({...notice,message:'Browser storage is unavailable. Allow storage and retry.'});}}} className="min-h-11 px-3 font-bold underline">Continue without waiting for referral</button></div></>}</section>;
}

const KYC_DRAFT_KEYS = ['ob_personal','ob_identity','ob_docs','ob_selfie','ob_vehicle','ob_driver','ob_merchant'] as const;
const KycDraftContext = createContext({beforeSubmit: async () => {}, cancelSubmit: () => {}, finishSubmit: () => {}});
function readKycDraft(userId: string, role: string) {
  if (sessionStorage.getItem('ob_owner_id') !== userId) throw new Error('Your sign-in changed. Reload before editing verification.');
  const payload: Record<string, unknown> = {ob_role: role};
  for (const key of KYC_DRAFT_KEYS) {
    const raw = sessionStorage.getItem(key);
    if (raw) { try { payload[key] = JSON.parse(raw); } catch { throw new Error('A browser draft could not be read. Load your saved draft to continue.'); } }
  }
  return payload;
}

export function KycWorkspace({children}: {children: ReactNode}) {
  const {session, refreshSession} = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(session?.kycStatus === 'approved');
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Loading saved progress…');
  const [reload, setReload] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const version = useRef(0), savedDigest = useRef(''), paused = useRef(false), finished = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null), mounted = useRef(true), saveFailed = useRef(false);
  const step = useRef('personal');
  const userId = session?.user.id || '', role = session?.roles[0] || '';
  step.current = location.pathname.split('/').pop() || 'personal';
  const portal = `/customer/${role}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false); setError(''); paused.current = true; finished.current = false; saveFailed.current = false;
    void (async () => {
      const result = await supabase.rpc('matmove_customer_kyc_draft');
      if (result.error) throw new Error(result.error.message);
      if (!active) return;
      const record = result.data;
      if (!record || record.role !== role) throw new Error('The saved verification account could not be confirmed.');
      setLocked(record.locked === true);
      version.current = Number(record.version);
      if (!Number.isSafeInteger(version.current) || version.current < 0) throw new Error('The saved draft version is invalid.');
      const localTime = Number(sessionStorage.getItem('ob_local_updated_at') || 0);
      const serverTime = Date.parse(record.updatedAt || '') || 0;
      const hasLocal = KYC_DRAFT_KEYS.some(key => sessionStorage.getItem(key));
      const restore = reload > 0 || (!hasLocal && record.payload) || (serverTime > 0 && serverTime >= localTime);
      if (!record.locked && restore) {
        for (const key of KYC_DRAFT_KEYS) {
          if (record.payload && Object.prototype.hasOwnProperty.call(record.payload, key)) sessionStorage.setItem(key, JSON.stringify(record.payload[key]));
          else sessionStorage.removeItem(key);
        }
        sessionStorage.setItem('ob_local_updated_at', String(serverTime));
      }
      sessionStorage.setItem('ob_role', role);
      savedDigest.current = restore ? JSON.stringify({step: record.step, payload: readKycDraft(userId, role)}) : '';
      paused.current = record.locked === true;
      setSaveStatus(serverTime ? `Progress saved ${new Date(serverTime).toLocaleTimeString()}` : 'Your progress will save automatically.');
      setFormKey(key => key + 1); setReady(true);
      if (!record.locked && new URLSearchParams(location.search).get('resume') === '1') {
        const resumeStep = restore && ['personal','identity','documents','selfie','vehicle','review'].includes(record.step) ? record.step : 'personal';
        navigate(`/onboarding/${resumeStep}`, {replace: true});
      }
    })().catch(error => { if (active) { setError(error.message || 'Unable to load verification progress.'); setSaveStatus('Progress is not ready.'); } });
    return () => { active = false; };
  }, [userId, role, reload]);

  const persist = async (force = false): Promise<void> => {
    if (finished.current || (!force && paused.current)) return;
    if (inFlight.current) { await inFlight.current; return persist(force); }
    const payload = readKycDraft(userId, role);
    const digest = JSON.stringify({step: step.current, payload});
    if (digest === savedDigest.current) return;
    const work = (async () => {
      if (mounted.current) setSaveStatus('Saving progress…');
      const result = await supabase.rpc('matmove_save_kyc_draft', {p_expected: version.current, p_step: step.current, p_payload: payload});
      if (result.error) throw new Error(result.error.message);
      const next = Number(result.data?.version);
      if (!Number.isSafeInteger(next) || next !== version.current + 1) throw new Error('Draft saving was not confirmed. Reload your saved draft.');
      version.current = next; savedDigest.current = digest;
      if (mounted.current) { setError(''); setSaveStatus(`Progress saved ${new Date(result.data.savedAt).toLocaleTimeString()}`); }
    })();
    inFlight.current = work;
    try { await work; }
    catch (error) {
      paused.current = true; saveFailed.current = true;
      if (mounted.current) {
        const message = error instanceof Error ? error.message : 'Unable to save progress.';
        setError(message); setSaveStatus('Progress could not be saved.');
        if (message.startsWith('LOCKED:')) { setLocked(true); void refreshSession().catch(() => {}); }
      }
      throw error;
    } finally { inFlight.current = null; }
  };

  useEffect(() => {
    if (!ready || locked) return;
    const timer = window.setInterval(() => { void persist().catch(() => {}); }, 1200);
    const statusTimer = window.setInterval(() => {
      void supabase.from('profiles').select('kyc_status').eq('id', userId).single().then(({data}) => {
        if (mounted.current && data?.kyc_status === 'approved') { paused.current = true; setLocked(true); void refreshSession().catch(() => {}); }
      });
    }, 10000);
    return () => { window.clearInterval(timer); window.clearInterval(statusTimer); };
  }, [ready, locked, userId]);

  const beforeSubmit = async () => { const referral=await recordSignupReferral(userId);if(referral&&referral.state!=='recorded'&&!referral.acknowledged)throw new Error('Your account is ready, but the referral needs attention. Use Retry referral code or Continue without waiting for referral above.');paused.current = true; try { await persist(true); } catch (error) { throw error; } };
  const lockAndExit = async () => {
    if (inFlight.current) await inFlight.current.catch(() => {});
    try { paused.current = true; await persist(true); navigate(portal); }
    catch { /* Keep the form open and show the save error. */ }
  };
  if (locked) return <div className="mx-auto max-w-xl space-y-4 p-8"><ShieldCheck size={42} className="text-green-700"/><h1 className="text-2xl font-bold">Verified identity — locked</h1><p>Your identity is approved. Contact MatMove support or an administrator for changes.</p><button className="primary-button" onClick={() => navigate(portal)}>Access dashboard</button></div>;
  return <KycDraftContext.Provider value={{beforeSubmit, cancelSubmit: () => { if (!saveFailed.current) paused.current = false; }, finishSubmit: () => { finished.current = true; paused.current = true; }}}>
    <div className="sticky top-0 z-40 border-b bg-white p-3 shadow-sm"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-slate-600">{saveStatus}</p>
      {ready && <button type="button" onClick={() => void lockAndExit()} className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-800">Save & lock</button>}
    </div>{error && <div role="alert" className="mx-auto mt-2 max-w-5xl rounded-xl bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button className="mt-2 font-bold underline" onClick={() => { if (sessionStorage.getItem('ob_owner_id') === userId) { const backup = Object.fromEntries(KYC_DRAFT_KEYS.map(key => [key, sessionStorage.getItem(key)])); sessionStorage.setItem('ob_draft_backup', JSON.stringify(backup)); } setReload(n => n + 1); }}>Load saved version</button></div>}</div>
    <ReferralSignupNotice key={userId} userId={userId}/>
    {ready ? <div key={formKey}>{children}</div> : !error ? <p role="status" className="p-8">Loading your verification draft…</p> : null}
  </KycDraftContext.Provider>;
}

type OnboardingPersonalInfo = Partial<PersonalInfo> & { phone?: string; };

function useOnboardingState<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    const stored = sessionStorage.getItem(key);
    if (!stored) return initialValue;
    try {
      return JSON.parse(stored) as T;
    } catch {
      sessionStorage.removeItem(key);
      return initialValue;
    }
  });

  const setPersistentState = (value: SetStateAction<T>) => {
    setState(previous => {
      const next = typeof value === 'function' ? (value as (old:T)=>T)(previous) : value;
      try {sessionStorage.setItem(key, JSON.stringify(next)); sessionStorage.setItem('ob_local_updated_at', String(Date.now()));} catch {/* Keep draft in memory. */}
      return next;
    });
  };

  return [state, setPersistentState] as const;
}

function getActiveRole(): UserRole {
  const storedRole = sessionStorage.getItem('ob_role');

  if (
    storedRole === 'rider' ||
    storedRole === 'driver' ||
    storedRole === 'merchant'
  ) {
    return storedRole;
  }

  return 'rider';
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[^\d+]/g, '');
}

export function RoleSelectionPage() {
  const navigate = useNavigate();
  const { session, saveAccount, loading } = useAuth();
  const [selected, setSelected] = useState<UserRole | null>(session?.roles[0] || null);
  const [phone, setPhone] = useState(session?.user.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const proceeding=useRef(false),accountNow=useRef(session?.user.id),alive=useRef(true);accountNow.current=session?.user.id;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{proceeding.current=false;setBusy(false);setSelected(session?.roles[0]||null);setPhone(session?.user.phone||'');},[session?.user.id]);
  useEffect(() => {
    if (session?.roles[0]) setSelected(session.roles[0]);
    if (session?.user.phone) setPhone(session.user.phone);
  }, [session]);
  const proceed = async (skip: boolean) => {
    if (!selected || busy || proceeding.current || !session?.user.id) return;
    const actor=session.user.id;proceeding.current=true;
    setBusy(true); setError('');
    try {
      const current = await saveAccount(selected, phone);
      if(!alive.current||accountNow.current!==actor||current.user.id!==actor)return;
      navigate(skip ? `/customer/${current.roles[0]}` : '/onboarding/personal');
    } catch (error: any) { if(alive.current&&accountNow.current===actor)setError(error.message || 'Unable to save your account.'); }
    finally { if(alive.current&&accountNow.current===actor){proceeding.current=false;setBusy(false);} }
  };
  return <OnboardingShell step={2}><div className="ob-page animate-in">
    <h2 className="ob-title">How will you use MatMove?</h2>
    <p className="ob-subtitle">Save your phone number and account type. You can verify your identity now or later.</p>
    <div className="role-choice-grid">{([
      { key: 'rider', Icon: CarFront }, { key: 'driver', Icon: Truck }, { key: 'merchant', Icon: Store }
    ] as const).map(({ key, Icon }) => <button key={key} type="button"
      className={`role-choice-card ${selected === key ? 'selected' : ''}`}
      disabled={busy || (!!session?.roles.length && session.roles[0] !== key)} onClick={() => setSelected(key)}>
      <Icon size={26}/><strong>{roleLabels[key]}</strong><span>{roleDescriptions[key]}</span>
      {selected === key && <Check size={16}/>}</button>)}</div>
    <label className="field mt-6"><span>Phone number</span><input type="tel" autoComplete="tel" className="input-field" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000 000" /></label>
    <p className="mt-4 text-sm text-slate-600">Riders can load their wallet before verification. Transfers and withdrawals require completed verification. Driver and merchant wallets require approval.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="ob-actions"><button type="button" className="primary-button" disabled={!selected || !phone.trim() || busy || loading} onClick={() => void proceed(false)}>{busy ? 'Saving…' : 'Verify identity now'}<ArrowRight size={17}/></button>
    <button type="button" className="back-button" disabled={!selected || !phone.trim() || busy || loading} onClick={() => void proceed(true)}>Skip KYC for now</button></div>
  </div></OnboardingShell>;
}

export function PersonalInfoPage() {
  const navigate = useNavigate();
  const { session } = useAuth();

  const [info, setInfo] = useOnboardingState<OnboardingPersonalInfo>(
    'ob_personal',
    {
      firstName: session?.user.firstName || '',
      middleName: '',
      lastName: session?.user.lastName || '',
      phone: session?.user.phone || '',
      dateOfBirth: '',
      nationality: 'Sierra Leonean',
      country: 'Sierra Leone',
      residentialAddress: '',
      city: ''
    }
  );

  useEffect(() => {
    let active = true;
    if (!session?.user.id || sessionStorage.getItem('ob_personal')) return;
    void supabase.from('profiles').select('first_name,last_name,phone,date_of_birth,nationality,country,residential_address,city').eq('id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (!active || error || !data) return;
      setInfo(previous => ({ ...previous, firstName: previous.firstName || data.first_name || '',
        lastName: previous.lastName || data.last_name || '', phone: previous.phone || data.phone || '',
        dateOfBirth: previous.dateOfBirth || data.date_of_birth || '', nationality: data.nationality || previous.nationality,
        country: data.country || previous.country, residentialAddress: previous.residentialAddress || data.residential_address || '',
        city: previous.city || data.city || '' }));
    });
    return () => { active = false; };
  }, [session?.user.id]);

  const update = (
    field: keyof OnboardingPersonalInfo,
    value: string
  ) => setInfo({ ...info, [field]: value });

  const normalizedPhone = normalizePhone(info.phone ?? '');

  const isValid = Boolean(
    info.firstName?.trim() &&
    info.lastName?.trim() &&
    normalizedPhone &&
    info.dateOfBirth &&
    info.residentialAddress?.trim() &&
    info.city?.trim()
  );

  return (
    <OnboardingShell step={3}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">Personal information</h2>

        <p className="ob-subtitle">
          Tell us about yourself. This information is kept private and secure.
        </p>

        <div className="ob-form-grid">
          <Field label="First name">
            <input
              className="ob-input"
              value={info.firstName ?? ''}
              onChange={(e) => update('firstName', e.target.value)}
              placeholder="Aisha"
            />
          </Field>

          <Field label="Middle name (Optional)">
            <input
              className="ob-input"
              value={info.middleName ?? ''}
              onChange={(e) => update('middleName', e.target.value)}
              placeholder="Mariama"
            />
          </Field>

          <Field label="Last name">
            <input
              className="ob-input"
              value={info.lastName ?? ''}
              onChange={(e) => update('lastName', e.target.value)}
              placeholder="Kamara"
            />
          </Field>

          <Field label="Phone number">
            <input
              className="ob-input"
              value={info.phone ?? ''}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+232 76 123 456"
              inputMode="tel"
            />
          </Field>

          <Field label="Date of birth">
            <input
              className="ob-input"
              type="date"
              value={info.dateOfBirth ?? ''}
              onChange={(e) => update('dateOfBirth', e.target.value)}
            />
          </Field>

          <Field label="Nationality">
            <input
              className="ob-input"
              value={info.nationality ?? ''}
              onChange={(e) => update('nationality', e.target.value)}
            />
          </Field>

          <Field label="Country">
            <input
              className="ob-input"
              value={info.country ?? ''}
              onChange={(e) => update('country', e.target.value)}
            />
          </Field>

          <Field label="Residential address" full>
            <input
              className="ob-input"
              value={info.residentialAddress ?? ''}
              onChange={(e) => update('residentialAddress', e.target.value)}
              placeholder="123 Lumley Beach Road"
            />
          </Field>

          <Field label="City">
            <input
              className="ob-input"
              value={info.city ?? ''}
              onChange={(e) => update('city', e.target.value)}
              placeholder="Freetown"
            />
          </Field>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/select-role')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!isValid}
            onClick={() => {
              setInfo({ ...info, phone: normalizedPhone });
              navigate('/onboarding/identity');
            }}
          >
            Continue <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function IdentityPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [identity, setIdentity] =
    useOnboardingState<Partial<IdentityInfo>>(
      'ob_identity',
      {
        idType: '',
        idNumber: '',
        idIssuingCountry: 'Sierra Leone',
        idExpiryDate: ''
      }
    );

  const [driver, setDriver] =
    useOnboardingState<Partial<DriverInfo>>(
      'ob_driver',
      {
        licenseNumber: '',
        licenseClass: '',
        issueDate: '',
        expiryDate: ''
      }
    );

  const [merchant, setMerchant] =
    useOnboardingState<
      Partial<MerchantInfo> & { infrastructure?: string }
    >(
      'ob_merchant',
      {
        businessName: '',
        businessType: '',
        businessRegNumber: '',
        businessAddress: '',
        authRepName: '',
        authRepPhone: '',
        infrastructure: 'Physical Shop / Location'
      }
    );

  const updateId = (field: keyof IdentityInfo, value: string) =>
    setIdentity({ ...identity, [field]: value });

  const updateDriver = (field: keyof DriverInfo, value: string) =>
    setDriver({ ...driver, [field]: value });

  const updateMerchant = (field: string, value: string) =>
    setMerchant({ ...merchant, [field]: value });

  const idTypes =
    role === 'driver'
      ? ["Driver's License"]
      : role === 'merchant'
        ? ['National ID', 'Passport', 'Business Registration']
        : ['National ID', 'Passport'];

  const currentIdType =
    identity.idType && idTypes.includes(identity.idType)
      ? identity.idType
      : idTypes[0];

  const isDigitalMerchant =
    role === 'merchant' &&
    merchant.infrastructure === 'Digital / Online Only';

  const hideStandardIdFields =
    (role === 'driver' && currentIdType === "Driver's License") ||
    (role === 'merchant' && currentIdType === 'Business Registration');

  useEffect(() => {
    if (identity.idType !== currentIdType) {
      updateId('idType', currentIdType);
    }
  }, [identity.idType, currentIdType]);

  return (
    <OnboardingShell step={4}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">
          {role === 'driver'
            ? 'Driver identity'
            : role === 'merchant'
              ? 'Business identity'
              : 'Identity verification'}
        </h2>

        <div className="ob-form-grid">
          <Field label="ID type">
            <div className="ob-select-wrap">
              <select
                className="ob-input"
                value={currentIdType}
                onChange={(e) => updateId('idType', e.target.value)}
              >
                {idTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
          </Field>

          {!hideStandardIdFields && (
            <>
              <Field label="ID number">
                <input
                  className="ob-input"
                  value={identity.idNumber ?? ''}
                  onChange={(e) => updateId('idNumber', e.target.value)}
                />
              </Field>

              <Field label="ID expiry date">
                <input
                  className="ob-input"
                  type="date"
                  value={identity.idExpiryDate ?? ''}
                  onChange={(e) => updateId('idExpiryDate', e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="ID issuing country">
            <input
              className="ob-input"
              value={identity.idIssuingCountry ?? ''}
              onChange={(e) => updateId('idIssuingCountry', e.target.value)}
            />
          </Field>
        </div>

        {role === 'driver' && (
          <div className="ob-form-grid mt-6">
            <Field label="Driver License Number">
              <input
                className="ob-input"
                value={driver.licenseNumber ?? ''}
                onChange={(e) =>
                  updateDriver('licenseNumber', e.target.value)
                }
              />
            </Field>

            <Field label="License class">
              <input
                className="ob-input"
                value={driver.licenseClass ?? ''}
                onChange={(e) =>
                  updateDriver('licenseClass', e.target.value)
                }
              />
            </Field>
          </div>
        )}

        {role === 'merchant' && (
          <div className="ob-form-grid mt-6">
            <Field label="Business name">
              <input
                className="ob-input"
                value={merchant.businessName ?? ''}
                onChange={(e) =>
                  updateMerchant('businessName', e.target.value)
                }
              />
            </Field>

            <Field label="Infrastructure">
              <div className="ob-select-wrap">
                <select
                  className="ob-input"
                  value={merchant.infrastructure ?? ''}
                  onChange={(e) =>
                    updateMerchant('infrastructure', e.target.value)
                  }
                >
                  <option>Physical Shop / Location</option>
                  <option>Digital / Online Only</option>
                </select>
              </div>
            </Field>

            {!isDigitalMerchant && (
              <Field label="Business registration number">
                <input
                  className="ob-input"
                  value={merchant.businessRegNumber ?? ''}
                  onChange={(e) =>
                    updateMerchant('businessRegNumber', e.target.value)
                  }
                />
              </Field>
            )}

            <Field label="Business address" full>
              <input
                className="ob-input"
                value={merchant.businessAddress ?? ''}
                onChange={(e) =>
                  updateMerchant('businessAddress', e.target.value)
                }
              />
            </Field>
          </div>
        )}

        <div className="ob-actions mt-8">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/onboarding/personal')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={() => navigate('/onboarding/documents')}
          >
            Continue <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function DocumentsPage() {
  const {session}=useAuth();
  const navigate = useNavigate();
  const role = getActiveRole();

  const [merchant] =
    useOnboardingState<
      Partial<MerchantInfo> & { infrastructure?: string }
    >('ob_merchant', {});

  let displayDocs: {
    id: string;
    label: string;
    required: boolean;
  }[] = [];

  if (role === 'driver') {
    displayDocs = [
      {
        id: 'license_doc',
        label: "Driver's License",
        required: true
      }
    ];
  } else if (role === 'merchant') {
    if (merchant.infrastructure === 'Digital / Online Only') {
      displayDocs = [
        {
          id: 'id_front',
          label: 'Identity Card (Front)',
          required: true
        },
        {
          id: 'id_back',
          label: 'Identity Card (Back)',
          required: true
        }
      ];
    } else {
      displayDocs = [
        {
          id: 'business_doc',
          label: 'Business Registration Document',
          required: true
        },
        {
          id: 'business_doc_2',
          label: 'Additional Document (Optional)',
          required: false
        }
      ];
    }
  } else {
    displayDocs = [
      {
        id: 'id_front',
        label: 'National ID (Front)',
        required: true
      },
      {
        id: 'id_back',
        label: 'National ID (Back)',
        required: true
      }
    ];
  }

  const [docs, setDocs] =
    useOnboardingState<Record<string, any>>('ob_docs', {});

  const handleUpload = (type: string, document: any) => {
    setDocs(previous => ({ ...previous, [type]: document }));
  };

  const handleRemove = (type: string) => {
    setDocs(previous => {const next={...previous};delete next[type];return next;});
  };

  const allUploaded = !!session?.user.id && displayDocs
    .filter((d) => d.required)
    .every((d) => isUploadedKyc(docs[d.id],session?.user.id)) && !Object.values(docs).some((d:any)=>d?.status==='uploading');

  return (
    <OnboardingShell step={5}>
      <style>
        {`.premium-dropzones [data-doc-type] { border: 2px dashed #cbd5e1; border-radius: 1.25rem; padding: 2.5rem 2rem; text-align: center; background: #f8fafc; transition: all 0.2s ease-in-out; margin-bottom: 1.5rem; }`}
      </style>

      <div className="ob-page animate-in premium-dropzones">
        <h2 className="ob-title">Upload your documents</h2>

        <div className="doc-upload-list grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {displayDocs.map((docConfig) => (
            <div key={docConfig.id} className="flex flex-col">
              <span className="mb-3 font-bold text-slate-700 ml-1">
                {docConfig.label}
              </span>

              <div data-doc-type={docConfig.id} className="relative">
                {!docs[docConfig.id] && (
                  <UploadCloud
                    className="mx-auto mb-4 text-[#184f9a]"
                    size={36}
                  />
                )}

                <DocumentUpload
                  type={docConfig.id as any}
                  document={docs[docConfig.id]}
                  onUpload={(doc) => handleUpload(docConfig.id, doc)}
                  onRemove={() => handleRemove(docConfig.id)}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/onboarding/identity')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!allUploaded}
            onClick={() => navigate('/onboarding/selfie')}
          >
            Continue <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SelfiePage() {
  const {session}=useAuth();
  const navigate = useNavigate();
  const role = getActiveRole();

  const [selfie, setSelfie] =
    useState<UploadedDocument | undefined>(undefined);

  useEffect(() => {
    const stored = sessionStorage.getItem('ob_selfie');

    if (stored) {
      try {
        setSelfie(JSON.parse(stored) as UploadedDocument);
      } catch {
        sessionStorage.removeItem('ob_selfie');
      }
    }
  }, []);

  const handleSelfieUpload = (document: UploadedDocument) => {
    setSelfie(document);
    if(isUploadedKyc(document,session?.user.id)) { sessionStorage.setItem('ob_selfie', JSON.stringify(document)); sessionStorage.setItem('ob_local_updated_at', String(Date.now())); }
    else sessionStorage.removeItem('ob_selfie');
  };

  const handleSelfieRemove = () => {
    setSelfie(undefined);
    sessionStorage.removeItem('ob_selfie');
  };

  return (
    <OnboardingShell step={6}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">Selfie verification</h2>

        <div className="flex flex-col md:flex-row gap-8 items-start mt-8">
          <div className="flex-1 w-full bg-slate-50 p-8 rounded-3xl border-2 border-dashed border-slate-200 text-center relative">
            {!selfie && (
              <Camera
                className="mx-auto mb-4 text-[#184f9a] bg-white p-3 rounded-full shadow-md"
                size={64}
              />
            )}

            <SelfieUpload
              document={selfie}
              onUpload={handleSelfieUpload}
              onRemove={handleSelfieRemove}
            />
          </div>
        </div>

        <div className="ob-actions">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/onboarding/documents')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!session || !isUploadedKyc(selfie,session.user.id)}
            onClick={() =>
              navigate(
                role === 'driver'
                  ? '/onboarding/vehicle'
                  : '/onboarding/review'
              )
            }
          >
            Continue <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function VehicleSelectionPage() {
  const navigate = useNavigate();

  const [vehicle, setVehicle] = useOnboardingState<{
    type: string;
    plateNumber: string;
    region: string;
  }>(
    'ob_vehicle',
    {
      type: '',
      plateNumber: '',
      region: 'West (Freetown)'
    }
  );

  const isValid = Boolean(
    vehicle.type &&
    vehicle.plateNumber?.trim() &&
    vehicle.region
  );

  const vehicleTypes = [
    { name: 'Motorbike (Okada)', image: '/bike.jpg' },
    { name: 'Tricycle (Keke)', image: '/keke.jpg' },
    { name: 'Car', image: '/car.jpg' },
    { name: 'Van / Truck', image: '/van.jpg' },
  ];

  return (
    <OnboardingShell step={6.5 as any}>
      <div className="ob-page animate-in">
        <h2 className="ob-title font-extrabold tracking-tight">
          Vehicle details
        </h2>

        <p className="ob-subtitle mb-6">
          Provide details about the vehicle you will be driving.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {vehicleTypes.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => setVehicle({ ...vehicle, type: v.name })}
              className={`p-4 rounded-2xl border-2 text-center transition-all flex flex-col items-center gap-2 ${
                vehicle.type === v.name
                  ? 'border-[#184f9a] bg-[#eff6ff] text-[#184f9a] font-bold'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {v.image && (
                <img
                  src={v.image}
                  alt={v.name}
                  className="h-16 object-contain mix-blend-multiply"
                />
              )}
              {v.name}
            </button>
          ))}
        </div>

        <div className="ob-form-grid bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <Field label="License Plate Number">
            <input
              className="ob-input uppercase font-bold"
              placeholder="e.g. AB 1234"
              value={vehicle.plateNumber}
              onChange={(e) =>
                setVehicle({ ...vehicle, plateNumber: e.target.value })
              }
            />
          </Field>

          <Field label="Operating Region">
            <div className="ob-select-wrap">
              <select
                className="ob-input font-medium"
                value={vehicle.region}
                onChange={(e) =>
                  setVehicle({ ...vehicle, region: e.target.value })
                }
              >
                <option>West (Freetown)</option>
                <option>East (Kenema, Kono)</option>
                <option>South (Bo)</option>
                <option>North (Makeni)</option>
              </select>
            </div>
          </Field>
        </div>

        <div className="ob-actions mt-8">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/onboarding/selfie')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            disabled={!isValid}
            onClick={() => navigate('/onboarding/review')}
          >
            Continue <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function ReviewPage() {
  const { session, loading, refreshSession } = useAuth();
  const navigate = useNavigate();
  const role = getActiveRole();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const draft = useContext(KycDraftContext);

  const [info] =
    useOnboardingState<OnboardingPersonalInfo>('ob_personal', {});

  const [identity] =
    useOnboardingState<Partial<IdentityInfo>>('ob_identity', {});

  const [merchant] =
    useOnboardingState<
      Partial<MerchantInfo> & { infrastructure?: string }
    >('ob_merchant', {});

  const [driver] =
    useOnboardingState<Partial<DriverInfo>>('ob_driver', {});

  const [vehicle] = useOnboardingState<{
    type: string;
    plateNumber: string;
    region: string;
  }>(
    'ob_vehicle',
    {
      type: '',
      plateNumber: '',
      region: ''
    }
  );

  const [docs] =
    useOnboardingState<Record<string, any>>('ob_docs', {});

  const selfieRaw = sessionStorage.getItem('ob_selfie');
  const selfieData:UploadedDocument|null = (()=>{try{return selfieRaw?JSON.parse(selfieRaw):null;}catch{return null;}})();

  const displayPhone = normalizePhone(
    info.phone ?? session?.user?.phone ?? ''
  );

  const handleFinalSubmit = async () => {
    if (isSubmitting || loading) return;
    if (session?.kycStatus === 'approved') { setSubmitError('Your verified identity is locked. Contact MatMove support for changes.'); return; }
    if (!session) { navigate('/login'); return; }
    if (!displayPhone) { setSubmitError('Please complete your phone number in Personal information.'); return; }
    setIsSubmitting(true); setSubmitError('');
    try {
      await draft.beforeSubmit();
      const userId = session.user.id;
      const required = role === 'driver' ? ['license_doc'] : role === 'merchant' && merchant.infrastructure !== 'Digital / Online Only' ? ['business_doc'] : ['id_front', 'id_back'];
      for (const key of required) await verifyKycDocument(docs[key], userId);
      await verifyKycDocument(selfieData, userId);
      const canonicalType: Record<string,string> = { id_front:'identity_front', id_back:'identity_back', license_doc:'drivers_license_front', business_doc:'business_document', business_doc_2:'business_document' };
      const uploaded = [...Object.values(docs), selfieData].filter((document: any) => isUploadedKyc(document, userId));
      const documents = [...new Map(uploaded.map((document: any) => [document.id, document])).values()].map((document: any) => ({
        document_type: canonicalType[document.type] || document.type, storage_path: document.id,
        file_name: document.fileName, file_size_bytes: document.fileSize
      }));
      const result = await supabase.rpc('matmove_submit_customer_kyc', {
        p_role: role,
        p_details: { ...info, phone: displayPhone, vehicleType: vehicle.type, plateNumber: vehicle.plateNumber,
          driverLicenseNumber: driver.licenseNumber || identity.idNumber || '', businessName: merchant.businessName || '',
          businessType: merchant.infrastructure || '', businessRegNumber: merchant.businessRegNumber || '' },
        p_documents: documents
      });
      if (result.error || result.data?.success !== true) throw new Error(result.error?.message || 'Verification submission was not confirmed. Retry without creating another account.');
      draft.finishSubmit();
      await refreshSession();
      ['ob_local_updated_at','ob_personal','ob_identity','ob_docs','ob_selfie','ob_vehicle','ob_driver','ob_merchant'].forEach(key => sessionStorage.removeItem(key));
      navigate('/onboarding/submitted');
    } catch (error: any) { draft.cancelSubmit(); setSubmitError(error.message || 'Unable to submit. Please retry.'); }
    finally { setIsSubmitting(false); }
  };

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">Review your submission</h2>
        {submitError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">{submitError}</p>}

        <div className="space-y-6 mt-8">
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="text-xl font-bold text-[#184f9a] capitalize">
              {roleLabels[role]}
            </div>
          </div>

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
              <div>
                <small className="block text-slate-500">Full name</small>
                <strong className="text-slate-900">
                  {info.firstName} {info.middleName} {info.lastName}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">Phone</small>
                <strong className="text-slate-900">{displayPhone}</strong>
              </div>

              <div>
                <small className="block text-slate-500">Email</small>
                <strong className="text-slate-900">
                  {session?.user?.email || '—'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">Date of Birth</small>
                <strong className="text-slate-900">
                  {info.dateOfBirth || '—'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">Nationality</small>
                <strong className="text-slate-900">
                  {info.nationality || '—'}
                </strong>
              </div>

              <div>
                <small className="block text-slate-500">Address</small>
                <strong className="text-slate-900">
                  {info.residentialAddress || '—'}, {info.city}, {info.country}
                </strong>
              </div>

              {role === 'driver' && (
                <>
                  <div>
                    <small className="block text-slate-500">
                      Driver License Number
                    </small>
                    <strong className="text-slate-900">
                      {driver.licenseNumber || '—'}
                    </strong>
                  </div>

                  <div>
                    <small className="block text-slate-500">
                      License Class
                    </small>
                    <strong className="text-slate-900">
                      {driver.licenseClass || '—'}
                    </strong>
                  </div>

                  <div>
                    <small className="block text-slate-500">
                      Vehicle Info
                    </small>
                    <strong className="text-slate-900">
                      {vehicle.type || '—'} ({vehicle.plateNumber || '—'})
                    </strong>
                  </div>

                  <div>
                    <small className="block text-slate-500">
                      Operating Region
                    </small>
                    <strong className="text-slate-900">
                      {vehicle.region || '—'}
                    </strong>
                  </div>
                </>
              )}

              {role === 'merchant' && (
                <>
                  <div>
                    <small className="block text-slate-500">
                      Business Name
                    </small>
                    <strong className="text-slate-900">
                      {merchant.businessName || '—'}
                    </strong>
                  </div>

                  <div>
                    <small className="block text-slate-500">
                      Infrastructure
                    </small>
                    <strong className="text-slate-900">
                      {merchant.infrastructure || '—'}
                    </strong>
                  </div>

                  <div>
                    <small className="block text-slate-500">
                      Business Address
                    </small>
                    <strong className="text-slate-900">
                      {merchant.businessAddress || '—'}
                    </strong>
                  </div>

                  {merchant.infrastructure !== 'Digital / Online Only' && (
                    <div>
                      <small className="block text-slate-500">
                        Business Reg. Number
                      </small>
                      <strong className="text-slate-900">
                        {merchant.businessRegNumber || '—'}
                      </strong>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ob-actions mt-8">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate('/onboarding/personal')}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={handleFinalSubmit}
            disabled={isSubmitting || loading}
          >
            {isSubmitting ? 'Submitting...' : 'Submit for verification'}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SubmittedPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const role = session?.roles[0] || getActiveRole();

  const portalPath =
    role === 'driver'
      ? '/customer/driver'
      : role === 'merchant'
        ? '/customer/merchant'
        : '/customer/rider';

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in text-center">
        <div className="w-20 h-20 bg-green-100 text-[#32a84a] rounded-full flex items-center justify-center mx-auto mb-6">
          <Check size={40} />
        </div>

        <h2 className="text-3xl font-bold mb-3">
          Welcome to MatMove!
        </h2>

        <p className="text-slate-500 mb-10">
          Your verification details have been saved. You can now access your dashboard.
          {role !== 'rider' &&
            " Approval pending: your wallet features unlock after your documents are approved."}
        </p>

        <button
          type="button"
          className="primary-button w-full py-4"
          onClick={() => {
            navigate(portalPath, { replace: true });
          }}
        >
          Access dashboard
        </button>
      </div>
    </OnboardingShell>
  );
}

export function VerificationPage() {
  return <SubmittedPage />;
}

function Field({
  label,
  children,
  full
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? 'field-full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
