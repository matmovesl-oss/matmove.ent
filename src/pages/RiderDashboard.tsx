import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, Package, MapPin, Navigation, ShieldCheck, Wallet, Loader2, Bell, RefreshCw, X, Map, Lock, ArrowUpRight, CalendarClock, Plus, Minus } from 'lucide-react';

type ServiceType = 'ride' | 'delivery' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

const PRICING_RATES = {
  bike: { min: 10, perKm: 3 },
  keke: { min: 15, perKm: 5 },
  car: { min: 30, perKm: 10 },
  van: { min: 60, perKm: 20 },
  delivery: { min: 15, perKm: 4 }, // Delivery base handling fee + distance
};

export function RiderDashboard({ profile }: any) {
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [monimeId, setMonimeId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Trip State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('ride');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [offerAmount, setOfferAmount] = useState<string>('');
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  
  const [isRouting, setIsRouting] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Modals
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(data.balance);
      if (data.accountId) setMonimeId(data.accountId);
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-13.234, 8.484],
      zoom: 12
    });
  }, []);

  const calculateAndSetPrice = (distanceKm: number, type: string) => {
    const rate = type === 'delivery' ? PRICING_RATES.delivery : PRICING_RATES[type as VehicleType];
    const rawPrice = rate.min + (distanceKm * rate.perKm);
    const suggestedPrice = Math.max(rate.min, Math.ceil(rawPrice / 5) * 5);
    setOfferAmount(suggestedPrice.toString());
  };

  useEffect(() => {
    if (tripDistanceKm !== null) calculateAndSetPrice(tripDistanceKm, serviceType === 'ride' ? vehicleType : 'delivery');
  }, [vehicleType, serviceType, tripDistanceKm]);

  const adjustOffer = (delta: number) => {
    setOfferAmount(prev => {
      const type = serviceType === 'ride' ? vehicleType : 'delivery';
      const minPrice = type === 'delivery' ? PRICING_RATES.delivery.min : PRICING_RATES[type as VehicleType].min;
      const current = Number(prev) || minPrice;
      const next = current + delta;
      return (next < minPrice ? minPrice : next).toString();
    });
  };

  const previewRoute = async () => {
    if (!pickup || !destination || !map.current) return alert('Enter both pickup and destination locations.');
    setIsRouting(true);
    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      const safePickup = encodeURIComponent(`${pickup}, Freetown, Sierra Leone`);
      const safeDestination = encodeURIComponent(`${destination}, Freetown, Sierra Leone`);

      const pRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${safePickup}.json?access_token=${token}&limit=1`);
      const pData = await pRes.json();
      const pCoords = pData.features?.[0]?.center;
      
      const dRes = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${safeDestination}.json?access_token=${token}&limit=1`);
      const dData = await dRes.json();
      const dCoords = dData.features?.[0]?.center;

      if (!pCoords || !dCoords) throw new Error('Could not find locations. Try adding a landmark.');

      markers.current.forEach(m => m.remove());
      markers.current = [];
      if (map.current.getSource('route')) {
        map.current.removeLayer('route');
        map.current.removeSource('route');
      }

      markers.current.push(new mapboxgl.Marker({ color: '#10B981' }).setLngLat(pCoords).addTo(map.current));
      markers.current.push(new mapboxgl.Marker({ color: '#3B82F6' }).setLngLat(dCoords).addTo(map.current));

      const dirRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${pCoords[0]},${pCoords[1]};${dCoords[0]},${dCoords[1]}?geometries=geojson&access_token=${token}`);
      const dirData = await dirRes.json();
      const route = dirData.routes?.[0];

      if (route) {
        const distKm = route.distance / 1000;
        setTripDistanceKm(distKm);
        calculateAndSetPrice(distKm, serviceType === 'ride' ? vehicleType : 'delivery');

        map.current.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } });
        map.current.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#2563EB', 'line-width': 4 }
        });
        const coordinates = route.geometry.coordinates;
        const bounds = coordinates.reduce((b: mapboxgl.LngLatBounds, c: [number, number]) => b.extend(c), new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
        map.current.fitBounds(bounds, { padding: 50 });
      }
    } catch (err: any) { alert('Routing Error: ' + err.message); } 
    finally { setIsRouting(false); }
  };

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase.channel(`booking-${activeBooking.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => setActiveBooking(payload.new)
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBooking]);

  const handleRequest = async () => {
    if (!pickup || !destination) return alert('Enter pickup and destination');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select a date and time for your scheduled ride.');
    
    const amt = Number(offerAmount);
    if (serviceType !== 'scheduled') {
      if (!amt || amt <= 0) return alert('Enter a valid offer amount.');
      const typeKey = serviceType === 'ride' ? vehicleType : 'delivery';
      const minPrice = typeKey === 'delivery' ? PRICING_RATES.delivery.min : PRICING_RATES[typeKey as VehicleType].min;
      
      if (amt < minPrice) {
        return alert(`Minimum fare for ${typeKey} is SLE ${minPrice}`);
      }
      if (liveBalance < amt) return alert('Insufficient funds. Please load your wallet.');
    }

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
        rider_id: profile.id,
        service_type: serviceType,
        vehicle_type: serviceType === 'ride' ? vehicleType : null,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: serviceType === 'scheduled' ? 0 : amt,
        scheduled_time: serviceType === 'scheduled' ? scheduledTime : null,
        status: 'pending' // Broadcasts directly to drivers
      }).select().single();
      
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert('Failed to request: ' + err.message); } 
    finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: topUpAmount, userId: profile.id, role: 'rider' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gateway initialization failed');
      setIsProcessing(false);
      setIsTopUpModalOpen(false);
      if (data.link) window.location.href = data.link;
      else alert('Could not generate checkout link.');
    } catch (err: any) { alert(err.message || 'Payment failed'); setIsProcessing(false); }
  };

  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter a valid withdrawal amount');
    if (amt > liveBalance) return alert('Insufficient wallet balance');
    if (!withdrawPhone.trim()) return alert('Enter a valid Mobile Money number');
    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-vult-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: withdrawPhone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
      alert(`Cashout of SLE ${amt} requested!`);
      setIsWithdrawing(false);
      setIsWithdrawModalOpen(false);
      fetchLiveBalance();
    } catch (err: any) { alert(err.message || 'Cashout request failed'); setIsWithdrawing(false); }
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
            <p className="text-slate-500 mt-1">Book a ride, schedule a pickup, or request delivery.</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-sm">+ Load Wallet</button>
            <button onClick={() => setIsWithdrawModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition shadow-sm">Withdraw</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 lg:col-span-2 bg-blue-700 rounded-3xl p-6 text-white relative overflow-hidden shadow-lg flex justify-between items-center">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Available Rider Wallet</span>
              <div className="text-4xl font-bold mt-1">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              {monimeId && <div className="mt-2 text-xs text-blue-200 font-mono bg-blue-800/50 px-2 py-1 rounded inline-block">Account ID: {monimeId}</div>}
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12 hidden sm:block"><Wallet size={36} className="text-white" /></div>
          </div>
          
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={32} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Journeys</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with live map tracking.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* REQUEST FORM */}
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4">
            <h3 className="font-bold text-lg">Request Service</h3>
            
            <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
              <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
              <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
            </div>

            {!activeBooking ? (
              <>
                <div className="space-y-3">
                  {serviceType === 'ride' && (
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {(['keke', 'bike', 'car', 'van'] as VehicleType[]).map(v => (
                        <button key={v} onClick={() => setVehicleType(v)} className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-600 ring-inset' : 'bg-slate-100 text-slate-500'}`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500 transition">
                    <MapPin size={16} className="text-emerald-600 shrink-0" />
                    <input type="text" placeholder="Pickup Location" value={pickup} onChange={e => setPickup(e.target.value)} className="w-full outline-none text-sm bg-transparent" />
                  </div>
                  <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500 transition">
                    <Navigation size={16} className="text-blue-600 shrink-0" />
                    <input type="text" placeholder="Destination" value={destination} onChange={e => setDestination(e.target.value)} className="w-full outline-none text-sm bg-transparent" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-bold">{tripDistanceKm ? `Distance: ${tripDistanceKm.toFixed(1)} km` : ''}</span>
                    <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                      {isRouting ? <Loader2 size={12} className="animate-spin"/> : <Map size={12} />} Preview Route
                    </button>
                  </div>

                  {serviceType !== 'scheduled' && (
                    <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 p-2 rounded-xl focus-within:border-blue-500 transition">
                      <span className="text-slate-500 font-bold text-sm px-2">SLE</span>
                      <input type="number" placeholder="Offer" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-center" />
                      <div className="flex gap-1">
                        <button onClick={() => adjustOffer(-5)} type="button" className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition"><Minus size={16}/></button>
                        <button onClick={() => adjustOffer(5)} type="button" className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition"><Plus size={16}/></button>
                      </div>
                    </div>
                  )}

                  {serviceType === 'scheduled' && (
                    <div className="flex items-center gap-2 border p-3 rounded-xl focus-within:border-blue-500 transition">
                      <CalendarClock size={16} className="text-emerald-600 shrink-0" />
                      <input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-full outline-none text-sm bg-transparent text-slate-700" />
                    </div>
                  )}
                </div>
                
                <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4">
                  {isRequesting ? <Loader2 className="animate-spin mx-auto" /> : `Confirm Request`}
                </button>
              </>
            ) : (
              <div className="text-center py-8 space-y-4">
                {activeBooking.status.includes('pending') && (
                  <>
                    <Loader2 className="animate-spin text-blue-600 mx-auto" size={32} />
                    <p className="font-bold text-slate-900">Broadcasting request to drivers...</p>
                    <button onClick={cancelTrip} className="text-red-500 text-sm font-bold hover:underline">Cancel Request</button>
                  </>
                )}
                {activeBooking.status === 'accepted' && (
                  <>
                    <Car size={32} className="text-emerald-600 mx-auto" />
                    <p className="font-bold text-slate-900">Driver is en route!</p>
                  </>
                )}
                {activeBooking.status === 'completed' && (
                  <>
                    <ShieldCheck size={32} className="text-emerald-600 mx-auto" />
                    <p className="font-bold text-slate-900">Trip Completed</p>
                    <button onClick={() => setActiveBooking(null)} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl mt-4">Book Another</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* MAPBOX CONTAINER */}
          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[400px] border border-slate-200 shadow-inner">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>

      {/* TOP UP MODAL */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Top Up Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Fund your rider wallet securely.</p>
            <input type="number" placeholder="Amount (SLE)" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 focus:ring-2 focus:ring-blue-600 outline-none" />
            <button onClick={executeTopUp} disabled={isProcessing || !topUpAmount} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />} Proceed to Checkout
            </button>
          </div>
        </div>
      )}

      {/* WITHDRAW MODAL */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Funds</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer balance to Mobile Money.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none" />
              <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none" />
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