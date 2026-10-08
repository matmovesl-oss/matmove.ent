import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage, SignupPage } from '@/pages/AuthPages';
import { ForgotPasswordPage } from '@/pages/PasswordPages';
import { UpdatePassword } from '@/pages/UpdatePassword';
import {
  RoleSelectionPage,
  PersonalInfoPage,
  IdentityPage,
  DocumentsPage,
  SelfiePage,
  VehicleSelectionPage,
  ReviewPage,
  SubmittedPage,
  VerificationPage,
} from '@/pages/OnboardingPages';
import { RiderDashboard } from '@/pages/RiderDashboard';
import { DriverDashboard } from '@/pages/DriverDashboard';
import { MerchantDashboard } from '@/pages/MerchantDashboard';
import { UserCircle, LogOut, MessageSquare, ShieldAlert, Home, Wallet, Navigation, ShoppingBag, Store, LockKeyhole, Delete, ShoppingCart, ArrowRight, Loader2, Trash2, BarChart2, MapPin, Phone, Clock } from 'lucide-react';

type PortalSection = 'home' | 'wallet' | 'trips' | 'shop' | 'inventory' | 'account';
type CustomerRole = 'rider' | 'driver' | 'merchant';

const IDLE_LOCK_MS = 1 * 60 * 1000; 
const IDLE_LOGOUT_MS = 30 * 60 * 1000;
const WHATSAPP_NUMBER = "23290330362";

function getRoleFromPath(pathname: string): CustomerRole | null {
  if (pathname.includes('/driver')) return 'driver';
  if (pathname.includes('/merchant')) return 'merchant';
  if (pathname.includes('/rider')) return 'rider';
  return null;
}

export function PortalApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const [pinStatus, setPinStatus] = useState<'checking' | 'create' | 'locked' | 'unlocked'>('checking');
  const [pinError, setPinError] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [portalError, setPortalError] = useState('');
  const [activeSection, setActiveSection] = useState<PortalSection>('home');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (location.search.includes('payment=')) {
      const cleanPath = location.pathname;
      localStorage.setItem('matmove_last_active', '0');
      window.history.replaceState({}, document.title, cleanPath);
      window.location.reload();
      return;
    }
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        localStorage.setItem('matmove_last_active', '0');
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [location]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (location.pathname.includes('/customer')) {
        e.preventDefault();
        navigate('/', { replace: true });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navigate, location.pathname]);

  useEffect(() => {
    const checkIdleState = () => {
      if (!profile) return;
      const backendPin = profile.passcode;
      const lastActive = parseInt(localStorage.getItem('matmove_last_active') || '0', 10);
      const now = Date.now();
      const idleTime = now - lastActive;

      if (!backendPin) { setPinStatus('create'); return; }
      if (lastActive === 0 || idleTime > IDLE_LOCK_MS) {
        if (lastActive > 0 && idleTime > IDLE_LOGOUT_MS) { handleLogout(); return; }
        setPinStatus('locked'); return;
      }
      setPinStatus('unlocked');
      localStorage.setItem('matmove_last_active', now.toString());
    };

    checkIdleState();
    const handleVisibility = () => { if (document.visibilityState === 'visible') checkIdleState(); };
    window.addEventListener('visibilitychange', handleVisibility);
    return () => window.removeEventListener('visibilitychange', handleVisibility);
  }, [profile, pinStatus]);

  const handleSetPin = async (newPin: string) => {
    try {
      const { error } = await supabase.from('profiles').update({ passcode: newPin }).eq('id', profile.id);
      if (error) throw error;
      localStorage.setItem('matmove_last_active', Date.now().toString());
      setProfile({ ...profile, passcode: newPin });
      setPinStatus('unlocked'); setPinError('');
    } catch (err) { setPinError('Failed to save passcode.'); }
  };

  const handleUnlockPin = (enteredPin: string) => {
    if (enteredPin === profile.passcode) {
      localStorage.setItem('matmove_last_active', Date.now().toString());
      setPinError(''); setPinStatus('unlocked');
    } else { setPinError('Incorrect passcode'); }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      localStorage.removeItem('matmove_last_active');
      await supabase.auth.signOut();
      navigate('/login', { replace: true });
    } catch (err: any) { alert(err?.message || 'Unable to sign out.'); } 
    finally { setLoggingOut(false); }
  };

  const fetchUserData = useCallback(async () => {
    try {
      setPortalError(''); setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('No active session.');

      const userId = session.user.id;
      const pathRole = getRoleFromPath(location.pathname);
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      
      const profileRole = profileData?.role ? String(profileData.role).toLowerCase() : '';
      let resolvedRole: CustomerRole | '' = (profileRole === 'rider' || profileRole === 'driver' || profileRole === 'merchant') ? (profileRole as CustomerRole) : (pathRole || '');

      if (!resolvedRole || profileRole === 'admin') throw new Error('Invalid account type.');

      const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', userId);
      const sleWallet = (walletData || []).find((item) => String(item.currency || '').toUpperCase() === 'SLE');

      setProfile({ ...profileData, id: userId, email: session.user.email, role: resolvedRole });
      setWallet({ ...(sleWallet || { balance: 0 }), wallets: walletData || [] });
    } catch (err: any) { setPortalError(err.message); } 
    finally { setLoading(false); }
  }, [location.pathname]);

  useEffect(() => { fetchUserData(); }, [fetchUserData]);

  if (pinStatus === 'checking' || loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (pinStatus !== 'unlocked') return <PasscodeScreen mode={pinStatus} onComplete={(pin: string) => pinStatus === 'create' ? handleSetPin(pin) : handleUnlockPin(pin)} error={pinError} onLogout={handleLogout} />;
  if (portalError) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="max-w-md w-full bg-white p-8 text-center rounded-3xl"><h2 className="text-xl font-bold text-red-600 mb-2">Error</h2><p>{portalError}</p></div></div>;

  const role = profile?.role as CustomerRole;

  if (activeSection === 'account') {
    return (
      <div className="min-h-screen bg-slate-50 pb-28">
        <AccountSection profile={profile} wallet={wallet} loggingOut={loggingOut} onLogout={handleLogout} onBack={() => setActiveSection('home')} />
        <PortalNavigation activeSection={activeSection} onNavigate={setActiveSection} role={role} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-slate-50 pb-24">
      {role === 'rider' && <RiderDashboard profile={profile} wallet={wallet} activeSection={activeSection} />}
      {role === 'driver' && <DriverDashboard profile={profile} wallet={wallet} activeSection={activeSection} />}
      {role === 'merchant' && <MerchantDashboard profile={profile} wallet={wallet} activeSection={activeSection} />}
      <PortalNavigation activeSection={activeSection} onNavigate={setActiveSection} role={role} />
    </div>
  );
}

function AccountSection({ profile, wallet, loggingOut, onLogout, onBack }: any) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePin, setDeletePin] = useState('');
  
  // 🔴 CART & ORDERS SYSTEM (Rider)
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [riderOrders, setRiderOrders] = useState<any[]>([]);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  
  // Rider "Click Through" Page States
  const [viewingCartOrders, setViewingCartOrders] = useState(false);
  const [cartOrderTab, setCartOrderTab] = useState<'cart'|'orders'>('cart');
  const [orderFilter, setOrderFilter] = useState<'all'|'pending'|'completed'>('all');
  
  // Cart Checkout Form States
  const [cartLocation, setCartLocation] = useState('');
  const [cartPhone, setCartPhone] = useState(profile?.phone || profile?.phone_number || '');

  // 🔴 MERCHANT ANALYTICS STATE
  const [timeframe, setTimeframe] = useState<'daily'|'weekly'|'monthly'>('daily');
  const [analytics, setAnalytics] = useState({ revenue: 0, completedOrders: 0, pendingOrders: 0 });

  const fetchCartAndOrders = async () => {
    if (profile.role !== 'rider') return;
    
    // Fetch Cart
    const { data: cartData } = await supabase.from('cart_items').select('*, product:product_id(*)').eq('rider_id', profile.id);
    if (cartData) setCartItems(Array.isArray(cartData) ? cartData : []);

    // Fetch Orders for the Rider
    const { data: orderData } = await supabase.from('app_orders').select('*, merchant:merchant_id(business_name, full_name)').eq('rider_id', profile.id).order('created_at', { ascending: false });
    if (orderData) setRiderOrders(Array.isArray(orderData) ? orderData : []);
  };

  const fetchMerchantAnalytics = async () => {
    if (profile.role !== 'merchant') return;
    
    const now = new Date();
    let timeLimit = new Date();
    if (timeframe === 'daily') timeLimit.setHours(0,0,0,0);
    if (timeframe === 'weekly') timeLimit.setDate(now.getDate() - 7);
    if (timeframe === 'monthly') timeLimit.setDate(1);

    const { data } = await supabase.from('app_orders')
      .select('*')
      .eq('merchant_id', profile.id)
      .gte('created_at', timeLimit.toISOString());

    if (data && Array.isArray(data)) {
      let rev = 0, comp = 0, pend = 0;
      data.forEach((o: any) => {
        if (o.status === 'completed') {
          rev += Number(o.price || 0);
          comp += 1;
        } else {
          pend += 1;
        }
      });
      setAnalytics({ revenue: rev, completedOrders: comp, pendingOrders: pend });
    }
  };

  useEffect(() => { 
    if (profile.role === 'rider') fetchCartAndOrders(); 
    if (profile.role === 'merchant') fetchMerchantAnalytics();
  }, [profile.id, timeframe, viewingCartOrders]);

  const handleDeleteAccount = () => {
    if (deletePin !== profile.passcode) return alert("Incorrect Passcode");
    window.location.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello MatMove Support, I am requesting account deletion for ${profile.email} (${profile.phone || ''}). Please assist me with final settlement.`)}`;
  };

  const handleRemoveFromCart = async (cartId: string) => {
    await supabase.from('cart_items').delete().eq('id', cartId);
    fetchCartAndOrders();
  };

  const handleCheckoutCart = async () => {
    if (cartItems.length === 0) return alert("Your cart is empty.");
    if (!cartLocation.trim()) return alert("Please enter your street address.");
    if (!cartPhone.trim()) return alert("Please enter your phone number.");

    setIsCheckingOut(true);
    try {
      // Create orders for each cart item WITHOUT deducting from the wallet instantly
      for (const item of cartItems) {
         await supabase.from('app_orders').insert({
            rider_id: profile.id,
            merchant_id: item.product.merchant_id,
            product_name: item.product.name,
            price: Number(item.product.price) * (item.quantity || 1),
            quantity: item.quantity || 1,
            delivery_location: `Freetown - ${cartLocation}`,
            customer_phone: cartPhone,
            status: 'pending'
         });
      }
      
      // Clear the cart
      await supabase.from('cart_items').delete().eq('rider_id', profile.id);
      alert('Orders successfully submitted to the merchants!');
      
      setCartLocation('');
      await fetchCartAndOrders();
      setCartOrderTab('orders'); // Auto-switch to the orders tab so they can see it
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const cartTotal = cartItems.reduce((sum, item) => sum + (Number(item.product?.price) * (item.quantity || 1)), 0);
  const filteredRiderOrders = riderOrders.filter(o => orderFilter === 'all' ? true : o.status === orderFilter);

  // 🔴 RIDER: CLICK-THROUGH NEW PAGE FOR CART & ORDERS
  if (viewingCartOrders && profile.role === 'rider') {
     return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
           <button onClick={() => setViewingCartOrders(false)} className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5 flex items-center gap-2">← Back to Account Profile</button>
           <h1 className="text-3xl font-bold text-slate-900 mb-6">Shop Activity</h1>

           <div className="flex bg-slate-200 p-1 rounded-xl mb-6 w-full sm:w-fit">
              <button onClick={() => setCartOrderTab('cart')} className={`flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition ${cartOrderTab==='cart'?'bg-white shadow-sm text-blue-600':'text-slate-600 hover:text-slate-900'}`}>My Cart ({cartItems.length})</button>
              <button onClick={() => setCartOrderTab('orders')} className={`flex-1 sm:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition ${cartOrderTab==='orders'?'bg-white shadow-sm text-blue-600':'text-slate-600 hover:text-slate-900'}`}>My Orders ({riderOrders.length})</button>
           </div>

           {cartOrderTab === 'cart' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                {cartItems.length === 0 ? (
                   <div className="text-center py-10 text-slate-500">
                      <ShoppingBag size={48} className="mx-auto mb-4 text-slate-300" />
                      <p>Your cart is empty.</p>
                   </div>
                ) : (
                   <div className="space-y-4">
                     {cartItems.map(item => (
                       <div key={item.id} className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                          <div>
                             <p className="font-bold text-slate-900">{item.product?.name}</p>
                             <p className="text-xs text-slate-500 mt-1">Merchant: {item.product?.merchant?.business_name || 'Verified Merchant'}</p>
                             <p className="text-xs text-slate-500 mt-0.5">Qty: {item.quantity || 1} • SLE {item.product?.price}</p>
                          </div>
                          <div className="flex items-center gap-4">
                             <p className="font-bold text-orange-600">SLE {Number(item.product?.price) * (item.quantity || 1)}</p>
                             <button onClick={() => handleRemoveFromCart(item.id)} className="text-red-500 p-2 bg-red-50 rounded-lg hover:bg-red-100 transition"><Trash2 size={16} /></button>
                          </div>
                       </div>
                     ))}
                     
                     <div className="pt-6 border-t border-slate-100 mt-6 space-y-4">
                        <h3 className="font-bold text-slate-900">Delivery Details</h3>
                        <div className="flex flex-col sm:flex-row gap-3">
                           <div className="flex-1 relative">
                              <MapPin size={18} className="absolute left-3 top-3.5 text-slate-400" />
                              <div className="absolute left-[36px] top-3.5 text-slate-500 text-sm font-bold border-r pr-2 border-slate-300">Freetown</div>
                              <input type="text" placeholder="Street Address" value={cartLocation} onChange={e=>setCartLocation(e.target.value)} className="w-full border p-3 pl-[110px] rounded-xl outline-none focus:border-blue-500 text-sm" />
                           </div>
                           <div className="sm:w-1/3 relative">
                              <Phone size={18} className="absolute left-3 top-3.5 text-slate-400" />
                              <input type="tel" placeholder="Phone Number" value={cartPhone} onChange={e=>setCartPhone(e.target.value)} className="w-full border p-3 pl-10 rounded-xl outline-none focus:border-blue-500 text-sm" />
                           </div>
                        </div>
                     </div>

                     <div className="pt-6 flex justify-between items-center">
                        <div>
                           <p className="text-sm text-slate-500 uppercase tracking-wider font-bold">Total Price</p>
                           <p className="text-2xl font-bold text-slate-900">SLE {cartTotal.toFixed(2)}</p>
                        </div>
                        <button onClick={handleCheckoutCart} disabled={isCheckingOut} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3.5 rounded-xl flex items-center gap-2 transition disabled:opacity-50 shadow-md">
                           {isCheckingOut ? <Loader2 className="animate-spin" size={18} /> : <>Submit Order <ArrowRight size={18} /></>}
                        </button>
                     </div>
                   </div>
                )}
              </div>
           )}

           {cartOrderTab === 'orders' && (
              <div className="space-y-4">
                 <div className="flex gap-2 mb-4 bg-white p-2 rounded-xl border border-slate-200 w-fit shadow-sm">
                    <button onClick={()=>setOrderFilter('all')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${orderFilter==='all'?'bg-blue-50 text-blue-700':'bg-white text-slate-500 hover:bg-slate-50'}`}>All</button>
                    <button onClick={()=>setOrderFilter('pending')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${orderFilter==='pending'?'bg-amber-50 text-amber-700':'bg-white text-slate-500 hover:bg-slate-50'}`}>Pending</button>
                    <button onClick={()=>setOrderFilter('completed')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${orderFilter==='completed'?'bg-emerald-50 text-emerald-700':'bg-white text-slate-500 hover:bg-slate-50'}`}>Completed</button>
                 </div>

                 {filteredRiderOrders.length === 0 ? <p className="text-center text-slate-500 py-10 bg-white rounded-3xl border border-slate-200">No orders found.</p> : (
                    <div className="space-y-4">
                       {filteredRiderOrders.map(o => (
                          <div key={o.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4 transition hover:shadow-md">
                             <div>
                                <div className="font-bold text-slate-900 text-lg flex items-center gap-2">
                                  {o.product_name} 
                                  <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 rounded-full font-bold">Qty: {o.quantity || 1}</span>
                                </div>
                                <div className="text-sm text-slate-500 mt-2 flex items-center gap-1.5"><Store size={14}/> {o.merchant?.business_name || o.merchant?.full_name || 'Store Merchant'}</div>
                                <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5"><Clock size={12}/> {new Date(o.created_at).toLocaleString()}</div>
                             </div>
                             <div className="text-left sm:text-right flex flex-col sm:items-end">
                                <div className="font-bold text-xl text-slate-900">SLE {Number(o.price).toFixed(2)}</div>
                                <span className={`mt-2 inline-block px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border ${o.status === 'completed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
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

  // 🔴 STANDARD ACCOUNT SECTION
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <button onClick={onBack} className="text-sm font-semibold text-slate-500 hover:text-blue-600 transition mb-5">← Back to portal</button>
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Account & Profile</h1>
      
      <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center"><UserCircle size={34} /></div>
        <div>
          <div className="text-xl font-bold">{profile.full_name || 'MatMove User'}</div>
          <div className="text-sm text-slate-500">{profile.email} • {profile.phone || 'No Phone'}</div>
        </div>
      </div>

      {/* 🔴 MERCHANT DASHBOARD WIDGET */}
      {profile.role === 'merchant' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
             <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><BarChart2 className="text-blue-600" size={20} /> Business Analytics</h2>
             <select value={timeframe} onChange={(e: any) => setTimeframe(e.target.value)} className="bg-slate-50 border border-slate-200 text-sm font-bold p-2 rounded-lg outline-none cursor-pointer text-slate-700">
               <option value="daily">Today</option>
               <option value="weekly">This Week</option>
               <option value="monthly">This Month</option>
             </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
             <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
               <p className="text-xs text-blue-600 font-bold uppercase tracking-wider mb-1">Total Revenue</p>
               <p className="text-2xl font-bold text-slate-900">SLE {analytics.revenue.toFixed(2)}</p>
             </div>
             <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
               <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-1">Completed Orders</p>
               <p className="text-2xl font-bold text-slate-900">{analytics.completedOrders}</p>
             </div>
             <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 col-span-2 md:col-span-1">
               <p className="text-xs text-amber-600 font-bold uppercase tracking-wider mb-1">Pending Orders</p>
               <p className="text-2xl font-bold text-slate-900">{analytics.pendingOrders}</p>
             </div>
          </div>
        </div>
      )}

      {/* 🔴 RIDER CART WIDGET - NOW A CLICK THROUGH BUTTON */}
      {profile.role === 'rider' && (
        <button onClick={() => setViewingCartOrders(true)} className="w-full bg-white border border-slate-200 rounded-3xl p-6 mb-6 flex justify-between items-center hover:bg-slate-50 transition shadow-sm group">
           <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:scale-105 transition-transform"><ShoppingCart size={24} /></div>
              <div className="text-left">
                 <h2 className="text-lg font-bold text-slate-900">My Cart & Orders</h2>
                 <p className="text-sm text-slate-500 mt-0.5">{cartItems.length} items in cart • {riderOrders.length} active orders</p>
              </div>
           </div>
           <ArrowRight className="text-slate-400 group-hover:text-blue-600 transition" />
        </button>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2"><MessageSquare className="text-emerald-600" size={20} /> Customer Support</h2>
        <p className="text-sm text-slate-500 mb-4">Contact our team directly on WhatsApp for instant assistance.</p>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 bg-emerald-600 text-white font-bold px-5 py-3 rounded-xl hover:bg-emerald-700 transition">
          <MessageSquare size={18} /> Chat with Support (+232 90 330 362)
        </a>
      </div>

      <div className="bg-white border border-red-100 rounded-3xl p-6 mb-6">
        <h2 className="text-lg font-bold text-red-600 mb-4 flex items-center gap-2"><ShieldAlert size={20} /> Danger Zone</h2>
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="text-sm font-bold text-red-600 border border-red-200 bg-red-50 px-5 py-2.5 rounded-xl hover:bg-red-100">Request Account Deletion</button>
        ) : (
          <div className="bg-red-50 border border-red-200 p-5 rounded-xl">
            <p className="text-sm text-red-800 font-bold mb-3">Enter your 4-digit Passcode to proceed:</p>
            <div className="flex gap-2 mb-4">
              <input type="password" maxLength={4} value={deletePin} onChange={e=>setDeletePin(e.target.value)} className="w-24 text-center tracking-widest text-lg p-2 rounded-lg border border-red-300 outline-none bg-white" />
              <button onClick={handleDeleteAccount} className="bg-red-600 text-white font-bold px-4 rounded-lg">Confirm</button>
            </div>
            <button onClick={() => setShowDeleteConfirm(false)} className="text-xs font-bold text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        )}
      </div>

      <button onClick={onLogout} disabled={loggingOut} className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition flex items-center justify-center gap-2">
        <LogOut size={18} /> {loggingOut ? 'Signing out...' : 'Log out of MatMove'}
      </button>
    </div>
  );
}

function PortalNavigation({ activeSection, onNavigate, role }: any) {
  const getTabs = () => {
    if (role === 'rider') return [{ id:'home', label:'Ride', icon: Home }, { id:'shop', label:'Shop', icon: ShoppingBag }, { id:'wallet', label:'Wallet', icon: Wallet }, { id:'trips', label:'Trips', icon: Navigation }, { id:'account', label:'Account', icon: UserCircle }];
    if (role === 'merchant') return [{ id:'home', label:'Home', icon: Home }, { id:'inventory', label:'Inventory', icon: Store }, { id:'wallet', label:'Wallet', icon: Wallet }, { id:'account', label:'Account', icon: UserCircle }];
    if (role === 'driver') return [{ id:'home', label:'Radar', icon: Home }, { id:'trips', label:'Trips', icon: Navigation }, { id:'wallet', label:'Wallet', icon: Wallet }, { id:'account', label:'Account', icon: UserCircle }];
    return [];
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] px-2 py-2 pb-safe">
      <div className="flex justify-around items-center max-w-lg mx-auto">
        {getTabs().map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)} className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-2xl transition ${active ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
              <Icon size={20} className={active ? "fill-blue-100/50" : ""} />
              <span className={`text-[10px] font-bold ${active ? 'text-blue-600' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function PasscodeScreen({ mode, onComplete, error, onLogout }: any) {
  const [pin, setPin] = useState('');
  const handlePress = (val: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + val;
    setPin(newPin);
    if (newPin.length === 4) { setTimeout(() => { onComplete(newPin); if (mode === 'locked') setPin(''); }, 250); }
  };
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white">
      <LockKeyhole size={48} className="text-blue-500 mb-6" />
      <h2 className="text-2xl font-bold mb-2">{mode === 'create' ? 'Create PIN' : 'Enter PIN'}</h2>
      <div className="flex gap-4 mb-8">{[...Array(4)].map((_, i) => <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-blue-500' : 'bg-slate-800'}`} />)}</div>
      {error && <p className="text-red-400 mb-4">{error}</p>}
      <div className="grid grid-cols-3 gap-4 max-w-[280px] w-full">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => <button key={num} onClick={() => handlePress(num.toString())} className="h-16 bg-slate-800 text-2xl rounded-2xl hover:bg-slate-700">{num}</button>)}
        <div /><button onClick={() => handlePress('0')} className="h-16 bg-slate-800 text-2xl rounded-2xl hover:bg-slate-700">0</button>
        <button onClick={() => setPin(pin.slice(0, -1))} className="h-16 bg-slate-800 flex items-center justify-center rounded-2xl hover:bg-slate-700"><Delete size={24} /></button>
      </div>
      {mode === 'locked' && <button onClick={onLogout} className="mt-12 text-slate-500 underline">Sign out</button>}
    </div>
  );
}

function CustomerPortal() {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) return <Navigate to="/" replace />;
  return <PortalApp />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<UpdatePassword />} /> 
      <Route path="/select-role" element={<RoleSelectionPage />} />
      <Route path="/onboarding/personal" element={<PersonalInfoPage />} />
      <Route path="/onboarding/identity" element={<IdentityPage />} />
      <Route path="/onboarding/documents" element={<DocumentsPage />} />
      <Route path="/onboarding/selfie" element={<SelfiePage />} />
      <Route path="/onboarding/vehicle" element={<VehicleSelectionPage />} />
      <Route path="/onboarding/review" element={<ReviewPage />} />
      <Route path="/onboarding/submitted" element={<SubmittedPage />} />
      <Route path="/verification" element={<VerificationPage />} />
      <Route path="/customer/*" element={<CustomerPortal />} />
      <Route path="/customer/rider/*" element={<CustomerPortal />} />
      <Route path="/customer/driver/*" element={<CustomerPortal />} />
      <Route path="/customer/merchant/*" element={<CustomerPortal />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}