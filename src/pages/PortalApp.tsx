import {
  useState,
  useEffect,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { RiderDashboard } from './RiderDashboard';
import { DriverDashboard } from './DriverDashboard';
import { MerchantDashboard } from './MerchantDashboard';
import { WalletPage } from './WalletPage';
import {
  X,
  CheckCircle2,
  Calculator,
  AlertCircle,
  Home,
  Wallet,
  Navigation,
  Headphones,
  UserCircle,
  Smartphone,
  CreditCard,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  RefreshCw,
  LockKeyhole,
  Delete,
} from 'lucide-react';

type WalletAction = 'topup' | 'withdraw';
type TopUpMethod = 'mobile_money' | 'card';
type MobileMoneyNetwork = 'orange' | 'afrimoney';
type PortalSection = 'home' | 'wallet' | 'trips' | 'support' | 'account';
type CustomerRole = 'rider' | 'driver' | 'merchant';

const IDLE_LOCK_MS = 1 * 60 * 1000; // 1 Minute to trigger PIN Lock
const IDLE_LOGOUT_MS = 30 * 60 * 1000; // 30 Minutes to trigger Hard Sign Out

function getRoleFromPath(pathname: string): CustomerRole | null {
  const normalized = pathname.toLowerCase();
  if (normalized.startsWith('/customer/driver')) return 'driver';
  if (normalized.startsWith('/customer/merchant')) return 'merchant';
  if (normalized.startsWith('/customer/rider')) return 'rider';
  return null;
}

function isCustomerRole(value: string): value is CustomerRole {
  return value === 'rider' || value === 'driver' || value === 'merchant';
}

function getCanonicalPortalPath(role: CustomerRole): string {
  return `/customer/${role}`;
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeKycStatus(value: unknown): string {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'approved') return 'approved';
  if (status === 'declined' || status === 'rejected') return 'declined';
  if (status === 'pending' || status === 'submitted' || status === 'under_review' || status === 'resubmission_required' || status === 'in_review') return 'pending';
  return 'not_started';
}

export function PortalApp() {
  const navigate = useNavigate();
  const location = useLocation();

  // PASSCODE & SESSION STATE
  const [pinStatus, setPinStatus] = useState<'checking' | 'create' | 'locked' | 'unlocked' | 'forgot_auth' | 'forgot_pin'>('checking');
  const [pinError, setPinError] = useState('');

  const [profile, setProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalError, setPortalError] = useState('');
  const [activeSection, setActiveSection] = useState<PortalSection>('home');
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [walletAction, setWalletAction] = useState<WalletAction>('topup');
  const [amount, setAmount] = useState('');
  const [topUpMethod, setTopUpMethod] = useState<TopUpMethod | null>(null);
  const [mobileMoneyNetwork, setMobileMoneyNetwork] = useState<MobileMoneyNetwork>('orange');
  const [withdrawalPhone, setWithdrawalPhone] = useState('');
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [serviceType, setServiceType] = useState<'ride' | 'delivery' | 'truck' | 'bus'>('ride');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [calculatedFare, setCalculatedFare] = useState<number>(30);
  const [processing, setProcessing] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  // ==========================================
  // SMART SESSION & BACKEND PIN TRACKER
  // ==========================================
  useEffect(() => {
    // Skip idle checks if user is currently resetting their PIN
    if (pinStatus === 'forgot_auth' || pinStatus === 'forgot_pin') return;

    const checkIdleState = () => {
      if (!profile) return;

      const backendPin = profile.passcode;
      const lastActiveStr = localStorage.getItem('matmove_last_active');
      const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;
      const now = Date.now();
      const idleTime = now - lastActive;

      // 1. No PIN in backend? Must create one (Fresh Account)
      if (!backendPin) {
        setPinStatus('create');
        return;
      }

      // 2. We have a backend PIN. Check session timers.
      // If lastActive is 0, it means they just logged in via Email/Password -> Ask for PIN
      if (lastActive === 0 || idleTime > IDLE_LOCK_MS) {
        // If they've been idle for over 30 mins, perform a hard logout
        if (lastActive > 0 && idleTime > IDLE_LOGOUT_MS) {
          handleLogout();
          return;
        }
        setPinStatus('locked');
        return;
      }

      // 3. User is within safe active limits (e.g. instantly returning from Monime checkout)
      setPinStatus('unlocked');
      localStorage.setItem('matmove_last_active', now.toString());
    };

    checkIdleState();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkIdleState();
    };
    window.addEventListener('visibilitychange', handleVisibility);
    return () => window.removeEventListener('visibilitychange', handleVisibility);
  }, [profile, pinStatus]);

  // Track activity to prevent timeouts while using the app
  useEffect(() => {
    if (pinStatus !== 'unlocked') return;
    const updateActivity = () => localStorage.setItem('matmove_last_active', Date.now().toString());
    
    window.addEventListener('click', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    window.addEventListener('keydown', updateActivity);
    
    const interval = setInterval(() => {
      const lastActive = parseInt(localStorage.getItem('matmove_last_active') || '0', 10);
      if (Date.now() - lastActive > IDLE_LOCK_MS) setPinStatus('locked');
    }, 15000);

    return () => {
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      clearInterval(interval);
    };
  }, [pinStatus]);

  const handleSetPin = async (newPin: string) => {
    try {
      const { error } = await supabase.from('profiles').update({ passcode: newPin }).eq('id', profile.id);
      if (error) throw error;

      localStorage.setItem('matmove_last_active', Date.now().toString());
      setProfile({ ...profile, passcode: newPin });
      setPinStatus('unlocked');
      setPinError('');
    } catch (err) {
      setPinError('Failed to securely save passcode. Please try again.');
    }
  };

  const handleUnlockPin = (enteredPin: string) => {
    if (enteredPin === profile.passcode) {
      localStorage.setItem('matmove_last_active', Date.now().toString());
      setPinError('');
      setPinStatus('unlocked');
    } else {
      setPinError('Incorrect passcode');
    }
  };

  const handleResetPin = async (newPin: string) => {
    try {
      const { error } = await supabase.from('profiles').update({ passcode: newPin }).eq('id', profile.id);
      if (error) throw error;

      localStorage.setItem('matmove_last_active', Date.now().toString());
      setProfile({ ...profile, passcode: newPin });
      
      // Because they just securely verified their password to get here, 
      // we can safely unlock the dashboard for them immediately.
      setPinStatus('unlocked');
      setPinError('');
    } catch (err) {
      setPinError('Failed to update passcode.');
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      // Clear local activity timer on logout so the next sign-in forces the Lock screen
      localStorage.removeItem('matmove_last_active');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setProfile(null);
      setWallet(null);
      setBookings([]);
      navigate('/login', { replace: true });
    } catch (err: any) {
      alert(err?.message || 'Unable to sign out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  };

  const fetchUserData = useCallback(async () => {
    try {
      setPortalError('');
      setLoading(true);

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user) {
        setPortalError('No active user session found. Please sign in again.');
        return;
      }

      const userId = session.user.id;
      const pathRole = getRoleFromPath(location.pathname);

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      const { data: rolesData } = await supabase.from('user_roles').select('role').eq('profile_id', userId);

      const databaseRoles = (rolesData || []).map((item) => String(item.role || '').toLowerCase()).filter(isCustomerRole) as CustomerRole[];
      const profileRole = profileData?.role ? String(profileData.role).toLowerCase() : '';

      let resolvedRole: CustomerRole | '' = '';
      if (isCustomerRole(profileRole)) resolvedRole = profileRole;
      else if (databaseRoles.length > 0) resolvedRole = databaseRoles[0];
      else if (pathRole) resolvedRole = pathRole;

      if (profileRole === 'admin') {
        setPortalError('This is an administrator account. Please use the MatMove Admin system.');
        return;
      }

      if (!resolvedRole) {
        setPortalError('Your customer role has not been configured yet. Please complete account setup.');
        return;
      }

      const canonicalPath = getCanonicalPortalPath(resolvedRole);
      if (location.pathname !== canonicalPath) {
        navigate(canonicalPath, { replace: true });
      }

      const resolvedPhone = normalizePhone(profileData?.phone) || normalizePhone(session.user.phone) || '';
      const { data: kycSubmission } = await supabase.from('kyc_submissions').select('id,status,target_role,created_at,updated_at').eq('profile_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const resolvedKycStatus = kycSubmission?.status ? normalizeKycStatus(kycSubmission?.status) : normalizeKycStatus(profileData?.kyc_status);

      const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', userId).order('currency', { ascending: true });
      const wallets = walletData || [];
      const sleWallet = wallets.find((item) => String(item.currency || '').toUpperCase() === 'SLE');
      const resolvedWallet = { ...(sleWallet || wallets[0] || { balance: 0, reserved_balance: 0, currency: 'SLE' }), wallets };

      let bookingQuery = supabase.from('bookings').select('*').order('created_at', { ascending: false });
      if (resolvedRole === 'driver') bookingQuery = bookingQuery.or(`status.eq.pending,driver_id.eq.${userId}`);
      else if (resolvedRole === 'rider') bookingQuery = bookingQuery.eq('rider_id', userId);
      else bookingQuery = bookingQuery.eq('rider_id', '00000000-0000-0000-0000-000000000000');
      const { data: bookingData } = await bookingQuery;

      setProfile({
        ...(profileData || {}),
        id: userId,
        email: profileData?.email || session.user.email || '',
        phone: resolvedPhone,
        kyc_status: resolvedKycStatus,
        role: resolvedRole,
        passcode: profileData?.passcode || null, // Map the Backend PIN
      });

      setWallet(resolvedWallet);
      setBookings(bookingData || []);
    } catch (err: any) {
      setPortalError(err?.message || 'Unable to load your MatMove account.');
    } finally {
      setLoading(false);
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    fetchUserData();
    const bookingChannel = supabase.channel(`portal-booking-changes-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchUserData(); }).subscribe();
    const walletChannel = supabase.channel(`portal-wallet-changes-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'wallets' }, () => { fetchUserData(); }).subscribe();
    return () => { supabase.removeChannel(bookingChannel); supabase.removeChannel(walletChannel); };
  }, [fetchUserData]);

  const handleNavigation = (section: PortalSection) => {
    setSuccessMsg('');
    setActiveSection(section);
  };

  const openWalletPage = () => { setSuccessMsg(''); setActiveSection('wallet'); };
  const closeWalletPage = () => { setActiveSection('home'); setSuccessMsg(''); };
  const openWalletTopUp = () => { setWalletAction('topup'); setTopUpMethod(null); setMobileMoneyNetwork('orange'); setWithdrawalPhone(''); setAmount(''); setSuccessMsg(''); setIsWalletModalOpen(true); };
  const openWalletWithdrawal = () => {
    const kycStatus = normalizeKycStatus(profile?.kyc_status);
    if (kycStatus !== 'approved') return alert('Cash withdrawal is available only after your account has been verified and approved by MatMove Admin.');
    setWalletAction('withdraw'); setTopUpMethod(null); setMobileMoneyNetwork('orange'); setWithdrawalPhone(normalizePhone(profile?.phone)); setAmount(''); setSuccessMsg(''); setIsWalletModalOpen(true);
  };

  // ==========================================
  // RENDER SECURITY GATES
  // ==========================================

  if (pinStatus === 'checking' || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Securing connection...</p>
        </div>
      </div>
    );
  }

  // Route to the Unified PIN Screens
  if (pinStatus !== 'unlocked') {
    return (
      <PasscodeScreen 
        mode={pinStatus} 
        onComplete={(pin: string) => {
          if (pinStatus === 'create') handleSetPin(pin);
          else if (pinStatus === 'locked') handleUnlockPin(pin);
          else if (pinStatus === 'forgot_pin') handleResetPin(pin);
        }}
        error={pinError}
        setError={setPinError}
        profileEmail={profile?.email}
        onForgot={() => setPinStatus('forgot_auth')}
        onForgotAuthSuccess={() => setPinStatus('forgot_pin')}
        onCancelForgot={() => { setPinError(''); setPinStatus('locked'); }}
        onLogout={handleLogout} 
      />
    );
  }

  if (portalError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-sm">
          <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle size={28} /></div>
          <h2 className="text-xl font-bold text-slate-900">Account Error</h2>
          <p className="text-sm text-slate-500 mt-2">{portalError}</p>
          <button onClick={() => window.location.reload()} className="mt-6 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-blue-700 transition flex items-center justify-center gap-2 mx-auto"><RefreshCw size={16}/> Refresh</button>
        </div>
      </div>
    );
  }

  const role = String(profile?.role || '').toLowerCase();
  const isRider = role === 'rider';
  const isDriver = role === 'driver';
  const isMerchant = role === 'merchant';

  if (!isRider && !isDriver && !isMerchant) return null;

  if (activeSection === 'account') {
    return (
      <div className="min-h-screen bg-slate-50 pb-28">
        <AccountSection profile={profile} role={role as CustomerRole} loggingOut={loggingOut} onLogout={handleLogout} onBack={() => setActiveSection('home')} />
        <PortalNavigation activeSection={activeSection} onNavigate={handleNavigation} isRider={isRider} isDriver={isDriver} isMerchant={isMerchant} />
      </div>
    );
  }

  if (activeSection === 'wallet') {
    return (
      <div className="relative min-h-screen bg-slate-50">
        <WalletPage profile={profile} wallet={wallet} onClose={closeWalletPage} onTopUp={openWalletTopUp} onWithdraw={openWalletWithdrawal} onSendMoney={() => {}} />
        <PortalNavigation activeSection={activeSection} onNavigate={handleNavigation} isRider={isRider} isDriver={isDriver} isMerchant={isMerchant} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50 pb-24">
      {isRider && <RiderDashboard profile={profile} wallet={wallet} onOpenBooking={() => setIsBookingOpen(true)} onOpenTopUp={openWalletPage} />}
      {isDriver && <DriverDashboard profile={profile} wallet={wallet} bookings={bookings} onOpenWithdraw={openWalletPage} />}
      {isMerchant && <MerchantDashboard profile={profile} wallet={wallet} onOpenWithdraw={openWalletPage} />}
      <PortalNavigation activeSection={activeSection} onNavigate={handleNavigation} isRider={isRider} isDriver={isDriver} isMerchant={isMerchant} />
    </div>
  );
}

// ==========================================
// UNIFIED PASSCODE UI COMPONENT
// ==========================================
function PasscodeScreen({ mode, onComplete, error, setError, profileEmail, onForgot, onForgotAuthSuccess, onCancelForgot, onLogout }: any) {
  const [pin, setPin] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  
  // Step 1 of Forgot flow: Verify account password to prevent unauthorized resets
  if (mode === 'forgot_auth') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white selection:bg-transparent">
        <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center mb-6">
          <LockKeyhole size={32} />
        </div>
        <h2 className="text-2xl font-bold mb-2">Verify Identity</h2>
        <p className="text-slate-400 text-sm mb-8 text-center max-w-xs">
          To reset your passcode, please enter your MatMove account password to verify your identity.
        </p>

        {error && <p className="text-red-400 text-sm mb-6 bg-red-950/50 px-4 py-2 rounded-lg">{error}</p>}

        <form onSubmit={async (e) => {
          e.preventDefault();
          setVerifying(true);
          setError('');
          try {
            const { error: authErr } = await supabase.auth.signInWithPassword({ email: profileEmail, password: accountPassword });
            if (authErr) throw authErr;
            onForgotAuthSuccess();
          } catch(err) {
            setError('Incorrect account password.');
          } finally {
            setVerifying(false);
          }
        }} className="w-full max-w-[280px]">
          <input 
            type="password" 
            value={accountPassword}
            onChange={(e) => setAccountPassword(e.target.value)}
            placeholder="Account Password"
            required
            className="w-full bg-slate-800 border border-slate-700 p-4 rounded-xl text-white outline-none focus:border-blue-500 mb-4"
          />
          <button type="submit" disabled={verifying} className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold hover:bg-blue-700 transition disabled:opacity-50">
            {verifying ? 'Verifying...' : 'Verify & Reset Passcode'}
          </button>
          <button type="button" onClick={onCancelForgot} className="w-full mt-6 text-sm text-slate-500 hover:text-slate-300">
            Cancel and go back
          </button>
        </form>
      </div>
    );
  }

  // Standard PIN Pad for Create, Lock, and Step 2 of Forgot flow
  const handlePress = (val: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + val;
    setPin(newPin);
    if (newPin.length === 4) {
      setTimeout(() => {
        onComplete(newPin);
        if (mode === 'locked') setPin(''); // Clear pin if they entered wrong and stay on locked screen
      }, 250);
    }
  };

  const handleDelete = () => setPin(pin.slice(0, -1));

  const getTitle = () => {
    if (mode === 'create') return 'Create a Passcode';
    if (mode === 'forgot_pin') return 'Enter New Passcode';
    return 'Enter Passcode';
  };

  const getSubtitle = () => {
    if (mode === 'create') return 'Enter a 4-digit PIN to secure your MatMove account.';
    if (mode === 'forgot_pin') return 'Please enter your brand new 4-digit MatMove PIN.';
    return 'Welcome back. Please enter your 4-digit MatMove PIN.';
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white selection:bg-transparent">
      <div className="w-16 h-16 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center mb-6">
        <LockKeyhole size={32} />
      </div>
      <h2 className="text-2xl font-bold mb-2">{getTitle()}</h2>
      <p className="text-slate-400 text-sm mb-8 text-center max-w-xs">{getSubtitle()}</p>

      <div className="flex gap-6 mb-10">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`w-4 h-4 rounded-full transition-colors ${i < pin.length ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-slate-800'}`} />
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-6 animate-pulse bg-red-950/50 px-4 py-2 rounded-lg">{error}</p>}

      <div className="grid grid-cols-3 gap-3 sm:gap-4 max-w-[280px] w-full">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button key={num} onClick={() => handlePress(num.toString())} className="h-16 rounded-2xl bg-slate-800 text-3xl font-light hover:bg-slate-700 active:bg-slate-600 transition touch-manipulation">
            {num}
          </button>
        ))}
        <div />
        <button onClick={() => handlePress('0')} className="h-16 rounded-2xl bg-slate-800 text-3xl font-light hover:bg-slate-700 active:bg-slate-600 transition touch-manipulation">0</button>
        <button onClick={handleDelete} className="h-16 rounded-2xl bg-slate-800 text-2xl flex items-center justify-center hover:bg-slate-700 active:bg-slate-600 transition text-slate-400 touch-manipulation"><Delete size={28} /></button>
      </div>

      {mode === 'locked' && (
        <div className="mt-16 flex flex-col gap-4 text-center">
          <button onClick={onForgot} className="text-sm font-medium text-blue-400 hover:text-blue-300">
            Forgot Passcode?
          </button>
          <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-4">
            Sign out completely
          </button>
        </div>
      )}
    </div>
  );
}

// ==========================================
// PRESERVED COMPONENTS (Account, Nav, etc)
// ==========================================

function AccountSection({ profile, role, loggingOut, onLogout, onBack }: any) {
  const firstName = profile?.first_name || profile?.firstName || '';
  const lastName = profile?.last_name || profile?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'MatMove User';
  const email = profile?.email || 'Not available';
  const phone = normalizePhone(profile?.phone) || 'Not available';
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const kycStatus = normalizeKycStatus(profile?.kyc_status || profile?.kycStatus);
  const kycLabel = kycStatus === 'approved' ? 'Verified' : kycStatus === 'pending' ? 'Under Review' : kycStatus === 'declined' ? 'Declined' : 'Not Started';
  const kycClasses = kycStatus === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : kycStatus === 'declined' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="mb-8">
          <button onClick={onBack} className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5">← Back to portal</button>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-2">MatMove Account</div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900">Account & Profile</h1>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><UserCircle size={34} /></div>
              <div className="flex-1"><div className="text-2xl font-bold text-slate-900">{fullName}</div><div className="text-sm text-slate-500 mt-1">MatMove {roleLabel}</div></div>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-5">Personal Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2"><Mail size={15} /> Email</div>
                <div className="font-semibold text-slate-900 break-all">{email}</div>
              </div>
              <div className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2"><Phone size={15} /> Phone</div>
                <div className="font-semibold text-slate-900">{phone}</div>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Sign out</h2>
              <button onClick={onLogout} disabled={loggingOut} className="mt-4 w-full sm:w-auto px-6 py-3.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition flex items-center justify-center gap-2">
                <LogOut size={18} /> {loggingOut ? 'Signing out...' : 'Log out of MatMove'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalNavigation({ activeSection, onNavigate, isRider, isDriver, isMerchant }: any) {
  const roleLabel = isRider ? 'Rider' : isDriver ? 'Driver' : isMerchant ? 'Merchant' : 'MatMove';
  const navigationItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'trips', label: isMerchant ? 'Orders' : 'Trips', icon: Navigation },
    { id: 'support', label: 'Support', icon: Headphones },
    { id: 'account', label: 'Account', icon: UserCircle },
  ] as const;

  return (
    <>
      <aside className="hidden md:flex fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-2xl px-2 py-2">
        <div className="flex items-center gap-1">
          <div className="px-3 py-2 border-r border-slate-200 mr-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">MatMove</div>
            <div className="text-xs font-bold text-slate-700">{roleLabel}</div>
          </div>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Icon size={17} /><span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-2xl px-2 py-2">
        <div className="grid grid-cols-5 gap-1 max-w-lg mx-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)} className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition ${active ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Icon size={18} /><span className="text-[10px] font-bold">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}