import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Power, MapPin, Navigation, Wallet, ShieldCheck, Radio, RefreshCw, AlertCircle, Loader2, Lock, X, Smartphone, CreditCard, ArrowUpRight } from 'lucide-react';

export function DriverDashboard({ profile, wallet, onOpenWithdraw }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [localWallet, setLocalWallet] = useState(wallet);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [maxRadius, setMaxRadius] = useState<number>(5);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);

  // Top-Up Modal State
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [fundingMethod, setFundingMethod] = useState<'momo' | 'card'>('momo');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Withdrawal Modal State
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const isApproved = localProfile?.kyc_status === 'approved';

  // Live Wallet Real-Time Listener
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel(`driver-wallet-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${profile.id}` }, 
        (payload) => {
          setLocalWallet(payload.new);
          alert('Payment Processed! Wallet balance updated.');
        }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const { data: wData } = await supabase.from('wallets').select('*').eq('user_id', profile.id).single();
      if (wData) setLocalWallet(wData);

      const { data: pData } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
      if (pData) setLocalProfile(pData);
    } catch (err) {
      console.error('Failed to refresh', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();

    const channel = supabase.channel('public:bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchInitialRequests(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile.id]);

  const handleAcceptBooking = async (bookingId: string) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    try {
      const { error } = await supabase.from('bookings').update({ status: 'accepted', driver_id: profile.id }).eq('id', bookingId);
      if (error) throw error;
    } catch (err: any) { alert('Failed to accept trip: ' + err.message); }
  };

  const handleCompleteBooking = async (booking: any) => {
    try {
      const { error: bookingError } = await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
      if (bookingError) throw bookingError;

      const currentBalance = Number(localWallet?.balance || 0);
      const newBalance = currentBalance + Number(booking.fare_amount);
      await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', profile.id);

      alert(`Trip completed! SLE ${booking.fare_amount} added to your wallet.`);
      refreshData();
    } catch (err: any) { alert('Failed to complete trip: ' + err.message); }
  };

  // Monime Secure Checkout Request
  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: topUpAmount,
          userId: profile.id,
          role: 'driver' // Dynamically route this specific user role
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gateway initialization failed');

      setIsProcessing(false);
      setIsTopUpModalOpen(false);

      if (data.link) {
        window.location.href = data.link;
      } else {
        alert('Could not generate checkout link. Please try again.');
      }
    } catch (err: any) {
      alert(err.message || 'Payment failed');
      setIsProcessing(false);
    }
  };

  // Vult Cashout Execution
  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter a valid withdrawal amount');
    if (amt > Number(localWallet?.balance || 0)) return alert('Insufficient wallet balance');
    if (!withdrawPhone.trim()) return alert('Enter a valid Mobile Money number');

    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-vult-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          userId: profile.id,
          destinationPhone: withdrawPhone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');

      alert(`Cashout of SLE ${amt} requested! Funds will be transferred to ${withdrawPhone}.`);
      setIsWithdrawing(false);
      setIsWithdrawModalOpen(false);
      refreshData();
    } catch (err: any) {
      alert(err.message || 'Cashout request failed');
      setIsWithdrawing(false);
    }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsOnline(!isOnline)} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2>
            <p className="text-xs text-slate-500">{isOnline ? 'Finding trip requests near you...' : 'Go online to start receiving trips'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition">
            + Load Wallet
          </button>
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
            <Radio size={14} className="text-blue-600" />
            <span className="text-xs font-bold text-slate-700">Radius:</span>
            <select value={maxRadius} onChange={(e) => setMaxRadius(Number(e.target.value))} className="bg-transparent text-xs font-bold text-blue-700 outline-none cursor-pointer">
              <option value={2}>2 km</option><option value={5}>5 km</option><option value={10}>10 km</option>
            </select>
          </div>
          <div className="text-right hidden sm:block ml-4">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Driver Earnings</div>
            <div className="text-lg font-bold text-slate-900">SLE {Number(localWallet?.balance || 0).toLocaleString()}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          {!isApproved && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
              <AlertCircle className="text-amber-500 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm">Account Under Review</h4>
                <p className="text-xs text-amber-700 mt-1">Withdrawals and live dispatch are restricted until an Admin approves your documents.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 relative">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl relative">
              <button onClick={refreshData} disabled={isRefreshing} className="absolute top-3 right-3 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 transition" title="Refresh Wallet Balance">
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
              <div className="text-slate-500 mb-1"><Wallet size={20} /></div>
              <div className="text-xl font-bold text-slate-900">SLE {Number(localWallet?.balance || 0).toFixed(2)}</div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Wallet Balance</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
              <div className="text-slate-500 mb-1"><Navigation size={20} /></div>
              <div className="text-xl font-bold text-slate-900">{activeRequests.filter(r => r.status === 'completed' && r.driver_id === profile.id).length}</div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Trips Finished</div>
            </div>
          </div>

          <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`w-full font-bold p-3.5 rounded-xl transition shadow-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>
            {isApproved ? 'Withdraw Earnings' : 'Withdrawals Locked (Pending KYC)'}
          </button>

          <div className="flex-1">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
              <MapPin size={18} className="text-blue-600" /> Dispatch Radar
            </h3>
            
            {!isOnline ? (
              <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48">
                <Power className="text-slate-400 mb-2" size={32} />
                <p className="text-sm font-bold text-slate-500">You are offline</p>
              </div>
            ) : activeRequests.filter(r => r.status !== 'completed').length === 0 ? (
              <div className="border-2 border-dashed border-emerald-200 bg-emerald-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48 animate-pulse">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                  <Power size={24} />
                </div>
                <p className="text-sm font-bold text-emerald-700">Listening for requests...</p>
                <p className="text-xs text-emerald-600 mt-1">Within {maxRadius} km radius</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeRequests.filter(r => r.status !== 'completed').map((b: any) => (
                  <div key={b.id} className={`p-4 border rounded-xl flex flex-col gap-3 shadow-sm ${b.status === 'accepted' ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
                    <div>
                      <span className="font-bold text-blue-700 uppercase text-xs bg-blue-100 px-2 py-0.5 rounded">{b.service_type || 'Ride'}</span>
                      <span className="text-sm font-bold text-slate-900 ml-3">SLE {b.fare_amount}</span>
                      <div className="text-xs text-slate-600 mt-2 flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5"><MapPin size={14} className="text-emerald-600" /> {b.pickup_location}</span>
                        <span className="flex items-center gap-1.5"><Navigation size={14} className="text-blue-600" /> {b.destination_location}</span>
                      </div>
                    </div>
                    {b.status === 'pending' && (
                      <button onClick={() => handleAcceptBooking(b.id)} className="w-full bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-emerald-700 transition">
                        Accept Trip
                      </button>
                    )}
                    {b.status === 'accepted' && b.driver_id === profile.id && (
                      <button onClick={() => handleCompleteBooking(b)} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-blue-700 transition">
                        Complete Trip & Collect Fare
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 bg-slate-200 relative min-h-[400px]">
          <iframe title="Driver Radar Map" width="100%" height="100%" className="absolute inset-0 border-0" src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=14&ie=UTF8&iwloc=&output=embed" />
        </div>
      </div>

      {/* Top-Up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Top Up Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Choose how you want to fund your MatMove driver wallet.</p>

            <div className="space-y-3 mb-6">
              <button type="button" onClick={() => setFundingMethod('momo')} className={`w-full p-4 rounded-2xl border-2 flex items-center gap-4 text-left transition ${fundingMethod === 'momo' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200'}`}>
                <div className="p-3 rounded-xl bg-blue-100 text-blue-600"><Smartphone size={22} /></div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">Mobile Money</div>
                  <div className="text-xs text-slate-500">Secure checkout via Monime</div>
                </div>
              </button>

              <button type="button" onClick={() => setFundingMethod('card')} className={`w-full p-4 rounded-2xl border-2 flex items-center gap-4 text-left transition ${fundingMethod === 'card' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200'}`}>
                <div className="p-3 rounded-xl bg-emerald-100 text-emerald-600"><CreditCard size={22} /></div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">Bank Card</div>
                  <div className="text-xs text-slate-500">Visa / Mastercard secure checkout</div>
                </div>
              </button>
            </div>

            <input type="number" placeholder="Amount (SLE)" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 focus:ring-2 focus:ring-blue-600 outline-none" />
            
            <button onClick={executeTopUp} disabled={isProcessing || !topUpAmount} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />} Proceed to Checkout
            </button>
          </div>
        </div>
      )}

      {/* Cashout Modal */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Driver Earnings</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer wallet funds to Mobile Money.</p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Withdrawal Amount (SLE)</label>
                <input type="number" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Mobile Money Phone Number</label>
                <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>

            <button onClick={executeWithdrawal} disabled={isWithdrawing || !withdrawAmount} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isWithdrawing ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Cashout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}