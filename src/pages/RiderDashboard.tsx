import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Car, Package, Truck, Navigation, MapPin, ShieldCheck, X, Wallet, Bell, Loader2, Lock, RefreshCw } from 'lucide-react';

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
  const [isProcessing, setIsProcessing] = useState(false);

  const vehicleOptions = [
    { id: 'car', name: 'MatMove Comfort', icon: Car, base: 15, perKm: 7 },
    { id: 'keke', name: 'Keke Tricycle', icon: Package, base: 10, perKm: 4 },
    { id: 'bike', name: 'Express Bike', icon: Navigation, base: 8, perKm: 3 },
    { id: 'truck', name: 'Haulage Truck', icon: Truck, base: 80, perKm: 20 },
  ];

  // Live Wallet Real-Time Listener
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel(`rider-wallet-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${profile.id}` }, 
        (payload) => {
          setLocalWallet(payload.new);
          alert('Vult Payment Processed! Wallet balance updated.');
        }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const refreshWallet = async () => {
    setIsRefreshing(true);
    try {
      const { data: wData } = await supabase.from('wallets').select('*').eq('user_id', profile.id).single();
      if (wData) setLocalWallet(wData);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!pickup || !destination) { setFareEstimate(null); return; }
    const activeVehicle = vehicleOptions.find((v) => v.id === selectedVehicle);
    setFareEstimate(Math.round((activeVehicle?.base || 15) + 6.5 * (activeVehicle?.perKm || 7)));
  }, [pickup, destination, selectedVehicle]);

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase.channel(`booking-${activeBooking.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => setActiveBooking(payload.new)
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBooking]);

  const requestTrip = async () => {
    if (!pickup || !destination || !fareEstimate) return alert('Enter pickup and destination.');
    if (Number(localWallet?.balance || 0) < fareEstimate) return alert(`Insufficient funds. Please top up your wallet.`);

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
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  // Cryptographic Vult Checkout Request
  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-vult-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: topUpAmount,
          userId: profile.id,
          type: 'in-app'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gateway initialization failed');

      setIsProcessing(false);
      setIsTopUpModalOpen(false);

      if (data.link) {
        window.location.href = data.link;
      } else {
        alert('Payment link generation failed.');
      }
    } catch (err: any) {
      alert(err.message || 'Payment failed');
      setIsProcessing(false);
    }
  };

  const firstName = profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search rides, destinations..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-600" />
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
            <button onClick={refreshWallet} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
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

      {/* Vult Top-Up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full relative shadow-2xl">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                <ShieldCheck size={32} />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center">Top Up via Vult</h2>
            <p className="text-sm text-slate-500 text-center mb-6">Enter the amount of SLE you want to load into your rider wallet.</p>

            <input type="number" placeholder="Amount (SLE)" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 focus:ring-2 focus:ring-indigo-500 outline-none" />
            
            <button onClick={executeTopUp} disabled={isProcessing || !topUpAmount} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />} Proceed to Vult Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}