import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { RiderDashboard } from './RiderDashboard';
import { DriverDashboard } from './DriverDashboard';
import { MerchantDashboard } from './MerchantDashboard';
import { WalletPage } from './WalletPage';
import { UserCircle, LogOut, MessageSquare, ShieldAlert, Home, Wallet, Navigation, ShoppingBag, Store, LockKeyhole, Delete } from 'lucide-react';

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
        <AccountSection profile={profile} loggingOut={loggingOut} onLogout={handleLogout} onBack={() => setActiveSection('home')} />
        <PortalNavigation activeSection={activeSection} onNavigate={setActiveSection} role={role} />
      </div>
    );
  }

  if (activeSection === 'wallet') {
    return (
      <div className="relative min-h-screen bg-slate-50 pb-28">
        <WalletPage profile={profile} wallet={wallet} onClose={() => setActiveSection('home')} />
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

function AccountSection({ profile, loggingOut, onLogout, onBack }: any) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePin, setDeletePin] = useState('');

  const handleDeleteAccount = () => {
    if (deletePin !== profile.passcode) return alert("Incorrect Passcode");
    window.location.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hello MatMove Support, I am requesting account deletion for ${profile.email} (${profile.phone || ''}). Please assist me with final settlement.`)}`;
  };

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

      <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2"><MessageSquare size={20} className="text-emerald-600" /> Customer Support</h2>
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