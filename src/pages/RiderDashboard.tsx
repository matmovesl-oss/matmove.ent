import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Car, Package, Truck, Navigation, MapPin, ShieldCheck, CreditCard, Smartphone, X, Wallet, Bell, Loader2 } from 'lucide-react';

type VehicleType = 'car' | 'keke' | 'bike' | 'truck';

export function RiderDashboard({ profile, wallet, onOpenTopUp }: any) {
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>('car');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);

  // Booking States
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Top-up States
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [provider, setProvider] = useState<'orange' | 'africell' | 'flot' | 'vult'>('orange');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const vehicleOptions = [
    { id: 'car', name: 'MatMove Comfort', icon: Car, base: 15, perKm: 7 },
    { id: 'keke', name: 'Keke Tricycle', icon: Package, base: 10, perKm: 4 },
    { id: 'bike', name: 'Express Bike', icon: Navigation, base: 8, perKm: 3 },
    { id: 'truck', name: 'Haulage Truck', icon: Truck, base: 80, perKm: 20 },
  ];

  // Calculate Fare
  useEffect(() => {
    if (!pickup || !destination) {
      setFareEstimate(null);
      return;
    }
    const activeVehicle = vehicleOptions.find((v) => v.id === selectedVehicle);
    const simulatedDistanceKm = 6.5; // In production, replace with Google Maps Distance Matrix API
    const calculated = (activeVehicle?.base || 15) + simulatedDistanceKm * (activeVehicle?.perKm || 7);
    setFareEstimate(Math.round(calculated));
  }, [pickup, destination, selectedVehicle]);

  // Listen for Driver Acceptance via Supabase WebSockets
  useEffect(() => {
    if (!activeBooking) return;

    const channel = supabase
      .channel(`booking-${activeBooking.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => {
          setActiveBooking(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeBooking]);

  const requestTrip = async () => {
    if (!pickup || !destination || !fareEstimate) return alert('Please enter pickup and destination.');
    if (Number(wallet?.balance || 0) < fareEstimate) {
      return alert(`Insufficient funds. Please top up your wallet by at least SLE ${fareEstimate - Number(wallet?.balance)}.`);
    }

    setIsRequesting(true);
    try {
      // Write the trip request to the live database
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          rider_id: profile.id,
          service_type: selectedVehicle,
          pickup_location: pickup,
          destination_location: destination,
          fare_amount: fareEstimate,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to request trip.');
    } finally {
      setIsRequesting(false);
    }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try {
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id);
      setActiveBooking(null);
    } catch (err) {
      console.error('Failed to cancel trip', err);
    }
  };

  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const currentBalance = Number(wallet?.balance || 0);
      const newBalance = currentBalance + Number(topUpAmount);

      const { error } = await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', profile.id);
      if (error) throw error;

      alert(`Success! SLE ${topUpAmount} added to your wallet via ${provider.toUpperCase()}.`);
      setIsTopUpModalOpen(false);
      window.location.reload(); 
    } catch (err: any) {
      alert(err.message || 'Failed to update wallet balance.');
    } finally {
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
            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Available Rider Wallet</span>
              <div className="text-4xl font-bold mt-1">SLE {Number(wallet?.balance || 0).toLocaleString()}</div>
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm"><Wallet size={36} className="text-white" /></div>
          </div>
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={32} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Journeys</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with GPS journey tracking.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          {/* Active Booking State View */}
          {activeBooking ? (
            <div className="col-span-1 space-y-6 flex flex-col items-center justify-center text-center py-8">
              {activeBooking.status === 'pending' && (
                <>
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-2 animate-pulse">
                    <Loader2 size={32} className="animate-spin" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xl">Finding your driver...</h3>
                  <p className="text-sm text-slate-500">Broadcasting to nearby vehicles on the MatMove network.</p>
                  <button onClick={cancelTrip} className="mt-4 text-sm font-bold text-red-600 hover:text-red-700 hover:underline">Cancel Request</button>
                </>
              )}
              {activeBooking.status === 'accepted' && (
                <>
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-2">
                    <Car size={32} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xl">Driver is on the way!</h3>
                  <p className="text-sm text-slate-500">Your driver has accepted the request and is heading to {activeBooking.pickup_location}.</p>
                </>
              )}
              {activeBooking.status === 'completed' && (
                <>
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mb-2">
                    <ShieldCheck size={32} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xl">Trip Completed</h3>
                  <p className="text-sm text-slate-500">Your fare of SLE {activeBooking.fare_amount} has been deducted.</p>
                  <button onClick={() => { setActiveBooking(null); setPickup(''); setDestination(''); }} className="mt-6 w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700">Book another ride</button>
                </>
              )}
            </div>
          ) : (
            /* Standard Request Form */
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
                {isRequesting ? 'Connecting...' : `Confirm ${vehicleOptions.find((v) => v.id === selectedVehicle)?.name} Request`}
              </button>
            </div>
          )}

          <div className="col-span-2 bg-slate-100 rounded-2xl relative overflow-hidden border border-slate-200 min-h-[380px] flex items-center justify-center">
            <iframe title="Sierra Leone Map" width="100%" height="100%" className="absolute inset-0 border-0" src="https://maps.google.com/maps?q=Freetown,Sierra%20Leone&t=&z=13&ie=UTF8&iwloc=&output=embed" />
          </div>
        </div>
      </div>

      {/* Wallet Top-Up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full"><X size={20} /></button>
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Top-Up MatMove Wallet</h2>
            <p className="text-xs text-slate-500 mb-6">Select your payment merchant partner to load funds.</p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'orange', name: 'Orange Money', icon: Smartphone, color: 'text-orange-600', bg: 'bg-orange-50' },
                  { id: 'africell', name: 'Afrimoney', icon: Smartphone, color: 'text-purple-600', bg: 'bg-purple-50' },
                  { id: 'flot', name: 'Flot Pay', icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { id: 'vult', name: 'Vult Pay', icon: ShieldCheck, color: 'text-indigo-600', bg: 'bg-indigo-50' },
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
                <label className="block text-xs font-bold text-slate-700 uppercase mt-4 mb-1">Amount (SLE)</label>
                <input type="number" min="1" placeholder="e.g. 200" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border border-slate-300 p-3 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-blue-600" />
              </div>

              <button type="button" onClick={executeTopUp} disabled={isProcessing} className="w-full bg-blue-600 text-white font-bold p-3.5 rounded-xl hover:bg-blue-700 transition mt-4 disabled:opacity-50">
                {isProcessing ? 'Processing Payment...' : `Pay via ${provider.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}