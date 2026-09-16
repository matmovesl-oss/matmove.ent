import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Car, Package, Truck, Navigation, MapPin, ShieldCheck, X, Wallet, Bell, Loader2, Lock, Smartphone, CreditCard, RefreshCw } from 'lucide-react';

type VehicleType = 'car' | 'keke' | 'bike' | 'truck';

export function RiderDashboard({ profile, wallet, onOpenTopUp }: any) {
  const [localWallet, setLocalWallet] = useState(wallet);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>('car');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);

  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [provider, setProvider] = useState<'mobile_money' | 'card' | 'flot' | 'vult'>('mobile_money');
  const [isProcessing, setIsProcessing] = useState(false);

  const vehicleOptions = [
    { id: 'car', name: 'MatMove Comfort', icon: Car, base: 15, perKm: 7 },
    { id: 'keke', name: 'Keke Tricycle', icon: Package, base: 10, perKm: 4 },
    { id: 'bike', name: 'Express Bike', icon: Navigation, base: 8, perKm: 3 },
    { id: 'truck', name: 'Haulage Truck', icon: Truck, base: 80, perKm: 20 },
  ];

  // ==========================================
  // PAYMENT RETURN VERIFICATION SEQUENCE
  // ==========================================
  useEffect(() => {
    if (!profile?.id) return;

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const loadedAmount = Number(params.get('amount'));
    const returnedUserId = params.get('user_id');

    if (paymentStatus === 'success' && loadedAmount > 0 && returnedUserId === profile.id) {
      const verifyAndCredit = async () => {
        try {
          // 1. Instantly wipe the URL clean so they can't refresh and cheat the system
          window.history.replaceState({}, document.title, window.location.pathname);

          // 2. Fetch the absolute latest balance directly from Supabase
          const { data: dbWallet, error: fetchErr } = await supabase
            .from('wallets')
            .select('balance')
            .eq('user_id', profile.id)
            .single();

          if (fetchErr) throw fetchErr;

          const newBalance = Number(dbWallet.balance || 0) + loadedAmount;

          // 3. Securely update the wallet with the new money
          const { error: updateErr } = await supabase
            .from('wallets')
            .update({ balance: newBalance })
            .eq('user_id', profile.id);

          if (updateErr) throw updateErr;

          // 4. Update the screen and notify the user
          setLocalWallet({ ...localWallet, balance: newBalance });
          alert(`Payment Successful! SLE ${loadedAmount} has been credited to your MatMove wallet.`);

        } catch (err: any) {
          console.error('Wallet credit failed:', err);
          alert('Payment received, but wallet sync failed. Please check with an Admin.');
        }
      };

      verifyAndCredit();
    }
  }, [profile?.id]);

  // Refresh Button Logic
  const refreshWallet = async () => {
    setIsRefreshing(true);
    try {
      const { data: wData } = await supabase.from('wallets').select('*').eq('user_id', profile.id).single();
      if (wData) setLocalWallet(wData);
    } catch (err) { console.error('Failed to refresh', err); } finally { setIsRefreshing(false); }
  };

  useEffect(() => {
    if (!pickup || !destination) { setFareEstimate(null); return; }
    const activeVehicle = vehicleOptions.find((v) => v.id === selectedVehicle);
    const calculated = (activeVehicle?.base || 15) + 6.5 * (activeVehicle?.perKm || 7);
    setFareEstimate(Math.round(calculated));
  }, [pickup, destination, selectedVehicle]);

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase.channel(`booking-${activeBooking.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => setActiveBooking(payload.new)
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBooking]);

  const requestTrip = async () => {
    if (!pickup || !destination || !fareEstimate) return alert('Please enter pickup and destination.');
    if (Number(localWallet?.balance || 0) < fareEstimate) {
      return alert(`Insufficient funds. Please top up your wallet by at least SLE ${fareEstimate - Number(localWallet?.balance)}.`);
    }

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
          rider_id: profile.id, service_type: selectedVehicle, pickup_location: pickup, destination_location: destination, fare_amount: fareEstimate, status: 'pending'
        }).select().single();
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert(err.message || 'Failed to request trip.'); } finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try {
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id);
      setActiveBooking(null);
    } catch (err) { console.error('Failed to cancel trip', err); }
  };

  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    
    try {
      // 1. Build the Secure Return URL with the user's ID and the Amount they requested
      const returnUrl = encodeURIComponent(`${window.location.origin}/customer/rider?payment=success&amount=${topUpAmount}&user_id=${profile.id}`);
      
      let checkoutUrl = '';

      // 2. SMART ROUTING ENGINE
      if (provider === 'mobile_money' || provider === 'card') {
        // MONNIFY: Replace 'YOUR_MONNIFY_LINK' with your actual Monnify checkout link
        // You can attach parameters based on how your Monnify checkout page reads them.
        checkoutUrl = `https://your_monnify_link.com/pay?amount=${topUpAmount}&ref=${profile.id}&redirect=${returnUrl}`;
        
      } else if (provider === 'flot') {
        // FLOT
        checkoutUrl = `https://pay.flotme.ai/matmove?amount=${topUpAmount}&reference=${profile.id}&return_url=${returnUrl}`;
        
      } else if (provider === 'vult') {
        // VULT
        checkoutUrl = `https://pay.vult.app/matmove?amount=${topUpAmount}&reference=${profile.id}&return_url=${returnUrl}`;
      }
      
      setIsProcessing(false);
      setIsTopUpModalOpen(false);

      // Redirect to the assigned Gateway
      window.location.href = checkoutUrl;
      
    } catch (err: any) {
      alert(err.message || 'Failed to initialize payment.');
      setIsProcessing(false);
    }
  };

  const firstName = profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search rides, destinations..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 outline-none" />
        </div>
        <div className="flex items-center gap-6">
          <button className="relative text-slate-400 hover:text-slate-600"><Bell size={20} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full uppercase">Rider</span>
            <span className="text-sm font-bold text-slate-800">{firstName}</span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Where to, {firstName}? 👋</h1>
            <p className="text-slate-500 mt-1">Book a ride or delivery across Sierra Leone</p>
          </div>
          <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-sm">+ Load Wallet</button>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-blue-700 rounded-3xl p-6 text-white relative overflow-hidden shadow-lg flex justify-between items-center">
            
            {/* Live Refresh Button */}
            <button 
              onClick={refreshWallet} 
              disabled={isRefreshing}
              className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>

            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Available Rider Wallet</span>
              <div className="text-4xl font-bold mt-1">SLE {Number(localWallet?.balance || 0).toLocaleString()}</div>
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12"><Wallet size={36} className="text-white" /></div>
          </div>
          
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={32} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Journeys</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with GPS journey tracking.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          {activeBooking ? (
            <div className="col-span-1 space-y-6 flex flex-col items-center justify-center text-center py-8">
              {activeBooking.status === 'pending' && (
                <>
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-2 animate-pulse">
                    <Loader2 size={32} className="animate-spin" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xl">Finding your driver...</h3>
                  <button onClick={cancelTrip} className="mt-4 text-sm font-bold text-red-600 hover:text-red-700 hover:underline">Cancel Request</button>
                </>
              )}
              {activeBooking.status === 'accepted' && (
                <>
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-2"><Car size={32} /></div>
                  <h3 className="font-bold text-slate-900 text-xl">Driver is on the way!</h3>
                </>
              )}
              {activeBooking.status === 'completed' && (
                <>
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mb-2"><ShieldCheck size={32} /></div>
                  <h3 className="font-bold text-slate-900 text-xl">Trip Completed</h3>
                  <p className="text-sm text-slate-500">Your fare of SLE {activeBooking.fare_amount} has been deducted.</p>
                  <button onClick={() => { setActiveBooking(null); setPickup(''); setDestination(''); refreshWallet(); }} className="mt-6 w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700">Book another ride</button>
                </>
              )}
            </div>
          ) : (
            <div className="col-span-1 space-y-4">
              <h3 className="font-bold text-slate-900 text-lg">Request a Trip</h3>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Pickup Location</label>
                <div className="flex items-center gap-2 border border-slate-300 rounded-xl p-3 mt-1">
                  <MapPin size={16} className="text-emerald-600 shrink-0" />
                  <input type="text" placeholder="e.g. Lumley Junction" value={pickup} onChange={(e) => setPickup(e.target.value)} className="w-full text-sm outline-none bg-transparent" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Destination</label>
                <div className="flex items-center gap-2 border border-slate-300 rounded-xl p-3 mt-1">
                  <Navigation size={16} className="text-blue-600 shrink-0" />
                  <input type="text" placeholder="e.g. Cotton Tree" value={destination} onChange={(e) => setDestination(e.target.value)} className="w-full text-sm outline-none bg-transparent" />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Select Vehicle Option</label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {vehicleOptions.map((v) => {
                    const Icon = v.icon;
                    return (
                      <button key={v.id} type="button" onClick={() => setSelectedVehicle(v.id as VehicleType)} className={`p-3 rounded-xl border text-left transition ${selectedVehicle === v.id ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300'}`}>
                        <Icon size={18} className={selectedVehicle === v.id ? 'text-blue-600' : 'text-slate-500'} />
                        <div className="font-bold text-xs text-slate-900 mt-1">{v.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {fareEstimate !== null && (
                <div className="p-4 bg-slate-900 text-white rounded-2xl flex justify-between items-center">
                  <div>
                    <span className="text-xs text-slate-400 block uppercase font-bold">Estimated Fare</span>
                    <span className="text-2xl font-bold text-emerald-400">SLE {fareEstimate.toLocaleString()}</span>
                  </div>
                </div>
              )}
              <button type="button" onClick={requestTrip} disabled={isRequesting} className="w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700 transition shadow-sm disabled:opacity-50">
                {isRequesting ? 'Connecting...' : `Confirm Request`}
              </button>
            </div>
          )}

          <div className="col-span-2 bg-slate-100 rounded-2xl relative overflow-hidden border border-slate-200 min-h-[380px] flex items-center justify-center">
            <iframe title="Sierra Leone Map" width="100%" height="100%" className="absolute inset-0 border-0" src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=13&ie=UTF8&iwloc=&output=embed" />
          </div>
        </div>
      </div>

      {/* Unified Secure Checkout Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 shadow-2xl relative">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"><X size={20} /></button>
            
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Secure Top-Up</h2>
            <p className="text-sm text-slate-500 mb-6">How would you like to load your wallet?</p>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'mobile_money', name: 'Mobile Money', icon: Smartphone, color: 'text-orange-600', bg: 'bg-orange-50' },
                  { id: 'card', name: 'Bank Card', icon: CreditCard, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { id: 'flot', name: 'Flot Wallet', icon: Wallet, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { id: 'vult', name: 'Vult Wallet', icon: ShieldCheck, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                ].map((p) => {
                  const ProviderIcon = p.icon;
                  return (
                    <button key={p.id} type="button" onClick={() => setProvider(p.id as any)} className={`p-3 border rounded-xl cursor-pointer transition flex items-center gap-3 ${provider === p.id ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className={`p-2 rounded-lg ${p.bg} ${p.color}`}><ProviderIcon size={18} /></div>
                      <span className="text-xs font-bold text-slate-900">{p.name}</span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Amount to Load (SLE)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">SLE</span>
                  <input type="number" min="1" placeholder="0.00" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border border-slate-300 py-4 pl-14 pr-4 rounded-xl text-2xl font-bold outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                </div>
              </div>

              <button type="button" onClick={executeTopUp} disabled={isProcessing || !topUpAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl hover:bg-slate-800 transition flex items-center justify-center gap-2 disabled:opacity-50">
                {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />}
                {isProcessing ? 'Securing Connection...' : provider === 'mobile_money' || provider === 'card' ? 'Pay securely via Monnify' : `Pay via ${provider === 'vult' ? 'VULT' : 'FLOT'}`}
              </button>
            </div>
            
            <div className="mt-6 text-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                <Lock size={12} /> Encrypted Gateway
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}