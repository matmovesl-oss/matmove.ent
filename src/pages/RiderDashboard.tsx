import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, Package, MapPin, Navigation, ShoppingBag, Loader2, CalendarClock, Plus, Minus, ArrowRight, Wallet, RefreshCw, X, Smartphone, ArrowDownLeft, ArrowUpRight, Users, ShoppingCart } from 'lucide-react';

const WHATSAPP_NUMBER = "23290330362";

export function RiderDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'shop') return <RiderShop profile={profile} />;
  if (activeSection === 'trips') return <RiderTrips profile={profile} />;

  // 🔴 WALLET STATES
  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const [pricingRates, setPricingRates] = useState<any>({ bike: { min: 15, perKm: 3 }, keke: { min: 20, perKm: 5 }, car: { min: 30, perKm: 8 }, van: { min: 50, perKm: 15 } });

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [activeInput, setActiveInput] = useState<'pickup' | 'destination' | null>(null);

  const [serviceType, setServiceType] = useState<'ride' | 'delivery' | 'scheduled'>('ride');
  const [vehicleType, setVehicleType] = useState<'keke' | 'bike' | 'car' | 'van'>('car');
  const [offerAmount, setOfferAmount] = useState<string>('');
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  
  const [isRouting, setIsRouting] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [isProcessingLoad, setIsProcessingLoad] = useState(false);

  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const [showPolicy, setShowPolicy] = useState(false);
  const [isFrozen, setIsFrozen] = useState(wallet?.is_frozen || false);

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
    if (profile?.id) {
      const accepted = localStorage.getItem(`matmove_policy_${profile.id}`);
      if (!accepted) setShowPolicy(true);
      
      supabase.from('wallets').select('is_frozen').eq('user_id', profile.id).eq('currency', 'SLE').single().then(({data}) => {
        if (data) setIsFrozen(data.is_frozen);
      });
    }
  }, [profile?.id]);

  const handleAcceptPolicy = () => {
    localStorage.setItem(`matmove_policy_${profile.id}`, 'true');
    setShowPolicy(false);
  };

  useEffect(() => {
    if (!profile?.id) return;
    const checkActiveTrip = async () => {
      const { data } = await supabase.from('bookings').select('*, driver:driver_id(full_name, phone)').eq('rider_id', profile.id).in('status', ['pending', 'pending_admin', 'accepted', 'in_progress']).order('created_at', { ascending: false }).limit(1).single();
      if (data) setActiveBooking(data); else setActiveBooking(null);
    };
    checkActiveTrip();
    const channel = supabase.channel('rider-active-booking').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `rider_id=eq.${profile.id}` }, checkActiveTrip).subscribe();
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
      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      
      const { data: wData } = await supabase.from('wallets').select('is_frozen').eq('user_id', profile.id).eq('currency', 'SLE').single();
      if (wData) setIsFrozen(wData.is_frozen);
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  const handleCreateUsdWallet = async () => {
    if (!window.confirm("Create a secure USD Wallet?")) return;
    setIsCreatingUsd(true);
    try {
      const res = await fetch('/api/create-usd-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: profile.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("USD Wallet created successfully!");
      fetchLiveBalance();
    } catch (err: any) { alert(err.message); } finally { setIsCreatingUsd(false); }
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    try {
      mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
      map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-13.234, 8.484], zoom: 12 });
    } catch (e) { console.error('Mapbox error:', e); }
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
          map.current.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#2563EB', 'line-width': 4 } });
        }
      }
    } catch (err: any) { alert('Map Error: ' + err.message); } finally { setIsRouting(false); }
  };

  const handleRequest = async () => {
    if (!pickupCoords || !destinationCoords) return alert('Please select pickup and destination from suggestions.');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select time for scheduled request.');
    let finalAmount = 0; let finalStatus = 'pending';
    
    if (serviceType === 'ride' || serviceType === 'delivery') {
      finalAmount = Number(offerAmount);
      if (!finalAmount || finalAmount <= 0) return alert('Preview route to calculate offer.');
      const minFare = pricingRates[vehicleType]?.min || 1;
      if (finalAmount < minFare) return alert(`Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minFare}`); 
    } else { finalStatus = 'pending_admin'; }

    if ((sleWallet?.balance || 0) < finalAmount) {
      return alert(`Insufficient Balance. You need SLE ${finalAmount} to request this trip. Please Load your wallet.`);
    }

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({ rider_id: profile.id, service_type: serviceType, vehicle_type: serviceType !== 'scheduled' ? vehicleType : null, pickup_location: pickup, destination_location: destination, fare_amount: finalAmount, scheduled_time: serviceType === 'scheduled' ? scheduledTime : null, status: finalStatus }).select().single();
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert('Request failed: ' + err.message); } finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone('');
  };

  const executeLoad = async () => {
    if (!loadAmount || Number(loadAmount) <= 0) return alert('Enter a valid amount.');
    setIsProcessingLoad(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: loadAmount, userId: profile.id, role: 'rider' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment failed');
      if (data.link) window.location.href = data.link;
    } catch (err: any) { alert(err.message); setIsProcessingLoad(false); }
  };

  const executePayout = async () => {
    const amt = Number(payoutAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (!payoutPhone.trim()) return alert('Enter recipient mobile money number');

    setIsProcessingPayout(true);
    try {
      const res = await fetch('/api/create-monime-payout', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: payoutPhone, networkProvider }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payout failed');
      alert(`Payout requested successfully!`);
      window.location.reload(); 
    } catch (err: any) { alert(err.message); setIsProcessingPayout(false); }
  };

  const executeTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (!transferRecipient.trim() || !transferRecipient.startsWith('fac-')) return alert('Enter a valid MatMove Account ID');

    setIsProcessingTransfer(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, recipientAccountId: transferRecipient.trim() }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Transfer completed!`);
      window.location.reload(); 
    } catch (err: any) { alert(err.message); setIsProcessingTransfer(false); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen" onClick={() => setActiveInput(null)}>
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div><h1 className="text-xl font-bold text-slate-900">Where to, {profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider'}? 👋</h1></div>
        <div className="flex gap-2">
          {isFrozen ? (
            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-red-200">Wallet Frozen by Admin</span>
          ) : (
            <>
              <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-700 transition">Load</button>
              <button onClick={() => setIsPayoutModalOpen(true)} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">Payout</button>
              <button onClick={() => setIsTransferModalOpen(true)} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-800 transition">Transfer</button>
            </>
          )}
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        
        {/* 🔴 MULTI-CURRENCY WALLET SECTION */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SLE WALLET */}
          <div className="bg-slate-900 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl relative">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
            </button>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">SLE Operating Wallet</span>
              <div className="text-3xl font-bold mt-1 text-blue-400">SLE {Number(sleWallet?.balance || 0).toFixed(2)}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-800 inline-block px-2 py-1 rounded">ID: {sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || 'Pending Setup'}</div>
            </div>
            <Wallet size={32} className="text-slate-700 mr-2 md:mr-6 pointer-events-none" />
          </div>

          {/* USD WALLET */}
          <div className="bg-slate-800 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl border border-slate-700 relative">
            {usdWallet ? (
              <>
                <div>
                  <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">USD Reserve Wallet</span>
                  <div className="text-3xl font-bold mt-1 text-emerald-400">USD {Number(usdWallet.balance || 0).toFixed(2)}</div>
                  <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-700 inline-block px-2 py-1 rounded">ID: {usdWallet.monime_account_id}</div>
                </div>
                <Wallet size={32} className="text-slate-600 mr-2 md:mr-6 pointer-events-none" />
              </>
            ) : (
              <div className="w-full flex flex-col items-center justify-center text-center py-1">
                <button onClick={handleCreateUsdWallet} disabled={isCreatingUsd} className="bg-slate-700 hover:bg-slate-600 transition p-3 rounded-full mb-2 shadow-inner">
                  {isCreatingUsd ? <Loader2 className="animate-spin text-emerald-400" size={24} /> : <Plus size={24} className="text-emerald-400" />}
                </button>
                <span className="text-sm font-bold text-slate-300">Create USD Wallet</span>
                <span className="text-[10px] text-slate-500 mt-1">Hold and transfer US Dollars securely</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit z-20">
            <h3 className="font-bold text-lg">Request Service</h3>
            
            {!activeBooking ? (
              <>
                <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
                  <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
                  <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
                </div>
                <div className="space-y-3">
                  {(serviceType === 'ride' || serviceType === 'delivery') && (
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {(['keke', 'bike', 'car', 'van'] as const).map(v => <button key={v} onClick={() => setVehicleType(v)} className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-600' : 'bg-slate-100 text-slate-500'}`}>{v}</button>)}
                    </div>
                  )}

                  <div className="relative z-30" onClick={e => e.stopPropagation()}>
                    <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'pickup' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                      <MapPin size={16} className="text-emerald-600 shrink-0" />
                      <input type="text" placeholder="Where are you?" value={pickup} onChange={e => searchPlaces(e.target.value, 'pickup')} onFocus={() => setActiveInput('pickup')} className="w-full outline-none text-sm bg-transparent" />
                    </div>
                    {activeInput === 'pickup' && pickupSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                        {pickupSuggestions.map((s, i) => <button key={i} onClick={() => handleSelectPlace(s.place_id, s.description, 'pickup')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100"><div className="text-sm font-bold text-slate-900">{s.structured_formatting?.main_text || s.description}</div></button>)}
                      </div>
                    )}
                  </div>

                  <div className="relative z-20" onClick={e => e.stopPropagation()}>
                    <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'destination' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                      <Navigation size={16} className="text-blue-600 shrink-0" />
                      <input type="text" placeholder="Where to?" value={destination} onChange={e => searchPlaces(e.target.value, 'destination')} onFocus={() => setActiveInput('destination')} className="w-full outline-none text-sm bg-transparent" />
                    </div>
                    {activeInput === 'destination' && destinationSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                        {destinationSuggestions.map((s, i) => <button key={i} onClick={() => handleSelectPlace(s.place_id, s.description, 'destination')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100"><div className="text-sm font-bold text-slate-900">{s.structured_formatting?.main_text || s.description}</div></button>)}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center px-1 mt-1">
                    <span className="text-xs text-slate-500 font-bold">{tripDistanceKm ? `Route: ${tripDistanceKm.toFixed(1)} km` : ''}</span>
                    <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">{isRouting ? <Loader2 size={12} className="animate-spin"/> : <MapPin size={12} />} Preview Route</button>
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
                </div>
                <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4">{isRequesting ? <Loader2 className="animate-spin mx-auto" /> : `Confirm Request`}</button>
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
                               alert('Payment released!');
                               window.location.reload(); 
                             } catch (err: any) { alert(err.message); setIsRequesting(false); }
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
                     <Loader2 className="animate-spin text-blue-600 mx-auto mb-4" size={40} />
                     <h4 className="font-bold text-lg text-slate-900">{activeBooking.status === 'pending_admin' ? 'Request sent to Dispatch...' : 'Broadcasting request...'}</h4>
                     <p className="text-sm text-slate-500 mt-2">Please wait while we assign a driver to your trip.</p>
                     
                     {(activeBooking.status === 'pending' || activeBooking.status === 'pending_admin') && (
                       <button onClick={cancelTrip} className="text-red-500 text-sm font-bold hover:underline mt-4">Cancel Request</button>
                     )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[500px] border border-slate-200 shadow-inner z-0">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>

      {/* LOAD MODAL */}
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

      {/* PAYOUT MODAL */}
      {isPayoutModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Mobile Payout</h2>
            <p className="text-sm text-slate-500 mb-6">Cashout to Mobile Money.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-emerald-500" />
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setNetworkProvider('orange')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Orange</button>
                <button onClick={() => setNetworkProvider('afrimoney')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'afrimoney' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Afrimoney</button>
              </div>
              <input type="tel" placeholder="e.g. 077123456 or 030123456" value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none focus:border-emerald-500" />
            </div>
            <button onClick={executePayout} disabled={isProcessingPayout || !payoutAmount || !payoutPhone} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingPayout ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Payout
            </button>
          </div>
        </div>
      )}

      {/* TRANSFER MODAL */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Internal Transfer</h2>
            <p className="text-sm text-slate-500 mb-6">Paste the recipient's exact MatMove Account ID.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500" />
              <input type="text" placeholder="Recipient ID (e.g. fac-k6V8...)" value={transferRecipient} onChange={(e) => setTransferRecipient(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500" />
            </div>
            <button onClick={executeTransfer} disabled={isProcessingTransfer || !transferAmount || !transferRecipient} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingTransfer ? <Loader2 className="animate-spin" size={20} /> : <Users size={20} />} Send Transfer
            </button>
          </div>
        </div>
      )}

      {showPolicy && <PolicyModal onAccept={handleAcceptPolicy} />}
    </div>
  );
}

function RiderShop({ profile }: any) {
//... same as before