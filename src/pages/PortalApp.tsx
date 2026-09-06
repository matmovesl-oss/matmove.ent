import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Wallet, Car, Package, Truck, Bus, Lock, Bell, ChevronDown, X, CheckCircle2, TrendingUp, Store, ShieldCheck } from 'lucide-react';

export function PortalApp() {
  const [profile, setProfile] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'topup' | 'withdraw'>('topup');
  const [amount, setAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchUserData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', session.user.id).single();

      if (profileData) setProfile(profileData);
      if (walletData) setWallet(walletData);
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, []);

  const handleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setSuccessMsg('');
    const numAmount = parseFloat(amount);

    try {
      const { error } = await supabase.rpc('process_wallet_transaction', {
        p_amount: numAmount,
        p_type: modalType,
        p_description: modalType === 'topup' ? 'Wallet Top-Up' : 'Withdrawal Request via Vult'
      });

      if (error) throw error;

      setSuccessMsg(
        modalType === 'topup'
          ? `Successfully added SLE ${numAmount} to your wallet!`
          : `Withdrawal request of SLE ${numAmount} processed!`
      );

      await fetchUserData();
      setAmount('');
      setTimeout(() => {
        setIsModalOpen(false);
        setSuccessMsg('');
      }, 3000);
      
    } catch (error: any) {
      console.error("Transaction error:", error);
      alert(error.message || "Transaction failed.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-500 font-medium">Loading MatMove portal...</div>;

  const role = (profile?.role || 'rider').toLowerCase();
  const isRider = role === 'rider' || role === 'client';
  const isDriver = role === 'driver';
  const isMerchant = role === 'merchant';
  const isPendingKYC = profile?.kyc_status === 'pending';

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  return (
    <div className="flex-1 bg-slate-50 h-screen overflow-y-auto relative">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search orders, transactions..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none"/>
        </div>
        <div className="flex items-center gap-6">
          <button className="relative text-slate-400 hover:text-slate-600">
            <Bell size={20} />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full"></span>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
              {getInitials(profile?.full_name)}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-slate-800 capitalize">{profile?.role || 'Rider'}</span>
              <ChevronDown size={16} className="text-slate-400" />
            </div>
          </div>
        </div>
      </header>

      {/* KYC Alert */}
      {isPendingKYC && (
        <div className="bg-amber-50 text-amber-800 p-3 flex justify-center items-center gap-2 text-sm font-semibold border-b border-amber-200">
          <Lock size={16} /> Account pending KYC verification. Production operations restricted until approved.
        </div>
      )}

      <div className="p-8 max-w-6xl mx-auto space-y-8 pb-24">
        {/* Header Title */}
        <div className="flex justify-between items-end">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            <h1 className="text-3xl font-bold text-slate-900">Good morning, {profile?.full_name?.split(' ')[0] || 'User'} ✨</h1>
            <p className="text-slate-500 mt-1">
              {isRider && "Where are you moving today?"}
              {isDriver && "Ready to start accepting trips today?"}
              {isMerchant && "Manage your business dispatch and orders."}
            </p>
          </div>
          {isRider && (
            <button className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-md hover:bg-blue-700 transition flex items-center gap-2">
              <Car size={18} /> Book a Service
            </button>
          )}
        </div>

        {/* Wallet & Main Cards */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-blue-700 rounded-2xl p-6 text-white flex flex-col justify-between relative overflow-hidden shadow-lg">
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Wallet Balance</span>
                  <div className="text-4xl font-bold mt-1">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
                </div>
                <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm">
                  <Wallet size={24} className="text-white" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => { setModalType('topup'); setIsModalOpen(true); }}
                  className="bg-white/20 hover:bg-white/30 transition px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 backdrop-blur-sm"
                >
                  Add money
                </button>
                {/* HIDE WITHDRAW FROM RIDERS */}
                {!isRider && (
                  <button 
                    onClick={() => { setModalType('withdraw'); setIsModalOpen(true); }}
                    className="bg-white/20 hover:bg-white/30 transition px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 backdrop-blur-sm"
                  >
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Role-Specific Right Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            {isRider && (
              <>
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-4"><ShieldCheck size={24} /></div>
                <h3 className="font-bold text-slate-900 text-lg">Safe Passenger Rides</h3>
                <p className="text-slate-500 text-sm mt-1">Tracked journeys with verified MatMove drivers.</p>
              </>
            )}
            {isDriver && (
              <>
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-4"><TrendingUp size={24} /></div>
                <h3 className="font-bold text-slate-900 text-lg">Driver Payouts</h3>
                <p className="text-slate-500 text-sm mt-1">Direct wallet withdrawals via Vult / Mobile Money.</p>
              </>
            )}
            {isMerchant && (
              <>
                <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600 mb-4"><Store size={24} /></div>
                <h3 className="font-bold text-slate-900 text-lg">Merchant Gateway</h3>
                <p className="text-slate-500 text-sm mt-1">Batch delivery dispatches and commercial billing.</p>
              </>
            )}
          </div>
        </div>

        {/* RIDER-ONLY SECTION */}
        {isRider && (
          <div>
            <h2 className="text-lg font-bold text-slate-900 mb-4">Book a Transportation Service</h2>
            <div className="grid grid-cols-4 gap-4">
              {[
                { name: 'Ride', desc: 'Passenger travel', icon: Car, color: 'text-blue-600', bg: 'bg-blue-50' },
                { name: 'Delivery', desc: 'Fast courier', icon: Package, color: 'text-orange-600', bg: 'bg-orange-50' },
                { name: 'Truck', desc: 'Heavy cargo', icon: Truck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { name: 'Bus', desc: 'Intercity travel', icon: Bus, color: 'text-indigo-600', bg: 'bg-indigo-50' }
              ].map((s, i) => (
                <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition cursor-pointer shadow-sm">
                  <div className={`w-10 h-10 ${s.bg} ${s.color} rounded-lg flex items-center justify-center mb-3`}><s.icon size={20} /></div>
                  <h3 className="font-bold text-slate-900">{s.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DRIVER-ONLY SECTION */}
        {isDriver && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Driver Dispatch Console</h2>
            <p className="text-sm text-slate-500 mb-4">You are currently visible to nearby passenger requests.</p>
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-medium text-sm flex justify-between items-center">
              <span>Status: Online & Ready</span>
              <button className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-xs">Toggle Offline</button>
            </div>
          </div>
        )}

        {/* MERCHANT-ONLY SECTION */}
        {isMerchant && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Merchant Logistics Dashboard</h2>
            <p className="text-sm text-slate-500 mb-4">Manage deliveries for your store and business orders.</p>
            <button className="bg-purple-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm">
              + Schedule Bulk Delivery
            </button>
          </div>
        )}
      </div>

      {/* Transaction Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition">
              <X size={20} />
            </button>
            
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {modalType === 'topup' ? 'Top-up Wallet' : 'Withdraw Funds'}
            </h2>

            {successMsg ? (
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
                <CheckCircle2 size={24} className="mt-0.5 shrink-0" />
                <p className="font-medium text-sm">{successMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleTransaction} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Amount (SLE)</label>
                  <input 
                    type="number" 
                    required 
                    min="1"
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                    className="w-full border border-slate-300 p-3 rounded-xl text-lg font-medium focus:ring-2 focus:ring-blue-600 outline-none" 
                    placeholder="e.g. 500"
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={processing}
                  className="w-full bg-blue-600 text-white p-3.5 rounded-xl font-bold mt-4 hover:bg-blue-700 transition disabled:opacity-70 flex justify-center"
                >
                  {processing ? 'Processing...' : modalType === 'topup' ? 'Confirm Top-up' : 'Request Withdrawal'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}