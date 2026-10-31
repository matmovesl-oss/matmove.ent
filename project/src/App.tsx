import CustomerPasscode, {customerPasscode} from '@/components/CustomerPasscode';
import {catalogMoney, catalogCheckoutAllowed} from '@/components/ProductCatalog';
import InviteEarn from '@/components/InviteEarn';
import MatMoveHelp, {customerHelpSection} from '@/components/MatMoveHelp';
import NotificationBell from '@/components/NotificationBell';

import PortalHome from '@/components/PortalHome';
import PortalGuide from '@/components/PortalGuide';
import AccountProfile, {AccountIdentity} from '@/components/AccountProfile';





import { ArcadeGames } from '@/components/ArcadeGames';

import ActivityAnalytics from '@/components/ActivityAnalytics';
import MerchantAnalytics from '@/components/MerchantAnalytics';

import MerchantCheckout from '@/components/MerchantCheckout';
import { AccountPolicy } from '@/components/AccountPolicy';
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { resolveCustomerRole } from '../shared/customer-access.js';

import { LandingPage } from '@/pages/LandingPage';
import {
  LoginPage,
  SignupPage,
  AuthCallbackPage,
} from '@/pages/AuthPages';
import {
  ForgotPasswordPage,
} from '@/pages/PasswordPages';
import {
  UpdatePassword,
} from '@/pages/UpdatePassword';

import {
  RoleSelectionPage,
  KycWorkspace,
  PersonalInfoPage,
  IdentityPage,
  DocumentsPage,
  SelfiePage,
  VehicleSelectionPage,
  ReviewPage,
  SubmittedPage,
  VerificationPage,
} from '@/pages/OnboardingPages';

import {
  RiderDashboard,
} from '@/pages/RiderDashboard';
import {
  DriverDashboard,
} from '@/pages/DriverDashboard';
import {
  MerchantDashboard,
} from '@/pages/MerchantDashboard';

import {
  UserCircle,
  LogOut,
  MessageSquare,
  ShieldAlert,
  Home,
  Car,
  Wallet,
  Navigation,
  ShoppingBag,
  Store,
  LockKeyhole,
  Delete,
  ShoppingCart,
  ArrowRight,
  Loader2,
  Trash2,
  BarChart2,
  MapPin,
  Phone,
  Clock,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

type PortalSection =
  | 'home'
  | 'ride'
  | 'wallet'
  | 'trips'
  | 'shop'
  | 'inventory'
  | 'account';

type CustomerRole =
  | 'rider'
  | 'driver'
  | 'merchant';



const WHATSAPP_NUMBER = '23290330362';

function getRoleFromPath(
  pathname: string
): CustomerRole | null {
  if (pathname.includes('/driver')) {
    return 'driver';
  }

  if (pathname.includes('/merchant')) {
    return 'merchant';
  }

  if (pathname.includes('/rider')) {
    return 'rider';
  }

  return null;
}

export function PortalApp() {
  const {session,signOut}=useAuth();
  if(!session?.user?.id)return <Navigate to="/login" replace/>;
  return <CustomerPasscode key={session.user.id} userId={session.user.id} onLogout={signOut}>{lock=><PortalContent onPrivacyLock={lock}/>}</CustomerPasscode>;
}

function PortalContent({onPrivacyLock}:{onPrivacyLock:()=>void}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {session:portalSession}=useAuth();
  const sectionOwner=portalSession?.user.id||'';

  const [profile, setProfile] =
    useState<any>(null);

  const [wallet, setWallet] =
    useState<any>(null);

  const [loading, setLoading] =
    useState(true);

  const [portalError, setPortalError] =
    useState('');

  const [activeSection, setActiveSection] =
    useState<PortalSection>(()=>{try{const saved=sessionStorage.getItem(`matmove:portal-section:v1:${sectionOwner}`);return ['home','ride','wallet','trips','shop','inventory','account'].includes(saved||'')?saved as PortalSection:'home';}catch{return 'home';}});
  const [guideReplay,setGuideReplay]=useState(0);
  useEffect(()=>{if(!sectionOwner||profile?.id!==sectionOwner)return;const sections=['home','ride','wallet','trips','account',...(profile.role==='rider'?['shop']:profile.role==='merchant'?['inventory']:[])];if(!sections.includes(activeSection)){setActiveSection('home');return;}try{sessionStorage.setItem(`matmove:portal-section:v1:${sectionOwner}`,activeSection);}catch{}},[sectionOwner,profile?.id,profile?.role,activeSection]);

  const [loggingOut, setLoggingOut] =
    useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      localStorage.removeItem(
        'matmove_last_active'
      );

      const { error } =
        await supabase.auth.signOut();

      if (error) throw error;

      navigate('/login', {
        replace: true,
      });
    } catch (err: any) {
      alert(
        err?.message ||
        'Unable to sign out.'
      );
    } finally {
      setLoggingOut(false);
    }
  };

  const fetchUserData =
    useCallback(async () => {
      try {
        setPortalError('');
        setLoading(true);

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
      } catch (err: any) {
        setPortalError(err.message);
      } finally {
        setLoading(false);
      }
    }, [location.pathname]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) return;
    let active = true;
    const refresh = async () => {
      const {data, error} = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (active && !error && data) setProfile((old: any) => old?.id === userId ? {...old, ...data} : old);
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
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p role="status">Loading your portal…</p>
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

  const role =
    profile?.role as CustomerRole;

  const guide=<PortalGuide key={`${profile.id}:${role}`} userId={profile.id} role={role} verified={profile.kyc_status==='approved'} replay={guideReplay} onNavigate={setActiveSection} onVerify={()=>{if(profile.kyc_status==='approved')return;sessionStorage.setItem('ob_role',role);navigate('/onboarding/personal?resume=1');}}/>;
  const openHelpDestination=(destination:string)=>setActiveSection(customerHelpSection(destination,role));
  const accountHeader=<header className="border-b border-slate-200 bg-white px-3 pt-[env(safe-area-inset-top)]"><div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-2 py-2"><div className="flex shrink-0 items-center gap-2"><button type="button" aria-label="Replay Quick guide" onClick={()=>setGuideReplay(n=>n+1)} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border px-2 text-sm font-bold text-emerald-800"><span aria-hidden="true" className="sm:hidden">?</span><span className="hidden sm:inline">Quick guide</span></button><MatMoveHelp key={`help:${profile.id}:${role}`} userId={profile.id} context={{role}} onNavigate={openHelpDestination}/><NotificationBell key={`notifications:${profile.id}:${role}`} userId={profile.id} onNavigate={openHelpDestination}/></div><button type="button" aria-label="Open your account" aria-current={activeSection==='account'?'page':undefined} onClick={()=>setActiveSection('account')} className="flex min-h-11 min-w-0 max-w-[48%] items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"><AccountIdentity key={profile.id} userId={profile.id} fallbackName={profile.full_name?.trim() || profile.email || 'Complete your profile'}/></button></div></header>;

  if (
    activeSection === 'account'
  ) {
    return (
      <>{guide}
      <div className="portal-shell min-h-screen bg-slate-50 pb-28">
        {accountHeader}
        <AccountSection
          profile={profile}
          wallet={wallet}
          loggingOut={loggingOut}
          onLogout={handleLogout}
          onLock={onPrivacyLock}
          onBack={() =>
            setActiveSection('home')
          }
        />

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
      <div className="mx-auto max-w-6xl px-4"><KycStatusNotice profile={profile} onVerify={() => { sessionStorage.setItem('ob_role', role); navigate('/onboarding/personal?resume=1'); }}/></div>
      {activeSection === 'home' && <PortalHome key={`${profile.id}:${role}`} profile={profile} onNavigate={setActiveSection} />}
      {activeSection !== 'home' && role === 'rider' && (
        <RiderDashboard
          profile={profile}
          wallet={wallet}
          activeSection={activeSection === 'ride' ? 'home' : activeSection}
        />
      )}

      {activeSection !== 'home' && role === 'driver' && (
        <DriverDashboard
          profile={profile}
          wallet={wallet}
          activeSection={activeSection === 'ride' ? 'home' : activeSection}
        />
      )}

      {activeSection !== 'home' && role === 'merchant' && (
        <MerchantDashboard
          profile={profile}
          wallet={wallet}
          activeSection={activeSection === 'ride' ? 'home' : activeSection}
        />
      )}

      <PortalNavigation
        activeSection={activeSection}
        onNavigate={setActiveSection}
        role={role}
      />
    </div>
    </>
  );
}

function KycStatusNotice({profile, onVerify}: {profile: any; onVerify: () => void}) {
  if (!profile || profile.kyc_status === 'approved') return null;
  const rejected = ['rejected','declined','resubmission_required'].includes(profile.kyc_status);
  const pending = profile.role !== 'rider' && ['submitted','pending','under_review'].includes(profile.kyc_status);
  return <section role="status" className={`my-4 rounded-2xl border p-4 ${rejected ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
    <h2 className="font-bold">{rejected ? profile.kyc_status === 'resubmission_required' ? 'Verification update required' : 'Verification rejected' : pending ? 'Approval pending' : 'Verify your identity'}</h2>
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
}: any) {
  const navigate = useNavigate();
  const resumeVerification = () => { if (profile.kyc_status === 'approved') return; sessionStorage.setItem('ob_role', profile.role); navigate('/onboarding/personal?resume=1'); };
  const [viewingGames, setViewingGames] = useState(false);
  const [
    showDeleteConfirm,
    setShowDeleteConfirm,
  ] = useState(false);

  const [deletePin, setDeletePin] =
    useState('');

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
  ] = useState<any>({
    primaryMetric: 0,
    completed: 0,
    pending: 0,
    totalCount: 0,
  });

  const [cartItems, setCartItems] =
    useState<any[]>([]);

  const [riderOrders, setRiderOrders] =
    useState<any[]>([]);

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

  const fetchCartAndOrders = async () => {
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
  };

  const fetchAnalytics = async () => {
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

        data.forEach((o: any) => {
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

        data.forEach((b: any) => {
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
        (o: any) => {
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
        (b: any) => {
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
  };

  useEffect(() => {
    if (
      profile.role === 'rider'
    ) {
      fetchCartAndOrders();
    }

    if (viewingAnalytics && !['rider', 'driver', 'merchant'].includes(profile.role)) {
      fetchAnalytics();
    }
  }, [
    profile.id,
    analyticsTimeframe,
    viewingAnalytics,
    viewingCartOrders,
  ]);

  const deletionBusy = useRef(false);
  const handleDeleteAccount = async () => {
    if(deletionBusy.current)return;deletionBusy.current=true;
    try{
      const receipt=await customerPasscode(profile.id,'verify',deletePin);
      setDeletePin('');
      if(!receipt.ok||receipt.digits!==6||receipt.code!=='verified')throw Error(receipt.code==='cooldown'?`Try again in ${receipt.retryAfterSeconds} seconds.`:'Incorrect passcode.');
      window.location.href=`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello MatMove Support, I am requesting account deletion for ${profile.email} (${profile.phone||''}). Please assist me with final settlement.`)}`;
    }catch(e){setDeletePin('');alert(e instanceof Error?e.message:'Passcode check failed.');}
    finally{deletionBusy.current=false;}
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
  const merchantChoices = [...new Set(cartItems.map((item: any) => String(item.product?.merchant_id || '')).filter(Boolean))];
  const selectedMerchant = merchantChoices.includes(checkoutMerchant) ? checkoutMerchant : merchantChoices[0];
  const checkoutItems = cartItems.filter((item: any) => item.product?.merchant_id === selectedMerchant);
  const checkoutListingsReady = checkoutItems.length>0 && checkoutItems.every((item:any)=>catalogCheckoutAllowed(item.product));


  const filteredRiderOrders =
    riderOrders.filter(
      o =>
        orderFilter === 'all'
          ? true
          : o.status === orderFilter
    );

  if (viewingGames) {
    return <ArcadeGames key={profile.id} userId={profile.id} onBack={() => setViewingGames(false)} />;
  }

  if (viewingAnalytics && (profile.role === 'rider' || profile.role === 'driver')) {
    return <ActivityAnalytics role={profile.role} onBack={() => setViewingAnalytics(false)} />;
  }

  if (viewingAnalytics && profile.role === 'merchant') {
    return <MerchantAnalytics userId={profile.id} onBack={() => setViewingAnalytics(false)} />;
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
          onClick={() =>
            setViewingAnalytics(false)
          }
          className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5 flex items-center gap-2"
        >
          ← Back to Profile
        </button>

        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-slate-900">
            {title}
          </h1>

          <select
            value={analyticsTimeframe}
            onChange={(e: any) =>
              setAnalyticsTimeframe(
                e.target.value
              )
            }
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
          onClick={() =>
            setViewingCartOrders(false)
          }
          className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5 flex items-center gap-2"
        >
          ← Back to Profile
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
              {merchantChoices.map(id => <option key={id} value={id}>{cartItems.find((x: any) => x.product?.merchant_id === id)?.product?.merchant?.business_name || cartItems.find((x: any) => x.product?.merchant_id === id)?.product?.merchant?.full_name || `Merchant ${id.slice(0,8)}`}</option>)}
            </select>
          </label>}
          {!checkoutListingsReady&&checkoutItems.length>0&&<p role="alert" className="my-3 text-sm text-amber-900">Remove sold or unsupported-currency products before wallet checkout. No currency conversion is applied.</p>}
          <MerchantCheckout userId={profile.id} initialPhone={profile.phone || profile.phone_number || ''}
            items={checkoutListingsReady?checkoutItems.map((item: any) => ({productId:item.product.id,quantity:item.quantity || 1})):[]}
            onPaid={async payment => {
              const paidRows = cartItems.filter((row: any) => payment.items.some(item => {
                if (item.productId !== (row.product_id || row.product?.id)) return false;
                const rows = cartItems.filter((x: any) => (x.product_id || x.product?.id) === item.productId);
                return rows.reduce((sum: number, x: any) => sum + (x.quantity || 1), 0) === item.quantity;
              }));
              if (paidRows.length) {
                const result = await supabase.from('cart_items').delete().eq('rider_id', profile.id).in('id', paidRows.map((x: any) => x.id));
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
                        {new Date(
                          o.created_at
                        ).toLocaleString()}
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

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <button
        onClick={onBack}
        className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5"
      >
        ← Back to portal
      </button>

      <h1 className="text-3xl font-bold text-slate-900 mb-6">
        Account & Profile
      </h1>

      <div className="mb-5 flex justify-end"><button type="button" onClick={onLock} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold text-slate-700"><LockKeyhole size={18}/>Lock app</button></div>
      <KycStatusNotice profile={profile} onVerify={resumeVerification}/>
      <AccountProfile key={profile.id} userId={profile.id}/>
      <InviteEarn key={`referrals:${profile.id}`} userId={profile.id}/>
      <AccountPolicy />

      <button onClick={() => setViewingGames(true)} className="mb-6 w-full rounded-3xl border border-amber-300 bg-gradient-to-r from-purple-950 to-slate-950 p-6 text-left text-white">
        <h2 className="text-xl font-bold text-amber-300">Games — Spin & Win</h2>
        <p className="mt-2">Choose a fee · Six segments · One possible free bonus</p>
        <p className="mt-2 text-xs text-slate-300">18+ · Play responsibly · View rules and prize chances</p>
      </button>

      <button type="button" disabled={profile.kyc_status === 'approved'} onClick={resumeVerification} className="w-full text-left bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 mb-3 flex flex-wrap items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
          <UserCircle size={34} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">
            {profile.full_name?.trim() ||
              `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
              (profile.kyc_status === 'approved' ? 'Verified account' : 'Complete your profile')}
          </div>

          <div className="break-words text-sm text-slate-500">
            {profile.email}
            {' • '}
            {profile.phone || profile.phone_number || 'Phone not supplied'}
          </div>
        </div>
      <span className="ml-auto text-sm font-bold text-blue-700">{profile.kyc_status === 'approved' ? 'Verified · Locked' : 'Continue verification →'}</span></button>
      <p className="mb-6 text-sm text-slate-600">{profile.kyc_status === 'approved'
        ? 'Your verified identity is locked. Contact MatMove support if your details need correcting.'
        : 'Your account is registered. Continue verification to complete your identity details. Wallet access follows your verification and approval status.'}</p>

      <button
        onClick={() =>
          setViewingAnalytics(true)
        }
        className="w-full bg-white border border-slate-200 rounded-3xl p-6 mb-6 flex justify-between items-center hover:bg-slate-50 transition shadow-sm group"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <BarChart2 size={24} />
          </div>

          <div className="text-left">
            <h2 className="text-lg font-bold text-slate-900">
              {profile.role === 'merchant'
                ? 'Business Analytics'
                : profile.role === 'driver'
                  ? 'Driving Analytics'
                  : 'Rider Analytics'}
            </h2>

            <p className="text-sm text-slate-500 mt-0.5">
              View full performance breakdown,
              earnings & reports
            </p>
          </div>
        </div>

        <ArrowRight className="text-slate-400 group-hover:text-blue-600 transition" />
      </button>

      {profile.role === 'rider' && (
        <button
          onClick={() =>
            setViewingCartOrders(true)
          }
          className="w-full bg-white border border-slate-200 rounded-3xl p-6 mb-6 flex justify-between items-center hover:bg-slate-50 transition shadow-sm group"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform">
              <ShoppingCart size={24} />
            </div>

            <div className="text-left">
              <h2 className="text-lg font-bold text-slate-900">
                My Cart & Orders
              </h2>

              <p className="text-sm text-slate-500 mt-0.5">
                {cartItems.length} items in cart
                {' • '}
                {riderOrders.length} active orders
              </p>
            </div>
          </div>

          <ArrowRight className="text-slate-400 group-hover:text-blue-600 transition" />
        </button>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <MessageSquare
            className="text-emerald-600"
            size={20}
          />
          Customer Support
        </h2>

        <p className="text-sm text-slate-500 mb-4">
          Contact our team directly on WhatsApp
          for instant assistance.
        </p>

        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 bg-emerald-600 text-white font-bold px-5 py-3 rounded-xl hover:bg-emerald-700 transition"
        >
          <MessageSquare size={18} />
          Chat with Support (+232 90 330 362)
        </a>
      </div>

      <div className="bg-white border border-red-100 rounded-3xl p-6 mb-6">
        <h2 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2">
          <ShieldAlert size={20} />
          Danger Zone
        </h2>

        {!showDeleteConfirm ? (
          <button
            onClick={() =>
              setShowDeleteConfirm(true)
            }
            className="text-sm font-bold text-red-600 border border-red-200 bg-red-50 px-5 py-2.5 rounded-xl hover:bg-red-100"
          >
            Request Account Deletion
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 p-5 rounded-xl">
            <p className="text-sm text-red-800 font-bold mb-3">
              Enter your 6-digit Passcode
              to proceed:
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="password"
                maxLength={6}
                value={deletePin}
                onChange={e =>
                  setDeletePin(
                    e.target.value
                  )
                }
                className="w-24 text-center tracking-widest text-lg p-2 rounded-lg border border-red-300 outline-none bg-white"
              />

              <button
                onClick={handleDeleteAccount}
                className="bg-red-600 text-white font-bold px-4 rounded-lg"
              >
                Confirm
              </button>
            </div>

            <button
              onClick={() =>
                setShowDeleteConfirm(false)
              }
              className="text-xs font-bold text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <button
        onClick={onLogout}
        disabled={loggingOut}
        className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition flex items-center justify-center gap-2"
      >
        <LogOut size={18} />

        {loggingOut
          ? 'Signing out...'
          : 'Log out of MatMove'}
      </button>
    </div>
  );
}

function PortalNavigation({ activeSection, onNavigate, role }: any) {
  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'ride', label: role === 'driver' ? 'Radar' : 'Ride', icon: role === 'driver' ? Navigation : Car },
    ...(role === 'rider' ? [{ id: 'shop', label: 'Shop', icon: ShoppingBag }] : role === 'merchant' ? [{ id: 'inventory', label: 'Business', icon: Store }] : []),
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'trips', label: 'Trips', icon: Navigation },
  ];
  return <nav className="mm-portal-nav" aria-label="Main navigation">
    <div>{tabs.map(item => {
      const Icon = item.icon;
      const active = activeSection === item.id;
      return <button key={item.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}><Icon size={20}/><span>{item.label}</span></button>;
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
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
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
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/reset-password"
        element={<UpdatePassword />}
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
  );
}
