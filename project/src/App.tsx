

















import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { resolveCustomerRole } from '../shared/customer-access.js';
import { catalogMoney, catalogCheckoutAllowed } from '@/lib/catalogMoney';
import { customerPasscode } from '@/lib/customerPasscode';
import { customerHelpSection } from '@/lib/customerHelpNavigation';

import { LandingPage } from '@/pages/LandingPage';
import {
  LoginPage,
  SignupPage,
  AuthCallbackPage,
} from '@/pages/AuthPages';
import {
  UpdatePassword,
} from '@/pages/UpdatePassword';




import {
  UserCircle,
  Gift,
  LogOut,
  Globe,
  ShieldAlert,
  Home,
  Car,
  Wallet,
  Navigation,
  ShoppingBag,
  Store,
  LockKeyhole,
  ShoppingCart,
  ArrowRight,
  ArrowLeft,
  Trash2,
  BarChart2,
  Clock,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';


const PortalHome = lazy(() => import('@/components/PortalHome'));
const RiderDashboard = lazy(() =>
  import('@/pages/RiderDashboard').then(module => ({default: module.RiderDashboard}))
);
const DriverDashboard = lazy(() =>
  import('@/pages/DriverDashboard').then(module => ({default: module.DriverDashboard}))
);
const MerchantDashboard = lazy(() =>
  import('@/pages/MerchantDashboard').then(module => ({default: module.MerchantDashboard}))
);
const ArcadeGames = lazy(() =>
  import('@/components/ArcadeGames').then(module => ({default: module.ArcadeGames}))
);
const ActivityAnalytics = lazy(() => import('@/components/ActivityAnalytics'));
const MerchantAnalytics = lazy(() => import('@/components/MerchantAnalytics'));
const CustomerPasscode = lazy(() => import('@/components/CustomerPasscode'));
const InviteEarn = lazy(() => import('@/components/InviteEarn'));
const MatMoveHelp = lazy(() => import('@/components/MatMoveHelp'));
const SupportMediaPage = lazy(() => import('@/components/SupportMediaPage'));
const NotificationBell = lazy(() => import('@/components/NotificationBell'));
const ReceivePayLinkPage = lazy(() => import('@/pages/ReceivePayLinkPage'));
const ReceivePaymentCompletePage = lazy(() => import('@/pages/ReceivePayLinkPage').then(m => ({default: m.ReceivePaymentCompletePage})));
const CustomerHome = lazy(() => import('@/components/CustomerHome'));
const PortalGuide = lazy(() => import('@/components/PortalGuide'));
const AccountProfile = lazy(() => import('@/components/AccountProfile'));
const AccountIdentity = lazy(() => import('@/components/AccountProfile').then(m => ({default: m.AccountIdentity})));
const PasskeySecurity = lazy(() => import('@/components/AccountProfile').then(m => ({default: m.PasskeySecurity})));
const MerchantCheckout = lazy(() => import('@/components/MerchantCheckout'));
const AccountPolicy = lazy(() => import('@/components/AccountPolicy').then(m => ({default: m.AccountPolicy})));
const RoleSelectionPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.RoleSelectionPage})));
const KycWorkspace = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.KycWorkspace})));
const PersonalInfoPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.PersonalInfoPage})));
const IdentityPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.IdentityPage})));
const DocumentsPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.DocumentsPage})));
const SelfiePage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.SelfiePage})));
const VehicleSelectionPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.VehicleSelectionPage})));
const ReviewPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.ReviewPage})));
const SubmittedPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.SubmittedPage})));
const VerificationPage = lazy(() => import('@/pages/OnboardingPages').then(m => ({default: m.VerificationPage})));

type PortalSection =
  | 'home'
  | 'ride'
  | 'delivery'
  | 'services'
  | 'wallet'
  | 'trips'
  | 'shop'
  | 'inventory'
  | 'account';

type CustomerRole =
  | 'rider'
  | 'driver'
  | 'merchant';

type CustomerProfile = {
  id: string; role: CustomerRole; email?: string | null; phone?: string | null;
  phone_number?: string | null; first_name?: string | null; last_name?: string | null;
  full_name?: string | null; kyc_status?: string | null; kyc_rejection_reason?: string | null;
  [key: string]: unknown;
};
type CustomerWallet = { balance?: number | string | null; wallets?: unknown[]; [key: string]: unknown };
type MerchantSummary = { business_name?: string | null; full_name?: string | null };
type CartProduct = { id: string; merchant_id?: string | null; merchant?: MerchantSummary | null; name?: string | null; price?: number | string | null; currency?: string | null; is_available?: boolean | null; [key: string]: unknown };
type CustomerCartItem = { id: string; product_id?: string | null; product?: CartProduct | null; quantity?: number | null; [key: string]: unknown };
type CustomerOrder = { id: string; status?: string | null; price?: number | string | null; product_name?: string | null; quantity?: number | null; wallet_payment_status?: string | null; wallet_payment_id?: string | null; merchant?: MerchantSummary | null; created_at?: string | null; [key: string]: unknown };
type CustomerBooking = { status?: string | null; fare_amount?: number | string | null; [key: string]: unknown };
type AnalyticsSummary = { primaryMetric: number; completed: number; pending: number; totalCount: number };
type AccountSectionProps = { profile: CustomerProfile; wallet: CustomerWallet | null; loggingOut: boolean; onLogout: () => void; onBack: () => void; onLock: () => void; onServices: () => void; onNavigate: (destination: string) => void };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

export function PortalApp() {
  const {session,signOut}=useAuth();
  if(!session?.user?.id)return <Navigate to="/login" replace/>;
  return <CustomerPasscode key={session.user.id} userId={session.user.id} onLogout={signOut}>{lock=><PortalContent onPrivacyLock={lock}/>}</CustomerPasscode>;
}

function OfflineStatus(){
 const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine!==false);
 useEffect(()=>{
  const connected=()=>setOnline(true);
  const disconnected=()=>setOnline(false);
  window.addEventListener('online',connected);
  window.addEventListener('offline',disconnected);
  return()=>{window.removeEventListener('online',connected);window.removeEventListener('offline',disconnected);};
 },[]);
 if(online)return null;
 return <div role="status" className="mx-auto max-w-6xl px-4 pt-2"><p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Offline mode · saved information only. Wallet actions, new ride requests and ticket purchases need an internet connection.</p></div>;
}

function PortalContent({onPrivacyLock}:{onPrivacyLock:()=>void}) {
  const navigate = useNavigate();
  const {session:portalSession}=useAuth();
  const sectionOwner=portalSession?.user.id||'';
  const sessionUser=portalSession?.user;
  const initialProfile=sessionUser?.id&&portalSession?.roles?.[0]?{
    id:sessionUser.id,
    email:sessionUser.email||'',
    phone:sessionUser.phone||'',
    first_name:sessionUser.firstName||'',
    last_name:sessionUser.lastName||'',
    full_name:[sessionUser.firstName,sessionUser.lastName].filter(Boolean).join(' '),
    role:portalSession.roles[0],
    kyc_status:portalSession.kycStatus||'not_started'
  }:null;

  const [profile, setProfile] =
    useState<CustomerProfile | null>(initialProfile as CustomerProfile | null);

  const [wallet, setWallet] =
    useState<CustomerWallet | null>(null);

  const [loading, setLoading] =
    useState(!initialProfile);

  const [portalError, setPortalError] =
    useState('');

  // Restore the same portal tab and booking after a passcode lock, reload or app resume.
  const savedSections: PortalSection[] = ['home','ride','services','wallet','trips','account',...(portalSession?.roles?.[0]==='rider'?['shop' as PortalSection,'delivery' as PortalSection]:portalSession?.roles?.[0]==='merchant'?['inventory' as PortalSection]:[])];
  const [activeSection, setActiveSection] = useState<PortalSection>(() => {
    try {
      const saved = sessionStorage.getItem(`matmove:portal-section:v1:${sectionOwner}`) as PortalSection | null;
      return saved && savedSections.includes(saved) ? saved : 'home';
    } catch { return 'home'; }
  });
  const [resumeTripId, setResumeTripId] = useState<string | null>(() => {
    try { return localStorage.getItem(`matmove:active-booking:v1:${sectionOwner}`); }
    catch { return null; }
  });
  const rememberTrip = (bookingId: string | null) => {
    try {
      const key = `matmove:active-booking:v1:${sectionOwner}`;
      if (bookingId) localStorage.setItem(key, bookingId);
      else localStorage.removeItem(key);
    } catch { /* Server-side unfinished-booking recovery remains authoritative. */ }
    setResumeTripId(bookingId);
  };
  const [guideReplay,setGuideReplay]=useState(0);
  const [sectionTransitioning,setSectionTransitioning]=useState(false);
  const previousSectionRef=useRef(activeSection);
  useEffect(()=>{
    if(previousSectionRef.current===activeSection)return;
    previousSectionRef.current=activeSection;
    setSectionTransitioning(true);
    const timeout=window.setTimeout(()=>setSectionTransitioning(false),260);
    return ()=>window.clearTimeout(timeout);
  },[activeSection]);
  useEffect(()=>{if(!sectionOwner||profile?.id!==sectionOwner)return;const sections=['home','ride','services','wallet','trips','account',...(profile.role==='rider'?['shop','delivery']:profile.role==='merchant'?['inventory']:[])];if(!sections.includes(activeSection)){setActiveSection('home');return;}try{sessionStorage.setItem(`matmove:portal-section:v1:${sectionOwner}`,activeSection);}catch{/* Session storage may be unavailable. */}},[sectionOwner,profile?.id,profile?.role,activeSection]);

  const [loggingOut, setLoggingOut] =
    useState(false);
  const [logoutError, setLogoutError] = useState('');

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError('');

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      try {
        localStorage.removeItem('matmove_last_active');
      } catch {
        // Sign-out has succeeded; local cleanup is best-effort.
      }

      navigate('/login', { replace: true });
    } catch (err: unknown) {
      setLogoutError(errorMessage(err, 'Unable to sign out. Check your connection and try again.'));
    } finally {
      setLoggingOut(false);
    }
  };

  const fetchUserData =
    useCallback(async () => {
      try {
        setPortalError('');
        if (!profile?.id) setLoading(true);

        const {
          data: { session },
        } =
          await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error(
            'No active session.'
          );
        }

        const userId = session.user.id;

        const {
          data: profileData,
          error: profileError,
        } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (profileError) {
          throw profileError;
        }

        if (!profileData) {
          navigate('/select-role', {
            replace: true,
          });
          return;
        }

        const { data: assignedRoles, error: roleError } = await supabase.from('user_roles').select('role').eq('profile_id', userId);
        if (roleError) throw roleError;
        const resolvedRole = resolveCustomerRole(profileData, assignedRoles || []);
        if (!resolvedRole) throw new Error('Your customer account type needs completing. Sign in again and finish account setup.');
        const {
          data: walletData,
        } = await supabase
          .from('wallets')
          .select('*')
          .eq('user_id', userId);

        const sleWallet = (
          walletData || []
        ).find(
          item =>
            String(
              item.currency || ''
            ).toUpperCase() === 'SLE'
        );

        setProfile({
          ...profileData,
          id: userId,
          email: session.user.email,
          role: resolvedRole,
        });

        setWallet({
          ...(sleWallet || {
            balance: 0,
          }),
          wallets: walletData || [],
        });
      } catch (err: unknown) {
        if (!profile?.id) setPortalError(errorMessage(err, 'Unable to load your account.'));
      } finally {
        setLoading(false);
      }
    }, [profile?.id, navigate]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) return;
    let active = true;
    const refresh = async () => {
      const {data, error} = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (active && !error && data) setProfile(old => old?.id === userId ? { ...old, ...data } as CustomerProfile : old);
    };
    const channel = supabase.channel(`customer-kyc-status:${userId}`).on('postgres_changes', {event:'UPDATE', schema:'public', table:'profiles', filter:`id=eq.${userId}`}, () => void refresh()).subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); void supabase.removeChannel(channel); };
  }, [profile?.id]);

  // The secure passcode gate mounts this screen before profile reads complete.
  // Do not construct the guide, header or dashboards with a null profile.
  if (loading || (!profile && !portalError)) {
    return (
      <main className="mm-portal-morph flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#f6faf8] px-5 py-10">
        <div role="status" aria-label="Opening MatMove" className="w-full max-w-sm animate-[mm-home-arrive_.45s_ease-out_both] text-center">
          <div className="text-3xl font-black tracking-tight text-[#0b2236]">MatMove</div>
          <div className="mx-auto mt-7 h-1.5 w-36 overflow-hidden rounded-full bg-emerald-100"><span className="block h-full w-1/2 animate-[mm-loading-sweep_1s_ease-in-out_infinite] rounded-full bg-emerald-600"/></div>
        </div>
      </main>
    );
  }

  if (portalError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 text-center rounded-3xl">
          <h2 className="text-xl font-bold text-red-600 mb-2">
            Error
          </h2>

          <p>{portalError}</p>
          {logoutError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{logoutError}</p>}

          <button
            onClick={() =>
              void fetchUserData()
            }
            className="mt-4 rounded-xl bg-blue-600 p-3 text-white"
          >
            Retry
          </button>

          <button
            onClick={() =>
              void handleLogout()
            }
            className="block mt-4"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <main role="status" className="flex min-h-[50dvh] items-center justify-center p-6 text-sm text-slate-600">Your profile could not be loaded. Retry or sign out to continue.</main>;
  }

  const role =
    profile?.role as CustomerRole;

  const guide=<Suspense fallback={null}><PortalGuide key={`${profile.id}:${role}`} userId={profile.id} role={role} verified={profile.kyc_status==='approved'} replay={guideReplay} onNavigate={setActiveSection} onVerify={()=>{if(profile.kyc_status==='approved')return;sessionStorage.setItem('ob_role',role);navigate('/onboarding/personal?resume=1');}}/></Suspense>;
  const openHelpDestination=(destination:string)=>setActiveSection(customerHelpSection(destination,role) as PortalSection);
  const accountHeader=<header className="border-b border-slate-200 bg-white/95 px-3 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur"><div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 py-2"><div className="flex min-w-0 items-center gap-2"><button type="button" aria-label="Replay Quick guide" title="Quick guide" onClick={()=>setGuideReplay(n=>n+1)} className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50">Quick guide</button><Suspense fallback={null}><MatMoveHelp key={`help:${profile.id}:${role}`} userId={profile.id} context={{role}} onNavigate={openHelpDestination}/></Suspense></div><div className="flex shrink-0 items-center gap-2">{(activeSection==='home'||activeSection==='account')&&<Suspense fallback={<span className="h-11 w-11" />}><NotificationBell key={`header-notifications:${profile.id}`} userId={profile.id} onNavigate={openHelpDestination}/></Suspense>}<button type="button" aria-label="Open your account" title="Account" aria-current={activeSection==='account'?'page':undefined} onClick={()=>setActiveSection('account')} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"><UserCircle size={20}/></button></div></div></header>;

  if (
    activeSection === 'account'
  ) {
    return (
      <>{guide}
      <div className="portal-shell min-h-screen bg-slate-50 pb-28">
        {accountHeader}
        <OfflineStatus />
        {logoutError && <p role="alert" className="mx-auto mt-3 max-w-6xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{logoutError}</p>}
        <div className={sectionTransitioning ? 'mm-section-enter' : undefined}>
          <AccountSection
            profile={profile}
            wallet={wallet}
            loggingOut={loggingOut}
            onLogout={handleLogout}
            onLock={onPrivacyLock}
            onBack={() =>
              setActiveSection('home')
            }
            onServices={() => setActiveSection('services')}
            onNavigate={openHelpDestination}
          />
        </div>

        <PortalNavigation
          activeSection={activeSection}
          onNavigate={setActiveSection}
          role={role}
        />
      </div>
      </>
    );
  }

  return (
    <>{guide}
    <div className="portal-shell relative min-h-screen bg-slate-50 pb-24 [&_.mm-home-heading>button]:hidden">
      {accountHeader}
        <OfflineStatus />
      <div className="mx-auto max-w-6xl px-4"><KycStatusNotice profile={profile} onVerify={() => { sessionStorage.setItem('ob_role', role); navigate('/onboarding/personal?resume=1'); }}/></div>
      {activeSection !== 'home' && activeSection !== 'services' && (
        <div className="mx-auto flex max-w-6xl justify-start px-4 pt-4 pb-1">
          <button type="button" aria-label={activeSection === 'ride' || activeSection === 'delivery' ? 'Back to Home' : 'Back to Services'} title={activeSection === 'ride' || activeSection === 'delivery' ? 'Home' : 'Services'} onClick={() => setActiveSection(activeSection === 'ride' || activeSection === 'delivery' ? 'home' : 'services')} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
            <ArrowLeft size={19}/>
          </button>
        </div>
      )}
      <div className={sectionTransitioning ? 'mm-section-enter' : undefined}>
        <Suspense fallback={<CustomerWorkspaceLoading />}>
          {activeSection === 'home' && <CustomerHome key={`${profile.id}:${role}`} profile={profile} onNavigate={setActiveSection} />}
          {activeSection === 'services' && <PortalHome key={`${profile.id}:${role}:services`} profile={profile} mode="services" onNavigate={setActiveSection} />}
          {activeSection !== 'home' && activeSection !== 'services' && role === 'rider' && (
            <RiderDashboard
              profile={profile}
              wallet={wallet}
              activeSection={activeSection === 'ride' ? 'home' : activeSection}
              resumeTripId={resumeTripId}
              onResumeTrip={(bookingId:string)=>{rememberTrip(bookingId);setActiveSection('ride');}}
              onOpenTrips={(bookingId?:string|null)=>{if(bookingId)rememberTrip(bookingId);setActiveSection('trips');}}
              onBack={() => setActiveSection('home')}
            />
          )}

          {activeSection !== 'home' && activeSection !== 'services' && role === 'driver' && (
            <DriverDashboard
              profile={profile}
              wallet={wallet}
              activeSection={activeSection === 'ride' ? 'home' : activeSection}
              resumeTripId={resumeTripId}
              onResumeTrip={(bookingId:string)=>{rememberTrip(bookingId);setActiveSection('ride');}}
            />
          )}

          {activeSection !== 'home' && activeSection !== 'services' && role === 'merchant' && (
            <MerchantDashboard
              profile={profile}
              wallet={wallet}
              activeSection={activeSection === 'ride' ? 'home' : activeSection}
              resumeTripId={resumeTripId}
              onResumeTrip={(bookingId:string)=>{rememberTrip(bookingId);setActiveSection('ride');}}
              onOpenTrips={(bookingId?:string|null)=>{if(bookingId)rememberTrip(bookingId);setActiveSection('trips');}}
              onBack={() => setActiveSection('home')}
            />
          )}
        </Suspense>
      </div>

      <PortalNavigation
        activeSection={activeSection}
        onNavigate={(section:PortalSection)=>setActiveSection(section)}
        role={role}
      />
    </div>
    </>
  );
}


function CustomerWorkspaceLoading({label='Loading your MatMove workspace...'}:{label?:string}) {
  return (
    <section role="status" aria-live="polite" className="mx-auto max-w-6xl px-4 py-10">
      <div className="rounded-3xl border border-white/85 bg-white/75 p-6 shadow-[0_16px_42px_rgba(16,50,83,.09)] backdrop-blur-xl">
        <div className="motion-safe:animate-pulse h-3 w-24 rounded-full bg-emerald-100" />
        <div className="motion-safe:animate-pulse mt-4 h-7 w-2/3 rounded-xl bg-sky-100" />
        <p className="mt-5 text-sm font-semibold text-slate-600">{label}</p>
      </div>
    </section>
  );
}

function KycStatusNotice({profile, onVerify}: {profile: CustomerProfile | null; onVerify: () => void}) {
  if (!profile || profile.kyc_status === 'approved') return null;
  const status = profile.kyc_status || '';
  const rejected = ['rejected','declined','resubmission_required'].includes(status);
  const pending = profile.role !== 'rider' && ['submitted','pending','under_review'].includes(status);
  return <section role="status" className={`my-4 rounded-2xl border p-4 ${rejected ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
    <h2 className="font-bold">{rejected ? status === 'resubmission_required' ? 'Verification update required' : 'Verification rejected' : pending ? 'Approval pending' : 'Verify your identity'}</h2>
    <p className="mt-1 whitespace-pre-wrap text-sm">{rejected ? profile.kyc_rejection_reason || 'Contact MatMove support for your review details.' : pending ? 'Your dashboard is available. Wallet features unlock after administrator approval.' : 'You can load your rider wallet. Complete verification to unlock transfers and withdrawals.'}</p>
    <button type="button" onClick={onVerify} className="mt-3 font-bold underline">{rejected ? 'Correct and resubmit verification' : pending ? 'Continue verification draft' : 'Verify identity →'}</button>
  </section>;
}

function AccountSection({
  profile,
  wallet,
  loggingOut,
  onLogout,
  onBack,
  onLock,
  onServices,
  onNavigate,
}: AccountSectionProps) {
  const navigate = useNavigate();
  const resumeVerification = () => { if (profile.kyc_status === 'approved') return; sessionStorage.setItem('ob_role', profile.role); navigate('/onboarding/personal?resume=1'); };
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [viewingGames, setViewingGames] = useState(false);
  const [viewingWallet, setViewingWallet] = useState(false);
  const [
    showDeleteConfirm,
    setShowDeleteConfirm,
  ] = useState(false);

  const [deletePin, setDeletePin] = useState('');
  const [deleteRequestBusy,setDeleteRequestBusy]=useState(false);
  const [deleteRequestError,setDeleteRequestError]=useState('');
  const [deleteRequestNotice,setDeleteRequestNotice]=useState('');
  const [deleteRequestStatus,setDeleteRequestStatus]=useState<string|null>(null);

  const [
    viewingAnalytics,
    setViewingAnalytics,
  ] = useState(false);

  const [
    analyticsTimeframe,
    setAnalyticsTimeframe,
  ] = useState<
    'daily' | 'weekly' | 'monthly'
  >('daily');

  const [
    analyticsData,
    setAnalyticsData,
  ] = useState<AnalyticsSummary>({
    primaryMetric: 0,
    completed: 0,
    pending: 0,
    totalCount: 0,
  });

  const [cartItems, setCartItems] =
    useState<CustomerCartItem[]>([]);

  const [riderOrders, setRiderOrders] =
    useState<CustomerOrder[]>([]);

  const [
    viewingCartOrders,
    setViewingCartOrders,
  ] = useState(false);

  const [cartOrderTab, setCartOrderTab] =
    useState<'cart' | 'orders'>('cart');

  const [orderFilter, setOrderFilter] =
    useState<
      'all' | 'pending' | 'completed'
    >('all');

  const fetchCartAndOrders = useCallback(async () => {
    if (
      profile.role !== 'rider'
    ) {
      return;
    }

    const {
      data: cartData,
    } = await supabase
      .from('cart_items')
      .select(
        '*, product:product_id(*)'
      )
      .eq('rider_id', profile.id);

    if (cartData) {
      setCartItems(
        Array.isArray(cartData)
          ? cartData
          : []
      );
    }

    const {
      data: orderData,
    } = await supabase
      .from('app_orders')
      .select(
        '*, merchant:merchant_id(business_name, full_name)'
      )
      .eq('rider_id', profile.id)
      .order('created_at', {
        ascending: false,
      });

    if (orderData) {
      setRiderOrders(
        Array.isArray(orderData)
          ? orderData
          : []
      );
    }
  }, [profile.id, profile.role]);

  const fetchAnalytics = useCallback(async () => {
    const now = new Date();
    const timeLimit = new Date();

    if (
      analyticsTimeframe === 'daily'
    ) {
      timeLimit.setHours(0, 0, 0, 0);
    }

    if (
      analyticsTimeframe === 'weekly'
    ) {
      timeLimit.setDate(
        now.getDate() - 7
      );
    }

    if (
      analyticsTimeframe === 'monthly'
    ) {
      timeLimit.setDate(1);
    }

    if (
      profile.role === 'merchant'
    ) {
      const { data } = await supabase
        .from('app_orders')
        .select('*')
        .eq(
          'merchant_id',
          profile.id
        )
        .gte(
          'created_at',
          timeLimit.toISOString()
        );

      if (
        data &&
        Array.isArray(data)
      ) {
        let rev = 0;
        let comp = 0;
        let pend = 0;

        data.forEach((o: CustomerOrder) => {
          if (
            o.status === 'completed'
          ) {
            rev += Number(o.price || 0);
            comp += 1;
          } else {
            pend += 1;
          }
        });

        setAnalyticsData({
          primaryMetric: rev,
          completed: comp,
          pending: pend,
          totalCount: data.length,
        });
      }
    } else if (
      profile.role === 'driver'
    ) {
      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq(
          'driver_id',
          profile.id
        )
        .gte(
          'created_at',
          timeLimit.toISOString()
        );

      if (
        data &&
        Array.isArray(data)
      ) {
        let earnings = 0;
        let comp = 0;
        let pend = 0;

        data.forEach((b: CustomerBooking) => {
          if (
            b.status === 'completed'
          ) {
            earnings +=
              Number(
                b.fare_amount || 0
              ) * 0.85;
            comp += 1;
          } else if (
            b.status === 'accepted' ||
            b.status === 'in_progress'
          ) {
            pend += 1;
          }
        });

        setAnalyticsData({
          primaryMetric: earnings,
          completed: comp,
          pending: pend,
          totalCount: data.length,
        });
      }
    } else if (
      profile.role === 'rider'
    ) {
      const {
        data: orders,
      } = await supabase
        .from('app_orders')
        .select('*')
        .eq(
          'rider_id',
          profile.id
        )
        .gte(
          'created_at',
          timeLimit.toISOString()
        );

      const {
        data: bookings,
      } = await supabase
        .from('bookings')
        .select('*')
        .eq(
          'rider_id',
          profile.id
        )
        .gte(
          'created_at',
          timeLimit.toISOString()
        );

      let spent = 0;
      let comp = 0;
      let pend = 0;

      (orders || []).forEach(
        (o: CustomerOrder) => {
          if (
            o.status === 'completed'
          ) {
            spent += Number(
              o.price || 0
            );
            comp += 1;
          } else {
            pend += 1;
          }
        }
      );

      (bookings || []).forEach(
        (b: CustomerBooking) => {
          if (
            b.status === 'completed'
          ) {
            spent += Number(
              b.fare_amount || 0
            );
            comp += 1;
          } else if (
            b.status === 'pending' ||
            b.status === 'accepted' ||
            b.status === 'in_progress'
          ) {
            pend += 1;
          }
        }
      );

      setAnalyticsData({
        primaryMetric: spent,
        completed: comp,
        pending: pend,
        totalCount:
          (orders?.length || 0) +
          (bookings?.length || 0),
      });
    }
  }, [analyticsTimeframe, profile.id, profile.role]);

  useEffect(() => {
    if (
      profile.role === 'rider'
    ) {
      void fetchCartAndOrders();
    }

    if (viewingAnalytics && !['rider', 'driver', 'merchant'].includes(profile.role)) {
      void fetchAnalytics();
    }
  }, [
    profile.id,
    profile.role,
    analyticsTimeframe,
    viewingAnalytics,
    viewingCartOrders,
    fetchCartAndOrders,
    fetchAnalytics,
  ]);

  const deletionBusy = useRef(false);
  useEffect(()=>{
    let active=true;
    void supabase.rpc('matmove_customer_account_deletion_status').then(({data,error})=>{
      if(!active||error)return;
      if(data&&typeof data.status==='string')setDeleteRequestStatus(data.status);
    });
    return()=>{active=false;};
  },[profile.id]);
  const handleDeleteAccount = async () => {
    if(deletionBusy.current||deleteRequestBusy)return;
    deletionBusy.current=true;setDeleteRequestBusy(true);setDeleteRequestError('');setDeleteRequestNotice('');
    try{
      const receipt=await customerPasscode(profile.id,'verify',deletePin);
      setDeletePin('');
      if(!receipt.ok||receipt.digits<6||receipt.digits>9||receipt.code!=='verified')throw Error(receipt.code==='cooldown'?'Try again in '+receipt.retryAfterSeconds+' seconds.':'Incorrect passcode.');
      const result=await supabase.rpc('matmove_customer_request_account_deletion',{p_reason:'Customer requested account deletion from Account Settings.'});
      if(result.error)throw result.error;
      if(result.data?.success!==true||typeof result.data.status!=='string')throw Error('MatMove did not confirm the deletion request. Check its status before retrying.');
      setDeleteRequestStatus(result.data.status);
      setDeleteRequestNotice(result.data.alreadyRequested?'Your existing account deletion request is already recorded.':'Your account deletion request has been recorded. MatMove will review open trips, orders, wallet balances and payment records before completing the process.');
      setShowDeleteConfirm(false);
    }catch(e){setDeletePin('');setDeleteRequestError(e instanceof Error?e.message:'Passcode verification failed.');}
    finally{deletionBusy.current=false;setDeleteRequestBusy(false);}
  };

  const handleRemoveFromCart = async (
    cartId: string
  ) => {
    await supabase
      .from('cart_items')
      .delete()
      .eq('id', cartId);

    fetchCartAndOrders();
  };

  const [checkoutMerchant, setCheckoutMerchant] = useState('');
  const merchantChoices = [...new Set(cartItems.map(item => String(item.product?.merchant_id || '')).filter(Boolean))];
  const selectedMerchant = merchantChoices.includes(checkoutMerchant) ? checkoutMerchant : merchantChoices[0];
  const checkoutItems = cartItems.filter(item => item.product?.merchant_id === selectedMerchant);
  const checkoutListingsReady = checkoutItems.length>0 && checkoutItems.every(item =>catalogCheckoutAllowed(item.product));


  const filteredRiderOrders =
    riderOrders.filter(
      o =>
        orderFilter === 'all'
          ? true
          : o.status === orderFilter
    );

  if (viewingGames) {
    return (
      <Suspense fallback={<CustomerWorkspaceLoading label="Loading MatMove Games..." />}>
        <ArcadeGames key={profile.id} userId={profile.id} onBack={() => setViewingGames(false)} />
      </Suspense>
    );
  }

  if (viewingAnalytics && (profile.role === 'rider' || profile.role === 'driver')) {
    return (
      <Suspense fallback={<CustomerWorkspaceLoading label="Loading your activity..." />}>
        <ActivityAnalytics role={profile.role} onBack={() => setViewingAnalytics(false)} />
      </Suspense>
    );
  }

  if (viewingAnalytics && profile.role === 'merchant') {
    return (
      <Suspense fallback={<CustomerWorkspaceLoading label="Loading business analytics..." />}>
        <MerchantAnalytics userId={profile.id} onBack={() => setViewingAnalytics(false)} />
      </Suspense>
    );
  }

  if (viewingAnalytics) {
    const title =
      profile.role === 'merchant'
        ? 'Business Analytics'
        : profile.role === 'driver'
          ? 'Driving Analytics'
          : 'Rider Activity Analytics';

    const primaryLabel =
      profile.role === 'merchant'
        ? 'Total Revenue'
        : profile.role === 'driver'
          ? 'Take-Home Earnings'
          : 'Total Spent';

    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <button
          type="button"
          aria-label="Back to Profile"
          title="Profile"
          onClick={() => setViewingAnalytics(false)}
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft size={19}/>
        </button>

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-900">
            {title}
          </h1>

          <select
            value={analyticsTimeframe}
            onChange={e => setAnalyticsTimeframe(e.target.value as 'daily' | 'weekly' | 'monthly')}
            className="bg-white border border-slate-200 text-sm font-bold p-2.5 rounded-xl outline-none cursor-pointer text-slate-700 shadow-sm"
          >
            <option value="daily">
              Today
            </option>

            <option value="weekly">
              This Week
            </option>

            <option value="monthly">
              This Month
            </option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
              <DollarSign
                size={16}
                className="text-emerald-400"
              />
              {primaryLabel}
            </div>

            <div className="text-3xl font-bold text-emerald-400">
              SLE{' '}
              {analyticsData.primaryMetric.toFixed(2)}
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
              <CheckCircle2
                size={16}
                className="text-emerald-600"
              />
              Completed
            </div>

            <div className="text-3xl font-bold text-slate-900">
              {analyticsData.completed}
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
              <AlertCircle
                size={16}
                className="text-amber-500"
              />
              Pending / Active
            </div>

            <div className="text-3xl font-bold text-slate-900">
              {analyticsData.pending}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <h3 className="font-bold text-slate-900 text-lg mb-4 flex items-center gap-2">
            <TrendingUp
              size={20}
              className="text-blue-600"
            />
            Summary Breakdown
          </h3>

          <p className="text-sm text-slate-500">
            During this {analyticsTimeframe}{' '}
            period, you processed a total of{' '}
            <strong>
              {analyticsData.totalCount}
            </strong>{' '}
            transactions across the MatMove
            platform.
          </p>
        </div>
      </div>
    );
  }

  if (
    viewingCartOrders &&
    profile.role === 'rider'
  ) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <button
          type="button"
          aria-label="Back to Profile"
          title="Profile"
          onClick={() => setViewingCartOrders(false)}
          className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft size={19}/>
        </button>

        <h1 className="text-3xl font-bold text-slate-900 mb-6">
          Shop Activity
        </h1>

        <div className="flex bg-slate-200 p-1 rounded-xl mb-6 w-full sm:w-fit">
          <button
            onClick={() =>
              setCartOrderTab('cart')
            }
            className={`flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition ${
              cartOrderTab === 'cart'
                ? 'bg-white shadow-sm text-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Cart ({cartItems.length})
          </button>

          <button
            onClick={() =>
              setCartOrderTab('orders')
            }
            className={`flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition ${
              cartOrderTab === 'orders'
                ? 'bg-white shadow-sm text-blue-600'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Orders ({riderOrders.length})
          </button>
        </div>

        {cartOrderTab === 'cart' && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
            {cartItems.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <ShoppingBag
                  size={48}
                  className="mx-auto mb-4 text-slate-300"
                />

                <p>Your cart is empty.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {cartItems.map(item => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100"
                  >
                    <div>
                      <p className="font-bold text-slate-900">
                        {item.product?.name}
                      </p>

                      <p className="text-xs text-slate-500 mt-1">
                        Merchant:{' '}
                        {item.product?.merchant?.business_name ||
                          'Merchant'}
                      </p>

                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.product?.is_available===false?'Sold · ':''}{item.product?.currency==='USD'?'USD listing — wallet checkout unavailable · ':''}Qty: {item.quantity || 1}
                        {' • '}
                        {catalogMoney(item.product?.price,item.product?.currency??'SLE')}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <p className="font-bold text-orange-600">
                        {catalogMoney(item.product?.price,item.product?.currency??'SLE',item.quantity||1)}
                      </p>

                      <button
                        onClick={() =>
                          handleRemoveFromCart(
                            item.id
                          )
                        }
                        className="text-red-500 p-2 bg-red-50 rounded-lg hover:bg-red-100 transition"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                <p className="border-t pt-4 text-sm text-slate-600">Pay one merchant at a time. You can choose product only or optional Freetown delivery at checkout.</p>
              </div>
            )}
          </div>
        )}

        {cartOrderTab === 'cart' && <div className="rounded-2xl border bg-white p-4">
          {merchantChoices.length > 1 && <label className="block font-bold">Choose merchant to pay
            <select value={selectedMerchant || ''} onChange={e => setCheckoutMerchant(e.target.value)} className="mt-2 w-full rounded-xl border p-3">
              {merchantChoices.map(id => <option key={id} value={id}>{cartItems.find(x => x.product?.merchant_id === id)?.product?.merchant?.business_name || cartItems.find(x => x.product?.merchant_id === id)?.product?.merchant?.full_name || `Merchant ${id.slice(0,8)}`}</option>)}
            </select>
          </label>}
          {!checkoutListingsReady&&checkoutItems.length>0&&<p role="alert" className="my-3 text-sm text-amber-900">Remove sold or unsupported-currency products before wallet checkout. No currency conversion is applied.</p>}
          <MerchantCheckout userId={profile.id} initialPhone={profile.phone || profile.phone_number || ''}
            items={checkoutListingsReady ? checkoutItems.map(item => ({productId: item.product?.id || item.product_id || '', quantity: item.quantity || 1})) : []}
            onPaid={async payment => {
              const paidRows = cartItems.filter(row => payment.items.some(item => {
                if (item.productId !== (row.product_id || row.product?.id)) return false;
                const rows = cartItems.filter(x => (x.product_id || x.product?.id) === item.productId);
                return rows.reduce((sum: number, x) => sum + (x.quantity || 1), 0) === item.quantity;
              }));
              if (paidRows.length) {
                const result = await supabase.from('cart_items').delete().eq('rider_id', profile.id).in('id', paidRows.map(x => x.id));
                if (result.error) throw result.error;
              }
              await fetchCartAndOrders();
            }} />
        </div>}

        {cartOrderTab === 'orders' && (
          <div className="space-y-4">
            <div className="flex gap-2 mb-4 bg-white p-2 rounded-xl border border-slate-200 w-fit shadow-sm">
              <button
                onClick={() =>
                  setOrderFilter('all')
                }
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                  orderFilter === 'all'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                All
              </button>

              <button
                onClick={() =>
                  setOrderFilter('pending')
                }
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                  orderFilter === 'pending'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                Pending
              </button>

              <button
                onClick={() =>
                  setOrderFilter('completed')
                }
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                  orderFilter === 'completed'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                Completed
              </button>
            </div>

            {filteredRiderOrders.length === 0 ? (
              <p className="text-center text-slate-500 py-10 bg-white rounded-3xl border border-slate-200">
                No orders found.
              </p>
            ) : (
              <div className="space-y-4">
                {filteredRiderOrders.map(o => (
                  <div
                    key={o.id}
                    className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4 transition hover:shadow-md"
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-lg flex items-center gap-2">
                        {o.product_name}

                        <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 rounded-full font-bold">
                          Qty: {o.quantity || 1}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-bold">{o.wallet_payment_status === 'paid' ? 'Paid in-app — merchant credited' : 'Payment not confirmed'}</p>
                      {o.wallet_payment_id && <p className="mt-1 break-all text-xs">Payment receipt: {o.wallet_payment_id}</p>}
                      <div className="text-sm text-slate-500 mt-2 flex items-center gap-1.5">
                        <Store size={14} />
                        {o.merchant?.business_name ||
                          o.merchant?.full_name ||
                          'Store Merchant'}
                      </div>

                      <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                        <Clock size={12} />
                        {new Date(o.created_at || 0).toLocaleString()}
                      </div>
                    </div>

                    <div className="text-left sm:text-right flex flex-col sm:items-end">
                      <div className="font-bold text-xl text-slate-900">
                        SLE{' '}
                        {Number(o.price).toFixed(2)}
                      </div>

                      <span
                        className={`mt-2 inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border ${
                          o.status === 'completed'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-amber-50 border-amber-200 text-amber-700'
                        }`}
                      >
                        {o.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (viewingWallet) {
    const walletPage = profile.role === 'rider'
      ? <RiderDashboard profile={profile} wallet={wallet} activeSection="wallet" />
      : profile.role === 'driver'
        ? <DriverDashboard profile={profile} wallet={wallet} activeSection="wallet" />
        : <MerchantDashboard profile={profile} wallet={wallet} activeSection="wallet" />;
    return <div className="min-h-screen bg-slate-50 px-4 pb-24 pt-4">
      <div className="mx-auto mb-3 max-w-6xl">
        <button type="button" onClick={() => setViewingWallet(false)} aria-label="Back to Account" title="Account" className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"><ArrowLeft size={19}/></button>
      </div>
      {walletPage}
    </div>;
  }

  if (activePanel === 'support-media') {
    return <Suspense fallback={<div className="min-h-[100dvh] grid place-items-center text-sm text-slate-500">Loading Support Media…</div>}>
      <SupportMediaPage onBack={() => setActivePanel(null)}/>
    </Suspense>;
  }

  if (activePanel === 'profile') {
    return (
      <section className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        <button type="button" onClick={() => setActivePanel(null)} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
          <ArrowLeft size={19}/>
        </button>
        <h1 className="mb-4 text-2xl font-bold text-slate-900">Profile</h1>
        <AccountProfile key={profile.id} userId={profile.id} showPasskey={false}/>
        <section aria-labelledby="mm-verified-details-title" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="mm-verified-details-title" className="font-bold text-slate-900">Account & verified details</h2>
            {profile.kyc_status === 'approved' && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800"><LockKeyhole size={13}/> Verified · Locked</span>}
          </div>
          <p className="mt-1 text-sm text-slate-500">Your registered contact information and legal identity are managed separately from your display name and profile photo.</p>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">Legal name</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{profile.full_name?.trim() || [profile.first_name,profile.last_name].filter(Boolean).join(' ') || 'Not supplied'}</dd></div>
            <div className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">Email address</dt><dd className="mt-1 break-all text-sm font-semibold text-slate-900">{profile.email || 'Not supplied'}</dd></div>
            <div className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">Phone number</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{profile.phone || profile.phone_number || 'Not supplied'}</dd></div>
            <div className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">Verification status</dt><dd className="mt-1 text-sm font-semibold capitalize text-slate-900">{String(profile.kyc_status || 'not_started').replace(/_/g,' ')}</dd></div>
          </dl>
          {profile.kyc_status === 'approved'
            ? <p className="mt-3 text-xs leading-5 text-slate-500">These verified details are read-only. Contact MatMove Support if an approved identity or contact detail needs correction.</p>
            : <button type="button" onClick={resumeVerification} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">Continue verification <ArrowRight size={16}/></button>}
        </section>
      </section>
    );
  }

  if (activePanel === 'invite') {
    return <section className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      <button type="button" onClick={() => setActivePanel(null)} aria-label="Back to Account" title="Account" className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm"><ArrowLeft size={19}/></button>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Invite & Earn</h1>
      <InviteEarn key={`referrals:${profile.id}`} userId={profile.id}/>
    </section>;
  }

  if (activePanel === 'policy') {
    return <section className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      <button type="button" onClick={() => setActivePanel(null)} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"><ArrowLeft size={17}/> Back to Account</button>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Safety & Compliance</h1>
      <AccountPolicy />
    </section>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      <button type="button" onClick={onBack} aria-label="Back to portal" title="Portal" className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"><ArrowLeft size={19}/></button>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">MatMove account</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Account & Profile</h1></div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onLock} aria-label="Lock app" title="Lock app" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"><LockKeyhole size={18}/></button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setViewingWallet(true)} className="mm-account-link"><span className="mm-account-link-icon bg-emerald-50 text-emerald-700"><Wallet size={19}/></span><span className="min-w-0 flex-1"><b>Wallet & payments</b><small>Balances, transactions, top-ups and transfers</small></span><ArrowRight size={18}/></button>
        <button type="button" onClick={onServices} aria-label="Open services" className="mm-account-link mm-account-link-compact"><span className="mm-account-link-icon bg-slate-100 text-slate-700"><Store size={17}/></span><span className="min-w-0 flex-1"><b>Services</b><small>Open MatMove services</small></span><ArrowRight size={17}/></button>
      </div>

      <PasskeySecurity key={profile.id} userId={profile.id}/>

      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        <button type="button" onClick={() => setActivePanel('profile')} className="mm-account-row"><span className="mm-account-link-icon bg-blue-50 text-blue-700"><UserCircle size={19}/></span><span className="min-w-0 flex-1"><b>Profile & personal details</b><small>Profile photo, display name, email, phone and verified identity</small></span><ArrowRight size={18}/></button>
        <button type="button" onClick={() => setActivePanel('support-media')} className="mm-account-row"><span className="mm-account-link-icon bg-sky-50 text-sky-700"><Globe size={19}/></span><span className="min-w-0 flex-1"><b>Support Media</b><small>WhatsApp, Instagram and official MatMove channels</small></span><ArrowRight size={18}/></button>
        <button type="button" onClick={() => setActivePanel('invite')} className="mm-account-row"><span className="mm-account-link-icon bg-amber-50 text-amber-700"><Gift size={19}/></span><span className="min-w-0 flex-1"><b>Invite & Earn</b><small>Your referral code, friends and rewards</small></span><ArrowRight size={18}/></button>
        <button type="button" onClick={() => setActivePanel('policy')} className="mm-account-row"><span className="mm-account-link-icon bg-orange-50 text-orange-700"><ShieldAlert size={19}/></span><span className="min-w-0 flex-1"><b>Safety & Compliance</b><small>MatMove safety rules and user policy</small></span><ArrowRight size={18}/></button>
        <button type="button" onClick={() => setViewingAnalytics(true)} className="mm-account-row"><span className="mm-account-link-icon bg-violet-50 text-violet-700"><BarChart2 size={19}/></span><span className="min-w-0 flex-1"><b>{profile.role === 'merchant' ? 'Business Analytics' : profile.role === 'driver' ? 'Driving Analytics' : 'Rider Analytics'}</b><small>Performance, activity and reports</small></span><ArrowRight size={18}/></button>
        {profile.role === 'rider' && <button type="button" onClick={() => setViewingCartOrders(true)} className="mm-account-row"><span className="mm-account-link-icon bg-sky-50 text-sky-700"><ShoppingCart size={19}/></span><span className="min-w-0 flex-1"><b>My Cart & Orders</b><small>{cartItems.length} items in cart · {riderOrders.length} orders</small></span><ArrowRight size={18}/></button>}
      </div>

      <button type="button" onClick={() => setViewingGames(true)} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-gradient-to-r from-purple-950 to-slate-950 p-4 text-left text-white">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-amber-300"><Gift size={20}/></span><span className="min-w-0 flex-1"><b className="block text-sm text-amber-300">Games — Spin & Win</b><small className="mt-1 block text-xs text-slate-300">Choose a fee · Six segments · One possible free bonus · 18+</small></span><ArrowRight size={18} className="text-amber-300"/>
      </button>



      <section className="mb-4 rounded-2xl border border-red-100 bg-white p-4">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-red-600"><ShieldAlert size={18}/>Danger Zone</h2>
        <p className="mb-3 text-sm text-slate-600">Request account closure securely. MatMove checks for unsettled wallet funds, active trips, orders and pending payments first. Your login and historical financial records are not erased automatically.</p>
        {deleteRequestStatus&&deleteRequestStatus!=='rejected'&&<p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Deletion request status: <b>{deleteRequestStatus.replace('_',' ')}</b>. Your account remains available while the request is reviewed.</p>}
        {deleteRequestNotice&&<p role="status" className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{deleteRequestNotice}</p>}
        {deleteRequestError&&<p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{deleteRequestError}</p>}
        {!showDeleteConfirm ? <button disabled={deleteRequestStatus==='requested'||deleteRequestStatus==='under_review'||deleteRequestBusy} onClick={() => {setDeleteRequestError('');setShowDeleteConfirm(true);}} className="min-h-11 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">{deleteRequestStatus==='requested'||deleteRequestStatus==='under_review'?'Deletion request already submitted':'Request Account Deletion'}</button> : <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm font-bold text-red-800">Enter your 6–9 digit passcode to confirm the deletion request. This submits a request for review; it does not instantly erase your account.</p>
          <div className="flex flex-wrap gap-2"><input type="password" maxLength={9} inputMode="numeric" autoComplete="off" value={deletePin} onChange={e => setDeletePin(e.target.value.replace(/[^0-9]/g,'').slice(0,9))} className="min-h-11 w-32 rounded-lg border border-red-300 bg-white p-2 text-center text-lg tracking-widest"/><button onClick={handleDeleteAccount} disabled={deleteRequestBusy||deletePin.length<6||deletePin.length>9} className="min-h-11 rounded-lg bg-red-600 px-4 font-bold text-white disabled:opacity-50">{deleteRequestBusy?'Submitting…':'Submit deletion request'}</button></div>
          <button onClick={() => {setShowDeleteConfirm(false);setDeletePin('');}} className="mt-2 min-h-10 text-xs font-bold text-slate-500">Cancel</button>
        </div>}
      </section>

      <button onClick={onLogout} disabled={loggingOut} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 sm:w-auto"><LogOut size={18}/>{loggingOut?'Signing out…':'Log out of MatMove'}</button>
    </div>
  );
}

function PortalNavigation({ activeSection, onNavigate, role }: { activeSection: PortalSection; onNavigate: (section: PortalSection) => void; role: CustomerRole }) {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'ride', label: role === 'driver' ? 'Ride' : 'Ride', icon: role === 'driver' ? Navigation : Car },
    { id: 'services', label: 'Services', icon: Store },
    { id: 'trips', label: 'Trips', icon: Navigation },
  ];
  return <nav className="mm-portal-nav" aria-label="Main navigation">
    <div>{tabs.map(item => {
      const Icon = item.icon;
      const active = activeSection === item.id || (activeSection === 'delivery' && item.id === 'ride');
      return <button key={item.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id as PortalSection)}><Icon size={20}/><span>{item.label}</span></button>;
    })}</div>
  </nav>;
}

function CustomerPortal() {
  const {
    session,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <Navigate
        to="/login?returnTo=customer"
        replace
      />
    );
  }

  if (session.roles.length !== 1 || !session.user.phone) return <Navigate to="/select-role" replace />;
  return <PortalApp />;
}

function OnboardingGuard({ children, needsRole = true }: { children: React.ReactNode; needsRole?: boolean }) {
  const { session, loading, authError, refreshSession, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status" className="p-8">Loading your account…</p>;
  if (authError) return <div className="p-8"><p role="alert">{authError}</p><button className="primary-button mt-4" onClick={() => void refreshSession().catch(() => {})}>Retry</button><button className="ml-4" onClick={() => void signOut()}>Sign out</button></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (needsRole && (session.roles.length !== 1 || !session.user.phone)) return <Navigate to="/select-role" replace />;
  if (session.roles[0]) sessionStorage.setItem('ob_role', session.roles[0]);
  const finished = ['/onboarding/submitted','/verification'].includes(location.pathname);
  if (!needsRole && session.kycStatus === 'approved') return <Navigate to={`/customer/${session.roles[0]}`} replace />;
  if (needsRole && !finished) return <KycWorkspace>{children}</KycWorkspace>;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<div role="status" aria-live="polite" className="min-h-[40vh] p-8 text-center text-sm font-semibold text-slate-600">Loading MatMove…</div>}>
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/pay/complete" element={<ReceivePaymentCompletePage />} />
      <Route path="/pay/:slug" element={<ReceivePayLinkPage />} />
      <Route
        path="/"
        element={<LandingPage />}
      />

      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/signup"
        element={<SignupPage />}
      />

      <Route
        path="/reset-password"
        element={<UpdatePassword mode="password" />}
      />

      <Route
        path="/reset-passcode"
        element={<UpdatePassword mode="passcode" />}
      />

      <Route
        path="/select-role"
        element={<OnboardingGuard needsRole={false}><RoleSelectionPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/personal"
        element={<OnboardingGuard><PersonalInfoPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/identity"
        element={<OnboardingGuard><IdentityPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/documents"
        element={<OnboardingGuard><DocumentsPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/selfie"
        element={<OnboardingGuard><SelfiePage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/vehicle"
        element={<OnboardingGuard><VehicleSelectionPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/review"
        element={<OnboardingGuard><ReviewPage /></OnboardingGuard>}
      />

      <Route
        path="/onboarding/submitted"
        element={<OnboardingGuard><SubmittedPage /></OnboardingGuard>}
      />

      <Route
        path="/verification"
        element={<OnboardingGuard><VerificationPage /></OnboardingGuard>}
      />

      <Route
        path="/customer/*"
        element={<CustomerPortal />}
      />

      <Route
        path="/customer/rider/*"
        element={<CustomerPortal />}
      />

      <Route
        path="/customer/driver/*"
        element={<CustomerPortal />}
      />

      <Route
        path="/customer/merchant/*"
        element={<CustomerPortal />}
      />

      <Route
        path="*"
        element={
          <Navigate
            to="/"
            replace
          />
        }
      />
    </Routes>
    </Suspense>
  );
}
