import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Wallet, RefreshCw, AlertCircle, ShieldCheck, X, Loader2, Lock, Plus, Minus, Package, Smartphone, CreditCard, ArrowUpRight, MapPin, Navigation, Car, CalendarClock } from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

const PRICING_RATES = {
  bike: { min: 10, perKm: 3 },
  keke: { min: 15, perKm: 5 },
  car: { min: 30, perKm: 10 },
  van: { min: 60, perKm: 20 },
  delivery: { min: 15, perKm: 4 }, 
};

export function MerchantDashboard({ profile }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [monimeId, setMonimeId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Request State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
  
  // Autocomplete State
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [activeInput, setActiveInput] = useState<'pickup' | 'destination' | null>(null);

  const [serviceType, setServiceType] = useState<ServiceType>('delivery');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [offerAmount, setOfferAmount] = useState<string>('');
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  
  const [isRequesting, setIsRequesting] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Modals...
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const isApproved = localProfile?.kyc_status === 'approved';

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(data.balance);
      if (data.accountId) setMonimeId(data.accountId);
    } catch (err) { console.error(err); } 
    finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-13.234, 8.484], // Freetown
      zoom: 12
    });
  }, []);

  // --- LIVE AUTOCOMPLETE LOGIC ---
  const searchPlaces = async (query: string, type: 'pickup' | 'destination') => {
    if (type === 'pickup') setPickup(query);
    else setDestination(query);

    if (query.length < 3) {
      if (type === 'pickup') setPickupSuggestions([]);
      else setDestinationSuggestions([]);
      return;
    }

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=sl&proximity=-13.234,8.484&autocomplete=true&limit=4`;
    
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (type === 'pickup') setPickupSuggestions(data.features || []);
      else setDestinationSuggestions(data.features || []);
    } catch (err) { console.error('Search error', err); }
  };

  const handleSelectPlace = (feature: any, type: 'pickup' | 'destination') => {
    const coords = feature.center as [number, number];
    const placeName = feature.place_name;

    if (type === 'pickup') {
      setPickup(placeName);
      setPickupCoords(coords);
      setPickupSuggestions([]);
      dropSinglePin(coords, '#10B981');
    } else {
      setDestination(placeName);
      setDestinationCoords(coords);
      setDestinationSuggestions([]);
      dropSinglePin(coords, '#3B82F6');
    }
    setActiveInput(null);
  };

  const dropSinglePin = (coords: [number, number], color: string) => {
    if (!map.current) return;
    if ((!pickupCoords || !destinationCoords)) {
      map.current.flyTo({ center: coords, zoom: 14 });
    }
  };

  // --- AUTO ROUTING ---
  useEffect(() => {
    if (pickupCoords && destinationCoords) {
      drawRoute(pickupCoords, destinationCoords);
    }
  }, [pickupCoords, destinationCoords]);

  const drawRoute = async (start: [number, number], end: [number, number]) => {
    if (!map.current) return;
    setIsRouting(true);
    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      
      markers.current.forEach(m => m.remove());
      markers.current = [];
      if (map.current.getSource('route')) {
        map.current.removeLayer('route');
        map.current.removeSource('route');
      }

      markers.current.push(new mapboxgl.Marker({ color: '#10B981' }).setLngLat(start).addTo(map.current));
      markers.current.push(new mapboxgl.Marker({ color: '#3B82F6' }).setLngLat(end).addTo(map.current));

      const dirRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&access_token=${token}`);
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

  useEffect(() => {
    if (!activeBooking) return;
    const channel = supabase.channel(`booking-${activeBooking.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${activeBooking.id}` }, 
        (payload) => setActiveBooking(payload.new)
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBooking]);

  const handleRequest = async () => {
    if (!pickupCoords || !destinationCoords) return alert('Please select pickup and destination from the dropdown suggestions.');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select time for scheduled request.');
    
    const amt = Number(offerAmount);
    if (serviceType !== 'scheduled') {
      if (!amt || amt <= 0) return alert('Enter a valid offer amount.');
      const typeKey = serviceType === 'ride' ? vehicleType : 'delivery';
      const minPrice = typeKey === 'delivery' ? PRICING_RATES.delivery.min : PRICING_RATES[typeKey as VehicleType].min;
      
      if (amt < minPrice) return alert(`Minimum fare for ${typeKey} is SLE ${minPrice}`);
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
        status: 'pending' // Broadcast directly to drivers
      }).select().single();
      
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert('Request failed: ' + err.message); } 
    finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  const businessName = localProfile?.business_name || localProfile?.full_name || 'Merchant';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col" onClick={() => setActiveInput(null)}>
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div>
            <h2 className="font-bold text-slate-900 leading-tight">{businessName}</h2>
            <span className="text-xs font-bold text-orange-600 uppercase">Merchant Portal</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition">
            + Load Wallet
          </button>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Merchant Balance</div>
            <div className="text-lg font-bold text-slate-900">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-6 flex-1 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 lg:col-span-2 bg-slate-900 rounded-3xl p-6 text-white relative shadow-lg flex justify-between items-center">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
              <div className="text-4xl font-bold mt-1 text-emerald-400">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              {monimeId && <div className="mt-2 text-xs text-slate-400 font-mono bg-white/10 px-2 py-1 rounded inline-block">Account ID: {monimeId}</div>}
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12 hidden sm:block"><Wallet size={36} className="text-white" /></div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Payout Access</h3>
              <p className="text-slate-500 text-xs mt-1">Withdraw store funds to Mobile Money.</p>
            </div>
            <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`w-full font-bold p-3 rounded-xl transition text-xs shadow-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>
              {isApproved ? 'Withdraw Funds' : 'Withdrawals Locked (Pending KYC)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dispatch Request Form */}
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit">
            <h3 className="font-bold text-lg">Dispatch Request</h3>
            <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
              <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
              <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
            </div>
            
            {!activeBooking ? (
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
                
                {/* AUTOCOMPLETE PICKUP */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'pickup' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                    <MapPin size={16} className="text-emerald-600 shrink-0" />
                    <input 
                      type="text" 
                      placeholder="Pickup Location" 
                      value={pickup} 
                      onChange={e => searchPlaces(e.target.value, 'pickup')}
                      onFocus={() => setActiveInput('pickup')}
                      className="w-full outline-none text-sm bg-transparent" 
                    />
                  </div>
                  {activeInput === 'pickup' && pickupSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
                      {pickupSuggestions.map((s, i) => (
                        <button key={i} onClick={() => handleSelectPlace(s, 'pickup')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          <div className="text-sm font-bold text-slate-900">{s.text}</div>
                          <div className="text-xs text-slate-500 truncate">{s.place_name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* AUTOCOMPLETE DESTINATION */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'destination' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                    <Navigation size={16} className="text-blue-600 shrink-0" />
                    <input 
                      type="text" 
                      placeholder="Destination Location" 
                      value={destination} 
                      onChange={e => searchPlaces(e.target.value, 'destination')}
                      onFocus={() => setActiveInput('destination')}
                      className="w-full outline-none text-sm bg-transparent" 
                    />
                  </div>
                  {activeInput === 'destination' && destinationSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
                      {destinationSuggestions.map((s, i) => (
                        <button key={i} onClick={() => handleSelectPlace(s, 'destination')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          <div className="text-sm font-bold text-slate-900">{s.text}</div>
                          <div className="text-xs text-slate-500 truncate">{s.place_name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center px-1">
                  <span className="text-xs text-slate-500 font-bold">{tripDistanceKm ? `Route: ${tripDistanceKm.toFixed(1)} km` : ''}</span>
                  {isRouting && <span className="text-xs font-bold text-blue-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Routing...</span>}
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
                <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 shadow-md">
                  {isRequesting ? <Loader2 className="animate-spin mx-auto" /> : `Broadcast Request`}
                </button>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="font-bold text-slate-900">{activeBooking.status.includes('pending') ? 'Broadcasting request...' : 'Driver Assigned'}</p>
                <button onClick={cancelTrip} className="text-xs text-red-500 font-bold mt-4">Cancel Request</button>
              </div>
            )}
          </div>
          
          {/* Map */}
          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[500px] border border-slate-200 shadow-inner">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>
      
      {/* Existing Modals ... */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Top Up Wallet</h2>
            <input type="number" placeholder="Amount (SLE)" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center my-6 focus:ring-2 focus:ring-blue-600 outline-none" />
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">Proceed to Checkout</button>
          </div>
        </div>
      )}
    </div>
  );
}