import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { CarFront, Truck, Store, ArrowRight, ArrowLeft, Check, ShieldCheck, FileText, AlertCircle, UploadCloud, Camera } from 'lucide-react';
import { OnboardingShell } from '@/components/AuthShell';
import { DocumentUpload, SelfieUpload } from '@/components/DocumentUpload';
import { useAuth } from '@/context/AuthContext';
import { roleLabels, roleDescriptions } from '@/services/roleService';
import type { UserRole, PersonalInfo, IdentityInfo, DriverInfo, MerchantInfo, UploadedDocument, DocumentType } from '@/types';

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

  const setPersistentState = (value: T) => {
    setState(value);
    sessionStorage.setItem(key, JSON.stringify(value));
  };
  return [state, setPersistentState] as const;
}

function getActiveRole(): UserRole {
  const storedRole = sessionStorage.getItem('ob_role');
  if (storedRole === 'rider' || storedRole === 'driver' || storedRole === 'merchant') return storedRole;
  return 'rider';
}

function normalizePhone(value: string): string {
  return value.trim().replace(/[^\d+]/g, '');
}

export function RoleSelectionPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<UserRole | null>(() => {
    const stored = sessionStorage.getItem('ob_role');
    return stored === 'rider' || stored === 'driver' || stored === 'merchant' ? stored : null;
  });
  const [isProcessing, setIsProcessing] = useState(false);

  const roles: { key: UserRole; icon: React.ReactNode; tone: string }[] = [
    { key: 'rider', icon: <CarFront size={26} />, tone: 'blue' },
    { key: 'driver', icon: <Truck size={26} />, tone: 'green' },
    { key: 'merchant', icon: <Store size={26} />, tone: 'orange' },
  ];

  const handleContinue = async () => {
    if (!selected) return;
    setIsProcessing(true);
    try {
      sessionStorage.setItem('ob_role', selected);
      navigate('/onboarding/personal');
    } catch (error) {
      alert('Failed to save your account type. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <OnboardingShell step={2}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">How will you use MatMove?</h2>
        <p className="ob-subtitle">Choose your primary account type.</p>
        <div className="role-choice-grid">
          {roles.map(({ key, icon, tone }) => (
            <button key={key} type="button" className={`role-choice-card ${selected === key ? 'selected' : ''}`} onClick={() => setSelected(key)} disabled={isProcessing}>
              <div className={`icon-box tone-${tone} icon-lg`}>{icon}</div>
              <strong>{roleLabels[key]}</strong>
              <span>{roleDescriptions[key]}</span>
              {selected === key && <div className="selected-check"><Check size={13} /></div>}
            </button>
          ))}
        </div>
        <div className="ob-actions">
          <button type="button" className="back-button" onClick={() => navigate('/')} disabled={isProcessing}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" disabled={!selected || isProcessing} onClick={handleContinue}>
            {isProcessing ? 'Saving...' : 'Continue'} <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function PersonalInfoPage() {
  const navigate = useNavigate();
  const [info, setInfo] = useOnboardingState<OnboardingPersonalInfo>('ob_personal', {
    firstName: '', middleName: '', lastName: '', phone: '', dateOfBirth: '', nationality: 'Sierra Leonean', country: 'Sierra Leone', residentialAddress: '', city: '',
  });

  const update = (field: keyof OnboardingPersonalInfo, value: string) => setInfo({ ...info, [field]: value });
  const normalizedPhone = normalizePhone(info.phone ?? '');
  const isValid = Boolean(info.firstName?.trim() && info.lastName?.trim() && normalizedPhone && info.dateOfBirth && info.residentialAddress?.trim() && info.city?.trim());

  return (
    <OnboardingShell step={3}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">Personal information</h2>
        <p className="ob-subtitle">Tell us about yourself. This information is kept private and secure.</p>
        <div className="ob-form-grid">
          <Field label="First name"><input className="ob-input" value={info.firstName ?? ''} onChange={(e) => update('firstName', e.target.value)} placeholder="Aisha" /></Field>
          <Field label="Middle name"><input className="ob-input" value={info.middleName ?? ''} onChange={(e) => update('middleName', e.target.value)} placeholder="Mariama" /></Field>
          <Field label="Last name"><input className="ob-input" value={info.lastName ?? ''} onChange={(e) => update('lastName', e.target.value)} placeholder="Kamara" /></Field>
          <Field label="Phone number">
            <input className="ob-input" value={info.phone ?? ''} onChange={(e) => update('phone', e.target.value)} placeholder="+232 76 123 456" inputMode="tel" />
          </Field>
          <Field label="Date of birth"><input className="ob-input" type="date" value={info.dateOfBirth ?? ''} onChange={(e) => update('dateOfBirth', e.target.value)} /></Field>
          <Field label="Nationality"><input className="ob-input" value={info.nationality ?? ''} onChange={(e) => update('nationality', e.target.value)} /></Field>
          <Field label="Country"><input className="ob-input" value={info.country ?? ''} onChange={(e) => update('country', e.target.value)} /></Field>
          <Field label="Residential address" full><input className="ob-input" value={info.residentialAddress ?? ''} onChange={(e) => update('residentialAddress', e.target.value)} placeholder="123 Lumley Beach Road" /></Field>
          <Field label="City"><input className="ob-input" value={info.city ?? ''} onChange={(e) => update('city', e.target.value)} placeholder="Freetown" /></Field>
        </div>
        <div className="ob-actions">
          <button type="button" className="back-button" onClick={() => navigate('/select-role')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" disabled={!isValid} onClick={() => { setInfo({ ...info, phone: normalizedPhone }); navigate('/onboarding/identity'); }}>Continue <ArrowRight size={17} /></button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function IdentityPage() {
  const navigate = useNavigate();
  const role = getActiveRole();

  const [identity, setIdentity] = useOnboardingState<Partial<IdentityInfo>>('ob_identity', { idType: '', idNumber: '', idIssuingCountry: 'Sierra Leone', idExpiryDate: '' });
  const [driver, setDriver] = useOnboardingState<Partial<DriverInfo>>('ob_driver', { licenseNumber: '', licenseClass: '', issueDate: '', expiryDate: '' });
  const [merchant, setMerchant] = useOnboardingState<Partial<MerchantInfo> & { infrastructure?: string }>('ob_merchant', { businessName: '', businessType: '', businessRegNumber: '', businessAddress: '', authRepName: '', authRepPhone: '', infrastructure: 'Physical Shop / Location' });

  const updateId = (field: keyof IdentityInfo, value: string) => setIdentity({ ...identity, [field]: value });
  const updateDriver = (field: keyof DriverInfo, value: string) => setDriver({ ...driver, [field]: value });
  const updateMerchant = (field: string, value: string) => setMerchant({ ...merchant, [field]: value });

  const idTypes = role === 'driver' ? ["Driver's License"] : role === 'merchant' ? ['National ID', 'Passport', 'Business Registration'] : ['National ID', 'Passport'];
  const currentIdType = identity.idType && idTypes.includes(identity.idType) ? identity.idType : idTypes[0];
  const isDigitalMerchant = role === 'merchant' && merchant.infrastructure === 'Digital / Online Only';
  const hideStandardIdFields = (role === 'driver' && currentIdType === "Driver's License") || (role === 'merchant' && currentIdType === 'Business Registration');

  useEffect(() => {
    if (identity.idType !== currentIdType) updateId('idType', currentIdType);
  }, [identity.idType, currentIdType]);

  return (
    <OnboardingShell step={4}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">{role === 'driver' ? 'Driver identity' : role === 'merchant' ? 'Business identity' : 'Identity verification'}</h2>
        <div className="ob-form-grid">
          <Field label="ID type">
            <div className="ob-select-wrap">
              <select className="ob-input" value={currentIdType} onChange={(e) => updateId('idType', e.target.value)}>
                {idTypes.map((type) => (<option key={type}>{type}</option>))}
              </select>
            </div>
          </Field>
          {!hideStandardIdFields && (
            <>
              <Field label="ID number"><input className="ob-input" value={identity.idNumber ?? ''} onChange={(e) => updateId('idNumber', e.target.value)} /></Field>
              <Field label="ID expiry date"><input className="ob-input" type="date" value={identity.idExpiryDate ?? ''} onChange={(e) => updateId('idExpiryDate', e.target.value)} /></Field>
            </>
          )}
          <Field label="ID issuing country"><input className="ob-input" value={identity.idIssuingCountry ?? ''} onChange={(e) => updateId('idIssuingCountry', e.target.value)} /></Field>
        </div>

        {role === 'driver' && (
          <div className="ob-form-grid mt-6">
            <Field label="License number"><input className="ob-input" value={driver.licenseNumber ?? ''} onChange={(e) => updateDriver('licenseNumber', e.target.value)} /></Field>
            <Field label="License class"><input className="ob-input" value={driver.licenseClass ?? ''} onChange={(e) => updateDriver('licenseClass', e.target.value)} /></Field>
          </div>
        )}

        {role === 'merchant' && (
          <div className="ob-form-grid mt-6">
            <Field label="Business name"><input className="ob-input" value={merchant.businessName ?? ''} onChange={(e) => updateMerchant('businessName', e.target.value)} /></Field>
            <Field label="Infrastructure">
              <div className="ob-select-wrap">
                <select className="ob-input" value={merchant.infrastructure ?? ''} onChange={(e) => updateMerchant('infrastructure', e.target.value)}>
                  <option>Physical Shop / Location</option>
                  <option>Digital / Online Only</option>
                </select>
              </div>
            </Field>
            {!isDigitalMerchant && <Field label="Business registration number"><input className="ob-input" value={merchant.businessRegNumber ?? ''} onChange={(e) => updateMerchant('businessRegNumber', e.target.value)} /></Field>}
            <Field label="Business address" full><input className="ob-input" value={merchant.businessAddress ?? ''} onChange={(e) => updateMerchant('businessAddress', e.target.value)} /></Field>
          </div>
        )}

        <div className="ob-actions mt-8">
          <button type="button" className="back-button" onClick={() => navigate('/onboarding/personal')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" onClick={() => navigate('/onboarding/documents')}>Continue <ArrowRight size={17} /></button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function DocumentsPage() {
  const navigate = useNavigate();
  const role = getActiveRole();
  const [identity] = useOnboardingState<Partial<IdentityInfo>>('ob_identity', {});
  const [merchant] = useOnboardingState<Partial<MerchantInfo> & { infrastructure?: string }>('ob_merchant', {});
  const currentIdType = identity.idType || 'National ID';

  let displayDocs: { id: DocumentType; label: string; required: boolean; }[] = [
    { id: 'id_front', label: 'National ID (Front)', required: true }
  ];

  const [docs, setDocs] = useOnboardingState<Record<string, any>>('ob_docs', {});

  const handleUpload = (type: DocumentType, document: UploadedDocument) => {
    setDocs({ ...docs, [type]: document });
  };
  
  const handleRemove = (type: DocumentType) => {
    const updatedDocs = { ...docs };
    delete updatedDocs[type];
    setDocs(updatedDocs);
  };
  
  const allUploaded = displayDocs.filter((d) => d.required).every((d) => docs[d.id]?.status === 'uploaded' || docs[d.id]?.url);

  return (
    <OnboardingShell step={5}>
      <style>{`.premium-dropzones [data-doc-type] { border: 2px dashed #cbd5e1; border-radius: 1.25rem; padding: 2.5rem 2rem; text-align: center; background: #f8fafc; transition: all 0.2s ease-in-out; margin-bottom: 1.5rem; }`}</style>
      <div className="ob-page animate-in premium-dropzones">
        <h2 className="ob-title">Upload your documents</h2>
        <div className="doc-upload-list grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {displayDocs.map((docConfig) => (
            <div key={docConfig.id} className="flex flex-col">
              <span className="mb-3 font-bold text-slate-700 ml-1">{docConfig.label}</span>
              <div data-doc-type={docConfig.id} className="relative">
                {!docs[docConfig.id] && <UploadCloud className="mx-auto mb-4 text-[#184f9a]" size={36} />}
                <DocumentUpload type={docConfig.id} document={docs[docConfig.id]} onUpload={(doc) => handleUpload(docConfig.id, doc)} onRemove={() => handleRemove(docConfig.id)} />
              </div>
            </div>
          ))}
        </div>
        <div className="ob-actions">
          <button type="button" className="back-button" onClick={() => navigate('/onboarding/identity')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" disabled={!allUploaded} onClick={() => navigate('/onboarding/selfie')}>Continue <ArrowRight size={17} /></button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SelfiePage() {
  const navigate = useNavigate();
  const role = getActiveRole();
  const [selfie, setSelfie] = useState<UploadedDocument | undefined>(undefined);

  useEffect(() => {
    const stored = sessionStorage.getItem('ob_selfie');
    if (stored) {
      try { setSelfie(JSON.parse(stored) as UploadedDocument); } catch { sessionStorage.removeItem('ob_selfie'); }
    }
  }, []);

  const handleSelfieUpload = (document: UploadedDocument) => {
    setSelfie(document);
    sessionStorage.setItem('ob_selfie', JSON.stringify({
      id: document.id, type: document.type, fileName: document.fileName, fileSize: document.fileSize, status: document.status, url: document.url
    }));
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
            {!selfie && <Camera className="mx-auto mb-4 text-[#184f9a] bg-white p-3 rounded-full shadow-md" size={64} />}
            <SelfieUpload document={selfie} onUpload={handleSelfieUpload} onRemove={handleSelfieRemove} />
          </div>
        </div>
        <div className="ob-actions">
          <button type="button" className="back-button" onClick={() => navigate('/onboarding/documents')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" disabled={!selfie} onClick={() => navigate(role === 'driver' ? '/onboarding/vehicle' : '/onboarding/review')}>Continue <ArrowRight size={17} /></button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function VehicleSelectionPage() {
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useOnboardingState<{ type: string; plateNumber: string; region: string }>('ob_vehicle', { type: '', plateNumber: '', region: 'West (Freetown)' });
  const isValid = Boolean(vehicle.type && vehicle.plateNumber?.trim() && vehicle.region);

  const vehicleTypes = [
    { name: 'Motorbike (Okada)' },
    { name: 'Tricycle (Keke)' },
    { name: 'Car' },
    { name: 'Van / Truck' },
  ];

  return (
    <OnboardingShell step={6.5 as any}>
      <div className="ob-page animate-in">
        <h2 className="ob-title font-extrabold tracking-tight">Vehicle details</h2>
        <p className="ob-subtitle mb-6">Provide details about the vehicle you will be driving.</p>
        
        {/* RESTORED VEHICLE GRID */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {vehicleTypes.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => setVehicle({ ...vehicle, type: v.name })}
              className={`p-4 rounded-2xl border-2 text-center transition-all ${
                vehicle.type === v.name
                  ? 'border-[#184f9a] bg-[#eff6ff] text-[#184f9a] font-bold'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>

        <div className="ob-form-grid bg-slate-50 p-6 rounded-3xl border border-slate-100">
          <Field label="License Plate Number">
            <input className="ob-input uppercase font-bold" placeholder="e.g. AB 1234" value={vehicle.plateNumber} onChange={(e) => setVehicle({ ...vehicle, plateNumber: e.target.value })} />
          </Field>
          <Field label="Operating Region">
            <div className="ob-select-wrap">
              <select className="ob-input font-medium" value={vehicle.region} onChange={(e) => setVehicle({ ...vehicle, region: e.target.value })}>
                <option>West (Freetown)</option>
                <option>East (Kenema, Kono)</option>
                <option>South (Bo)</option>
                <option>North (Makeni)</option>
              </select>
            </div>
          </Field>
        </div>
        <div className="ob-actions mt-8">
          <button type="button" className="back-button" onClick={() => navigate('/onboarding/selfie')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" disabled={!isValid} onClick={() => navigate('/onboarding/review')}>Continue <ArrowRight size={17} /></button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function ReviewPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const role = getActiveRole();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [info] = useOnboardingState<OnboardingPersonalInfo>('ob_personal', {});
  const [identity] = useOnboardingState<Partial<IdentityInfo>>('ob_identity', {});
  const [merchant] = useOnboardingState<Partial<MerchantInfo> & { infrastructure?: string }>('ob_merchant', {});
  const [vehicle] = useOnboardingState<{ type: string; plateNumber: string; region: string }>('ob_vehicle', { type: '', plateNumber: '', region: '' });
  
  const [docs] = useOnboardingState<Record<string, any>>('ob_docs', {});
  const selfieRaw = sessionStorage.getItem('ob_selfie');
  const selfieData = selfieRaw ? JSON.parse(selfieRaw) : null;

  const displayPhone = normalizePhone(info.phone ?? session?.user?.phone ?? '');

  const handleFinalSubmit = async () => {
    if (isSubmitting || loading) return;
    if (!session) { alert('Session expired.'); navigate('/login'); return; }
    if (!displayPhone) { alert('Phone missing.'); navigate('/onboarding/personal'); return; }

    setIsSubmitting(true);
    try {
      const userId = session.user.id;
      const userEmail = session.user.email;
      const fullName = `${info.firstName || ''} ${info.middleName || ''} ${info.lastName || ''}`.replace(/\s+/g, ' ').trim() || 'New User';
      
      const userStatus = role === 'rider' ? 'approved' : 'pending';

      const documentUrl = docs['id_front']?.url || docs['id_front']?.fileName || null;
      const selfieUrl = selfieData?.url || selfieData?.fileName || null;

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: userId,
        email: userEmail,
        full_name: fullName,
        first_name: info.firstName || null,
        last_name: info.lastName || null,
        date_of_birth: info.dateOfBirth || null,
        nationality: info.nationality || null,
        country: info.country || null,
        residential_address: info.residentialAddress || null,
        city: info.city || null,
        address: info.residentialAddress || null,
        phone: displayPhone || null,
        phone_number: displayPhone || null,
        vehicle_type: vehicle.type || null,
        plate_number: vehicle.plateNumber || null,
        business_name: merchant.businessName || null,
        business_type: merchant.infrastructure || null,
        tax_id: merchant.businessRegNumber || identity.idNumber || null,
        driver_license_no: identity.idNumber || null,
        id_card_url: documentUrl,
        license_doc_url: role === 'driver' ? documentUrl : null,
        business_doc_url: role === 'merchant' ? documentUrl : null,
        selfie_url: selfieUrl,
        role: role,
        kyc_status: userStatus,
        updated_at: new Date().toISOString()
      });

      if (profileError) throw profileError;

      await supabase.from('wallets').upsert({ user_id: userId, balance: 0, currency: 'SLE' });

      navigate('/onboarding/submitted');
    } catch (error: any) {
      console.error(error);
      alert(error?.message || 'Failed to submit verification.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in">
        <h2 className="ob-title">Review your submission</h2>
        <div className="space-y-6 mt-8">
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="text-xl font-bold text-[#184f9a]">{roleLabels[role]}</div>
          </div>
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-8">
              <div><small className="block text-slate-500">Full name</small><strong className="text-slate-900">{info.firstName} {info.lastName}</strong></div>
              <div><small className="block text-slate-500">Phone</small><strong className="text-slate-900">{displayPhone}</strong></div>
            </div>
          </div>
        </div>
        <div className="ob-actions mt-8">
          <button type="button" className="back-button" onClick={() => navigate('/onboarding/personal')}><ArrowLeft size={16} /> Back</button>
          <button type="button" className="primary-button" onClick={handleFinalSubmit} disabled={isSubmitting || loading}>
            {isSubmitting ? 'Submitting...' : 'Submit for verification'} <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

export function SubmittedPage() {
  const role = getActiveRole();
  const portalPath = role === 'driver' ? '/customer/driver' : role === 'merchant' ? '/customer/merchant' : '/customer/rider';

  return (
    <OnboardingShell step={7}>
      <div className="ob-page animate-in text-center">
        <div className="w-20 h-20 bg-green-100 text-[#32a84a] rounded-full flex items-center justify-center mx-auto mb-6"><Check size={40} /></div>
        <h2 className="text-3xl font-bold mb-3">
          {role === 'rider' ? 'Account Approved!' : 'Submission received!'}
        </h2>
        <p className="text-slate-500 mb-10">
          {role === 'rider' 
            ? 'Your account is ready. You can now request trips and load your wallet.' 
            : 'Your verification is under review.'}
        </p>
        <button type="button" className="primary-button w-full py-4" onClick={() => { window.location.href = portalPath; }}>Access dashboard</button>
      </div>
    </OnboardingShell>
  );
}

export function VerificationPage() { return <SubmittedPage />; }
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean; }) { return <label className={`field ${full ? 'field-full' : ''}`}><span>{label}</span>{children}</label>; }