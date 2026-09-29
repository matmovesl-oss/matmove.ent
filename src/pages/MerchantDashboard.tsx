import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Plus, Package, RefreshCw, X, Loader2, MapPin, Navigation, Car, CalendarClock, Phone, Minus, Smartphone, ArrowDownLeft, ArrowRight } from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

export function MerchantDashboard({ profile, wallet, activeSection, onOpenWallet }: any) {
  if (activeSection === 'inventory') return <MerchantInventory profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pricingRates, setPricingRates] = useState<any>({ bike: { min: 15, perKm: 3 }, keke: { min: 20, perKm: 5 }, car: { min: 30, perKm: 8 }, van: { min: 50, perKm: 15 } });

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
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

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [isProcessingLoad, setIsProcessingLoad] = useState(false);

  const monimeAccountId = wallet?.metadata?.monime_account_id || 'Pending Setup';
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    supabase.from('pricing_settings').select('*').then(({ data }) => {
      if (data && data.length > 0) {
        const rates: any = {};
        data.forEach(r => rates[r.vehicle_type] = { min: Number(r.min_fare), perKm: Number(r.per_km_rate) });
        setPricingRates(rates);
      }
    });
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    const checkActiveTrip = async () => {
      const { data } = await supabase.from('bookings').select('*, driver:driver_id(full_name, phone)').eq('rider_id', profile.id).in('status', ['pending', 'pending_admin', 'accepted', 'in_progress']).order('created_at', { ascending: false }).limit(1).single();
      if (data) setActiveBooking(data); else { setActiveBooking(null); setPickup(''); setDestination(''); }
    };
    checkActiveTrip();
    const channel = supabase.channel('merchant-active-booking').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `rider_id=eq.${profile.id}` }, checkActiveTrip).subscribe();
    const syncInterval = setInterval(checkActiveTrip, 3000);
    return () => { supabase.removeChannel(channel); clearInterval(syncInterval); };
  }, [profile?.id]);

  useEffect(() => {
    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/get-live-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: profile.id }) });
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(Number(data.balance));
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    try {
      mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
      map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-13.234, 8.484], zoom: 12 });
    } catch (e) { console.error(e); }
  }, []);

  const searchPlaces = (query: string, type: 'pickup' | 'destination') => {
    if (type === 'pickup') { setPickup(query); setPickupCoords(null); } else { setDestination(query); setDestinationCoords(null); }
    if (query.trim().length < 3) { type === 'pickup' ? setPickupSuggestions([]) : setDestinationSuggestions([]); return; }
    // @ts-ignore
    const autocomplete = new window.google.maps.places.AutocompleteService();
    autocomplete.getPlacePredictions({ input: query, componentRestrictions: { country: 'sl' } }, (predictions: any, status: any) => {
      // @ts-ignore
      if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
        if (type === 'pickup') setPickupSuggestions(predictions); else setDestinationSuggestions(predictions);
      }
    });
  };

  const handleSelectPlace = (placeId: string, description: string, type: 'pickup' | 'destination') => {
    // @ts-ignore
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ placeId }, (results: any, status: any) => {
      if (status === 'OK' && results[0]) {
        const coords: [number, number] = [results[0].geometry.location.lng(), results[0].geometry.location.lat()];
        if (type === 'pickup') { setPickup(description); setPickupCoords(coords); setPickupSuggestions([]); } 
        else { setDestination(description); setDestinationCoords(coords); setDestinationSuggestions([]); }
        if (map.current) map.current.flyTo({ center: coords, zoom: 14 });
      }
    });
    setActiveInput(null);
  };

  const previewRoute = async () => {
    if (!pickupCoords || !destinationCoords || !map.current) return alert('Please select accurate locations from suggestions.');
    setIsRouting(true); setActiveInput(null);
    try {
      markers.current.forEach(m => m.remove()); markers.current = [];
      if (map.current.getSource('route')) { map.current.removeLayer('route'); map.current.removeSource('route'); }
      markers.current.push(new mapboxgl.Marker({ color: '#10B981' }).setLngLat(pickupCoords).addTo(map.current));
      markers.current.push(new mapboxgl.Marker({ color: '#3B82F6' }).setLngLat(destinationCoords).addTo(map.current));
      map.current.fitBounds(new mapboxgl.LngLatBounds(pickupCoords, pickupCoords).extend(destinationCoords), { padding: 50 });

      if (serviceType === 'ride' || serviceType === 'delivery') {
        const dirRes = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${pickupCoords[0]},${pickupCoords[1]};${destinationCoords[0]},${destinationCoords[1]}?geometries=geojson&access_token=${import.meta.env.VITE_MAPBOX_TOKEN}`);
        const dirData = await dirRes.json();
        const route = dirData.routes?.[0];
        if (route) {
          const distKm = route.distance / 1000;
          setTripDistanceKm(distKm);
          const rate = pricingRates[vehicleType] || { min: 15, perKm: 3 };
          setOfferAmount(Math.max(rate.min, Math.ceil((rate.min + (distKm * rate.perKm)) / 5) * 5).toString());
          map.current.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } });
          map.current.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#f97316', 'line-width': 4 } });
        }
      }
    } catch (err: any) { alert('Map Error: ' + err.message); } finally { setIsRouting(false); }
  };

  const handleDispatchDelivery = async () => {
    if (!pickupCoords || !destinationCoords) return alert('Please select pickup and destination from suggestions.');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select time for scheduled request.');
    
    let finalAmount = 0; let finalStatus = 'pending_admin';
    if (serviceType === 'ride' || serviceType === 'delivery') {
      finalAmount = Number(offerAmount);
      if (!finalAmount || finalAmount <= 0) return alert('Preview route to calculate offer.');
      const minFare = pricingRates[vehicleType]?.min || 1;
      if (finalAmount < minFare) return alert(`Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minFare}`); 
    }

    if (liveBalance < finalAmount) {
      return alert(`Insufficient Balance. You need SLE ${finalAmount} to request this trip. Please Load your wallet.`);
    }

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
        rider_id: profile.id, service_type: serviceType, vehicle_type: serviceType !== 'scheduled' ? vehicleType : null, pickup_location: pickup, destination_location: destination, fare_amount: finalAmount, scheduled_time: serviceType === 'scheduled' ? scheduledTime : null, status: finalStatus
      }).select().single();
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert(err.message); } finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  const executeLoad = async () => {
    if (!loadAmount || Number(loadAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessingLoad(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: loadAmount, userId: profile.id, role: profile.role }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment gateway failed');
      if (data.link) window.location.href = data.link;
    } catch (err: any) { alert(err.message); setIsProcessingLoad(false); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen" onClick={() => setActiveInput(null)}>
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div><h2 className="font-bold text-slate-900 leading-tight">{profile?.business_name || profile?.full_name || 'Merchant Store'}</h2></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-sm">Load Wallet</button>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="bg-orange-600 rounded-3xl p-8 text-white relative shadow-lg">
          <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
             <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
          </button>
          <div>
            <span className="text-orange-200 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
            <div className="text-5xl font-bold mt-2">SLE {liveBalance.toFixed(2)}</div>
            <div className="text-xs font-mono text-white/70 mt-2 bg-black/20 inline-flex flex-col sm:flex-row gap-2 px-2 py-1 rounded">
               <span>Account ID:</span> <span className="select-all">{monimeAccountId}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit">
            <h3 className="font-bold text-lg">Dispatch Request</h3>
            
            {!activeBooking ? (
              <>
                <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
                  <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
                  <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
                </div>
                
                <div className="space-y-3">
                   {(serviceType === 'ride' || serviceType === 'delivery') && (
                     <div className="grid grid-cols-4 gap-2 mb-2">
                       {(['keke', 'bike', 'car', 'van'] as VehicleType[]).map(v => <button key={v} onClick={() => setVehicleType(v)} className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-600' : 'bg-slate-100 text-slate-500'}`}>{v}</button>)}
                     </div>
                   )}

                   <div className="relative z-30" onClick={e => e.stopPropagation()}>
                     <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'pickup' ? 'border-orange-500 ring-2 ring-orange-100' : 'border-slate-200'}`}>
                       <MapPin size={16} className="text-emerald-600 shrink-0" />
                       <input type="text" placeholder="Store Pickup Location" value={pickup} onChange={e => searchPlaces(e.target.value, 'pickup')} onFocus={() => setActiveInput('pickup')} className="w-full outline-none text-sm bg-transparent" />
                     </div>
                     {activeInput === 'pickup' && pickupSuggestions.length > 0 && (
                       <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                         {pickupSuggestions.map((s, i) => <button key={i} onClick={() => handleSelectPlace(s.place_id, s.description, 'pickup')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100"><div className="text-sm font-bold text-slate-900">{s.structured_formatting?.main_text || s.description}</div></button>)}
                       </div>
                     )}
                   </div>

                   <div className="relative z-20" onClick={e => e.stopPropagation()}>
                     <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'destination' ? 'border-orange-500 ring-2 ring-orange-100' : 'border-slate-200'}`}>
                       <Navigation size={16} className="text-blue-600 shrink-0" />
                       <input type="text" placeholder="Customer Dropoff Location" value={destination} onChange={e => searchPlaces(e.target.value, 'destination')} onFocus={() => setActiveInput('destination')} className="w-full outline-none text-sm bg-transparent" />
                     </div>
                     {activeInput === 'destination' && destinationSuggestions.length > 0 && (
                       <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                         {destinationSuggestions.map((s, i) => <button key={i} onClick={() => handleSelectPlace(s.place_id, s.description, 'destination')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100"><div className="text-sm font-bold text-slate-900">{s.structured_formatting?.main_text || s.description}</div></button>)}
                       </div>
                     )}
                   </div>

                   <div className="flex justify-between items-center px-1 mt-1">
                     <span className="text-xs text-slate-500 font-bold">{tripDistanceKm ? `Route: ${tripDistanceKm.toFixed(1)} km` : ''}</span>
                     <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100">{isRouting ? <Loader2 size={12} className="animate-spin"/> : <MapPin size={12} />} Preview Route</button>
                   </div>

                   {(serviceType === 'ride' || serviceType === 'delivery') && (
                    <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-slate-500 font-bold text-sm px-2">Total Fare (SLE)</span>
                        <input type="number" placeholder="Amount" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2" />
                        <div className="flex gap-1">
                          <button onClick={() => setOfferAmount(prev => Math.max(pricingRates[vehicleType]?.min || 1, (Number(prev)||1) - 5).toString())} className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"><Minus size={16}/></button>
                          <button onClick={() => setOfferAmount(prev => ((Number(prev)||1) + 5).toString())} className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"><Plus size={16}/></button>
                        </div>
                      </div>
                      {/* FEE BREAKDOWN UI */}
                      {Number(offerAmount) > 0 && (
                        <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm mt-2">
                          <div className="text-[11px] font-bold text-emerald-600">Driver Earns: SLE {(Number(offerAmount) * 0.85).toFixed(2)}</div>
                          <div className="text-[11px] font-bold text-rose-500">Platform Fee: SLE {(Number(offerAmount) * 0.15).toFixed(2)}</div>
                        </div>
                      )}
                    </div>
                  )}

                   {serviceType === 'scheduled' && (
                     <div className="flex items-center gap-2 border p-3 rounded-xl"><CalendarClock size={16} className="text-emerald-600" /><input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-full outline-none text-sm bg-transparent" /></div>
                   )}

                   <button onClick={handleDispatchDelivery} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4">
                     {isRequesting ? <Loader2 className="animate-spin mx-auto"/> : 'Request Dispatch'}
                   </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                {activeBooking.status === 'accepted' || activeBooking.status === 'in_progress' ? (
                  <>
                     <Car className="text-emerald-600 mx-auto mb-4" size={48} />
                     <h4 className="font-bold text-xl text-slate-900">
                       {activeBooking.status === 'in_progress' ? 'Trip in Progress!' : 'Driver is on the way!'}
                     </h4>
                     <p className="text-sm text-slate-500 mt-2">Your fare (SLE {activeBooking.fare_amount}) is held securely in Escrow.</p>
                     
                     {activeBooking.driver && (
                        <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-left mb-6">
                           <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Your Driver</div>
                           <div className="font-bold text-slate-900">{activeBooking.driver.full_name}</div>
                           <div className="text-sm text-slate-600 flex items-center gap-1 mt-1"><Smartphone size={14}/> {activeBooking.driver.phone}</div>
                        </div>
                     )}

                     {activeBooking.status === 'in_progress' && (
                       <button 
                         onClick={async () => {
                           setIsRequesting(true);
                           try {
                             const res = await fetch('/api/complete-ride-payout', {
                               method: 'POST', headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify({ bookingId: activeBooking.id, driverId: activeBooking.driver_id, amount: activeBooking.fare_amount })
                             });
                             const data = await res.json();
                             if (!res.ok) throw new Error(data.error);
                             alert('Payment released to Driver! Trip Complete.');
                             fetchLiveBalance();
                             setActiveBooking(null);
                           } catch (err: any) { alert(err.message); } finally { setIsRequesting(false); }
                         }}
                         disabled={isRequesting}
                         className="w-full bg-emerald-600 text-white font-bold py-4 rounded-xl hover:bg-emerald-700 transition shadow-lg flex items-center justify-center gap-2"
                       >
                         {isRequesting ? <Loader2 className="animate-spin" size={20} /> : `Pay SLE ${activeBooking.fare_amount} & Complete Trip`}
                       </button>
                     )}
                  </>
                ) : (
                  <>
                     <Loader2 className="animate-spin text-orange-600 mx-auto mb-4" size={40} />
                     <h4 className="font-bold text-lg text-slate-900">{activeBooking.status === 'pending_admin' ? 'Request sent to Dispatch...' : 'Broadcasting request...'}</h4>
                     <p className="text-sm text-slate-500 mt-2">Please wait while we assign a driver to your delivery.</p>
                     
                     {(activeBooking.status === 'pending' || activeBooking.status === 'pending_admin') && (
                       <button onClick={cancelTrip} className="text-red-500 text-sm font-bold hover:underline mt-4">Cancel Request</button>
                     )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[400px] border border-slate-200 shadow-inner">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>

      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsLoadModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <button onClick={executeLoad} disabled={isProcessingLoad || !loadAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingLoad ? <Loader2 className="animate-spin" size={20} /> : <><ArrowDownLeft size={20} /> Checkout</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 🔴 RESTORED TRIPS UI FOR MERCHANT
function MerchantInventory({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { 
    supabase.from('bookings').select('*, driver:driver_id(full_name)').eq('rider_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); 
  }, [profile.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Dispatch History</h1>
      {trips.length === 0 ? <div className="text-center text-slate-500 py-10">No dispatches found.</div> : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div>
            <div className="font-bold text-slate-900 capitalize">{t.service_type} {t.vehicle_type ? `(${t.vehicle_type})` : ''}</div>
            <div className="text-xs text-slate-500 mt-1">{new Date(t.created_at).toLocaleString()}</div>
            <div className="text-xs font-mono text-slate-400 mt-2">{t.pickup_location?.slice(0,25)}... <ArrowRight size={10} className="inline"/> {t.destination_location?.slice(0,25)}...</div>
          </div>
          <div className="text-right">
            <div className="font-bold text-lg text-slate-900">SLE {t.fare_amount}</div>
            <div className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded mt-1 inline-block ${t.status==='completed'?'bg-emerald-100 text-emerald-700':t.status==='cancelled'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{t.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}