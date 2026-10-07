import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, Package, MapPin, Navigation, ShoppingBag, Loader2, CalendarClock, Plus, Minus, ArrowRight, Wallet, RefreshCw, X, Smartphone, ArrowDownLeft, ArrowUpRight, Users, ShoppingCart, Activity, Copy, Check, Share2, ArrowLeftRight, MessageCircle } from 'lucide-react';

const WHATSAPP_NUMBER = "23290330362";

export function RiderDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'shop') return <RiderShop profile={profile} wallet={wallet} />;
  if (activeSection === 'trips') return <RiderTrips profile={profile} />;

  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exchangeRateUsdToSle, setExchangeRateUsdToSle] = useState(24.68);
  
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

  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertDirection, setConvertDirection] = useState<'USD_TO_SLE' | 'SLE_TO_USD'>('USD_TO_SLE');
  const [convertAmount, setConvertAmount] = useState('');
  const [isProcessingConvert, setIsProcessingConvert] = useState(false);

  const [showPolicy, setShowPolicy] = useState(false);
  const [isFrozen, setIsFrozen] = useState(wallet?.is_frozen || false);

  const monimeAccountId = sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || 'Pending Setup';
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    supabase.from('exchange_rates').select('*').eq('from_currency', 'USD').eq('to_currency', 'SLE').maybeSingle().then(({data}) => {
      if (data) setExchangeRateUsdToSle(Number(data.rate));
    });
  }, []);

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareReceipt = (tx: any) => {
    const isCredit = tx.balanceImpact === 'CREDIT';
    const amount = (tx.amount?.value / 100).toFixed(2);
    const currency = tx.amount?.currency || 'SLE';
    const dateStr = tx.createdAt || tx.created_at || tx.timestamp || tx.date || tx.createdOn;
    const formattedDate = dateStr && !isNaN(new Date(dateStr).getTime()) ? new Date(dateStr).toLocaleString() : 'Recent';
    
    const receiptText = `MatMove Receipt\n----------------\nType: ${tx.description || tx.type || 'Transaction'}\nStatus: ${tx.status}\nDate: ${formattedDate}\nAmount: ${isCredit ? '+' : '-'}${currency} ${amount}\nTxID: ${tx.id}\n----------------\nSecurely processed by MatMove.`;
    
    if (navigator.share) {
       navigator.share({ title: 'MatMove Receipt', text: receiptText }).catch(() => {
          navigator.clipboard.writeText(receiptText); alert('Receipt copied to clipboard!');
       });
    } else {
       navigator.clipboard.writeText(receiptText); alert('Receipt copied to clipboard!');
    }
  };

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

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/get-live-wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: profile.id }) });
      const data = await res.json();
      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      if (data.transactions) setTransactions(data.transactions);
      
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

      if (navigator.geolocation) {
         navigator.geolocation.getCurrentPosition(async (pos) => {
            const { longitude, latitude } = pos.coords;
            setPickupCoords([longitude, latitude]);
            map.current?.flyTo({ center: [longitude, latitude], zoom: 15 });
            
            try {
               const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${mapboxgl.accessToken}`);
               const data = await res.json();
               if (data.features && data.features.length > 0) {
                  setPickup(data.features[0].place_name);
               }
            } catch (e) {}

            const marker = new mapboxgl.Marker({ color: '#10B981', draggable: true }).setLngLat([longitude, latitude]).addTo(map.current!);
            marker.on('dragend', async () => {
               const lngLat = marker.getLngLat();
               setPickupCoords([lngLat.lng, lngLat.lat]);
               try {
                  const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lngLat.lng},${lngLat.lat}.json?access_token=${mapboxgl.accessToken}`);
                  const data = await res.json();
                  if (data.features && data.features.length > 0) setPickup(data.features[0].place_name);
               } catch (e) {}
            });
            markers.current.push(marker);
         });
      }
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
        
        if (map.current) {
            map.current.flyTo({ center: coords, zoom: 14 });
            const color = type === 'pickup' ? '#10B981' : '#3B82F6';
            const marker = new mapboxgl.Marker({ color, draggable: true }).setLngLat(coords).addTo(map.current);
            marker.on('dragend', async () => {
               const lngLat = marker.getLngLat();
               if (type === 'pickup') setPickupCoords([lngLat.lng, lngLat.lat]); else setDestinationCoords([lngLat.lng, lngLat.lat]);
               try {
                  const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lngLat.lng},${lngLat.lat}.json?access_token=${mapboxgl.accessToken}`);
                  const data = await res.json();
                  if (data.features && data.features.length > 0) {
                     if (type === 'pickup') setPickup(data.features[0].place_name); else setDestination(data.features[0].place_name);
                  }
               } catch (e) {}
            });
            markers.current.push(marker);
        }
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
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false); setIsConvertModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); setIsProcessingConvert(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone(''); setConvertAmount('');
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
    const recipient = transferRecipient.trim();

    if (usdWallet?.monime_account_id && recipient === usdWallet.monime_account_id) {
       alert("To move funds between your SLE and USD wallets, please use the Convert button.");
       setIsTransferModalOpen(false);
       setIsConvertModalOpen(true);
       return;
    }

    if (!recipient || !recipient.startsWith('fac-')) return alert('Enter a valid MatMove Account ID');

    setIsProcessingTransfer(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, recipientAccountId: recipient }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Transfer completed!`);
      window.location.reload(); 
    } catch (err: any) { alert(err.message); setIsProcessingTransfer(false); }
  };

  const executeConvert = async () => {
    const amt = Number(convertAmount);
    if (!amt || amt <= 0) return alert('Enter a valid amount');
    setIsProcessingConvert(true);

    const fromCurrency = convertDirection === 'USD_TO_SLE' ? 'USD' : 'SLE';
    const toCurrency = convertDirection === 'USD_TO_SLE' ? 'SLE' : 'USD';

    try {
      const res = await fetch('/api/convert-currency', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ userId: profile.id, fromCurrency, toCurrency, amount: amt }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');
      alert(`Successfully converted ${fromCurrency} to ${toCurrency}!`);
      closeModals();
      fetchLiveBalance(); 
    } catch (err: any) { alert(err.message); setIsProcessingConvert(false); }
  };

  const WalletCards = (
    <div className={`grid grid-cols-1 ${activeSection === 'wallet' ? 'md:grid-cols-2' : ''} gap-4`}>
      <div className="bg-slate-900 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl relative">
        <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
        </button>
        <div>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">SLE Operating Wallet</span>
          <div className="text-3xl font-bold mt-1 text-blue-400">SLE {Number(sleWallet?.balance || 0).toFixed(2)}</div>
          <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-800 inline-flex items-center gap-2 px-2 py-1 rounded">
             ID: {monimeAccountId}
             <button onClick={() => handleCopy(monimeAccountId)} className="hover:text-white transition">
                {copiedId === monimeAccountId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
             </button>
          </div>
        </div>
        <Wallet size={32} className="text-slate-700 mr-2 md:mr-6 pointer-events-none" />
      </div>

      <div className="bg-slate-800 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl border border-slate-700 relative">
        {usdWallet?.monime_account_id ? (
          <>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">USD Reserve Wallet</span>
              <div className="text-3xl font-bold mt-1 text-emerald-400">USD {Number(usdWallet.balance || 0).toFixed(2)}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-700 inline-flex items-center gap-2 px-2 py-1 rounded">
                 ID: {usdWallet.monime_account_id}
                 <button onClick={() => handleCopy(usdWallet.monime_account_id)} className="hover:text-white transition">
                    {copiedId === usdWallet.monime_account_id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                 </button>
              </div>
            </div>
            <Wallet size={32} className="text-slate-600 mr-2 md:mr-6 pointer-events-none" />
          </>
        ) : (
          <div className="w-full flex flex-col items-center justify-center text-center py-1">
            <button onClick={handleCreateUsdWallet} disabled={isCreatingUsd} className="bg-slate-700 hover:bg-slate-600 transition p-3 rounded-full mb-2 shadow-inner">
              {isCreatingUsd ? <Loader2 size={24} className="animate-spin text-emerald-400" /> : <Plus size={24} className="text-emerald-400" />}
            </button>
            <span className="text-sm font-bold text-slate-300">Create USD Wallet</span>
          </div>
        )}
      </div>
    </div>
  );

  const displayedTx = txFilter === 'recent' ? transactions.slice(0, 5) : transactions;

  return (
    <div className="flex-1 bg-slate-50 min-h-screen" onClick={() => setActiveInput(null)}>
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div><h1 className="text-xl font-bold text-slate-900">Where to, {profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider'}? 👋</h1></div>
        <div className="flex gap-2">
          {isFrozen ? (
            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-red-200">Wallet Frozen</span>
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
        {activeSection === 'home' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit z-20">
              {WalletCards}
              <h3 className="font-bold text-lg mt-6">Request Service</h3>
              
              {!activeBooking ? (
                <>
                  <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16} /> Ride</button>
                    <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16} /> Delivery</button>
                    <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16} /> Schedule</button>
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
                      <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">{isRouting ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />} Preview Route</button>
                    </div>

                    {(serviceType === 'ride' || serviceType === 'delivery') && (
                      <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-slate-500 font-bold text-sm px-2">Total Fare (SLE)</span>
                          <input type="number" placeholder="Amount" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2" />
                          <div className="flex gap-1">
                            <button onClick={() => setOfferAmount(prev => Math.max(pricingRates[vehicleType]?.min || 1, (Number(prev)||1) - 5).toString())} className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"><Minus size={16} /></button>
                            <button onClick={() => setOfferAmount(prev => ((Number(prev)||1) + 5).toString())} className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"><Plus size={16} /></button>
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
                  <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4">{isRequesting ? <Loader2 size={20} className="animate-spin mx-auto" /> : `Confirm Request`}</button>
                </>
              ) : (
                <div className="text-center py-8">
                  {activeBooking.status === 'accepted' || activeBooking.status === 'in_progress' ? (
                    <>
                       <Car size={48} className="text-emerald-600 mx-auto mb-4" />
                       <h4 className="font-bold text-xl text-slate-900">
                         {activeBooking.status === 'in_progress' ? 'Trip in Progress!' : 'Driver is on the way!'}
                       </h4>
                       <p className="text-sm text-slate-500 mt-2">Your fare (SLE {activeBooking.fare_amount}) is held securely in Escrow.</p>
                       
                       {activeBooking.driver && (
                          <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-left mb-6">
                             <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Your Driver</div>
                             <div className="font-bold text-slate-900">{activeBooking.driver.full_name}</div>
                             <div className="text-sm text-slate-600 flex items-center gap-1 mt-1"><Smartphone size={14} /> {activeBooking.driver.phone}</div>
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
                           {isRequesting ? <Loader2 size={20} className="animate-spin" /> : `Pay SLE ${activeBooking.fare_amount} & Complete Trip`}
                         </button>
                       )}
                    </>
                  ) : (
                    <>
                       <Loader2 size={40} className="animate-spin text-orange-600 mx-auto mb-4" />
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
        )}

        {/* 🔴 WALLET TAB ONLY: TRANSACTIONS & FULL WIDTH ACTIONS */}
        {activeSection === 'wallet' && (
          <div className="w-full space-y-6">
             <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">My Wallets</h2>
             {WalletCards}
             
             <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
               <h3 className="text-xl font-bold text-slate-900 mb-2">Wallet Actions</h3>
               <p className="text-sm text-slate-500 mb-8">Manage and convert your funds securely</p>
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
                  <button onClick={() => setIsLoadModalOpen(true)} disabled={isFrozen} className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                    <div className="p-3 bg-white rounded-full shadow-sm"><ArrowDownLeft size={24} /></div> Load
                  </button>
                  <button onClick={() => setIsPayoutModalOpen(true)} disabled={isFrozen} className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                    <div className="p-3 bg-white rounded-full shadow-sm"><ArrowUpRight size={24} /></div> Withdraw
                  </button>
                  <button onClick={() => setIsTransferModalOpen(true)} disabled={isFrozen} className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                    <div className="p-3 bg-white rounded-full shadow-sm"><Users size={24} /></div> Transfer
                  </button>
                  <button onClick={() => setIsConvertModalOpen(true)} disabled={!usdWallet?.monime_account_id || isFrozen} className="p-4 sm:p-6 rounded-2xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                    <div className="p-3 bg-white rounded-full shadow-sm"><RefreshCw size={24} /></div> Convert
                  </button>
               </div>
             </div>

             <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm w-full">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2"><Activity size={20} className="text-blue-600" /> Transactions</h3>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button onClick={()=>setTxFilter('recent')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${txFilter==='recent'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`}>Recent</button>
                    <button onClick={()=>setTxFilter('all')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${txFilter==='all'?'bg-white shadow-sm text-slate-900':'text-slate-500'}`}>All Time</button>
                  </div>
                </div>

                {displayedTx.length === 0 ? (
                    <div className="text-center text-slate-500 py-6">No transactions found.</div>
                ) : (
                    <div className="space-y-3">
                        {displayedTx.map(tx => {
                            const isCredit = tx.balanceImpact === 'CREDIT';
                            const dateStr = tx.createdAt || tx.created_at || tx.timestamp || tx.date || tx.createdOn;
                            const isValidDate = dateStr && !isNaN(new Date(dateStr).getTime());
                            const formattedDate = isValidDate ? new Date(dateStr).toLocaleString() : 'Date pending';

                            return (
                                <div key={tx.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition group">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-full ${isCredit ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                                            {isCredit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-900 text-sm">{tx.description || tx.type || 'Transfer'}</p>
                                            <p className="text-xs text-slate-500 mt-0.5">{formattedDate}</p>
                                        </div>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <div>
                                            <p className={`font-bold ${isCredit ? 'text-emerald-600' : 'text-slate-900'}`}>
                                                {isCredit ? '+' : '-'} {tx.amount?.currency} {(tx.amount?.value / 100).toFixed(2)}
                                            </p>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{tx.status}</span>
                                        </div>
                                        <button onClick={() => handleShareReceipt(tx)} className="text-slate-400 hover:text-blue-600 transition p-2 rounded-full hover:bg-white" title="Copy Receipt">
                                            <Share2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
             </div>
          </div>
        )}
      </div>

      {/* CONVERT MODAL */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Convert Currency</h2>
            <p className="text-sm text-slate-500 mb-6">Current Rate: 1 USD = SLE {exchangeRateUsdToSle}</p>
            
            <div className="flex bg-slate-100 p-1 rounded-2xl mb-6">
               <button onClick={() => setConvertDirection('USD_TO_SLE')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${convertDirection === 'USD_TO_SLE' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
                  USD ➔ SLE
               </button>
               <button onClick={() => setConvertDirection('SLE_TO_USD')} className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 ${convertDirection === 'SLE_TO_USD' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
                  SLE ➔ USD
               </button>
            </div>

            <input type="number" placeholder={`Amount (${convertDirection === 'USD_TO_SLE' ? 'USD' : 'SLE'})`} value={convertAmount} onChange={(e) => setConvertAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-4 outline-none focus:border-indigo-500" />
            
            {convertAmount && Number(convertAmount) > 0 && (
              <div className="bg-indigo-50 text-indigo-800 p-4 rounded-xl mb-6 text-center shadow-inner">
                 <span className="text-xs font-bold uppercase tracking-wider opacity-70 block mb-1">You will receive</span>
                 <span className="text-xl font-bold">
                    {convertDirection === 'USD_TO_SLE' 
                      ? `SLE ${(Number(convertAmount) * exchangeRateUsdToSle).toFixed(2)}`
                      : `USD ${(Number(convertAmount) / exchangeRateUsdToSle).toFixed(2)}`
                    }
                 </span>
              </div>
            )}

            <button onClick={executeConvert} disabled={isProcessingConvert || !convertAmount} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingConvert ? <Loader2 size={20} className="animate-spin" /> : <><ArrowLeftRight size={20} /> Convert Now</>}
            </button>
          </div>
        </div>
      )}

      {/* LOAD MODAL */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsLoadModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <button onClick={executeLoad} disabled={isProcessingLoad || !loadAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingLoad ? <Loader2 size={20} className="animate-spin" /> : <><ArrowDownLeft size={20} /> Checkout</>}
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
              {isProcessingPayout ? <Loader2 size={20} className="animate-spin" /> : <ArrowUpRight size={20} />} Confirm Payout
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
              {isProcessingTransfer ? <Loader2 size={20} className="animate-spin" /> : <Users size={20} />} Send Transfer
            </button>
          </div>
        </div>
      )}

      {showPolicy && <PolicyModal onAccept={handleAcceptPolicy} />}
    </div>
  );
}

// 🔴 SHOP ENGINE: CART, IN-APP ORDERS, WHATSAPP, AND SHARE
function RiderShop({ profile, wallet }: any) {
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => { 
    supabase.from('products').select('*, merchant:merchant_id(business_name, whatsapp_number)').order('created_at', { ascending: false }).then(({data}) => { if(data) setProducts(data); }); 
  }, []);

  const handleWhatsAppRedirect = (product: any) => {
    const merchantPhone = product.merchant?.whatsapp_number || WHATSAPP_NUMBER;
    const message = encodeURIComponent(`Hello! I would like to order: *${product.name}* (SLE ${product.price}).`);
    window.open(`https://wa.me/${merchantPhone}?text=${message}`, '_blank');
  };

  const handleShare = (product: any) => {
    const shareText = `Check out ${product.name} for SLE ${product.price} on MatMove!`;
    if (navigator.share) {
       navigator.share({ title: product.name, text: shareText }).catch(() => alert('Share cancelled.'));
    } else {
       navigator.clipboard.writeText(shareText); alert('Product details copied to clipboard!');
    }
  };

  const handleAddToCart = async (product: any) => {
    try {
      await supabase.from('cart_items').insert({ rider_id: profile.id, product_id: product.id, quantity: 1 });
      alert(`${product.name} added to your cart in the Account tab!`);
    } catch (e: any) { alert(e.message); }
  };

  const handleOrderInApp = async (product: any) => {
    if (!wallet || (wallet.balance || 0) < Number(product.price)) {
      return alert(`Insufficient SLE balance to buy ${product.name}. Please load your wallet.`);
    }
    if (!confirm(`Are you sure you want to purchase ${product.name} for SLE ${product.price}? Funds will be securely held in Escrow.`)) return;
    
    try {
      await supabase.from('app_orders').insert({
        rider_id: profile.id,
        merchant_id: product.merchant_id,
        product_name: product.name,
        price: Number(product.price),
        quantity: 1,
        status: 'pending'
      });
      const newBal = Number(wallet.balance) - Number(product.price);
      await supabase.from('wallets').update({ balance: newBal }).eq('id', wallet.id);
      alert('Order placed successfully! The merchant has been notified.');
      window.location.reload();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <ShoppingCart size={28} className="text-blue-600" />
          <h1 className="text-3xl font-bold text-slate-900">Shop Marketplace</h1>
        </div>
      </div>

      {products.length === 0 ? <div className="text-center text-slate-500 py-10">No products listed yet.</div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition duration-200">
              {p.image_url ? (
                <div className="h-48 w-full bg-slate-100 relative group">
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  <button onClick={() => handleShare(p)} className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur rounded-full text-slate-600 hover:text-blue-600 transition shadow-sm">
                    <Share2 size={16} />
                  </button>
                </div>
              ) : (
                <div className="h-48 w-full bg-slate-100 flex items-center justify-center relative">
                  <ShoppingBag size={48} className="text-slate-300" />
                  <button onClick={() => handleShare(p)} className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur rounded-full text-slate-600 hover:text-blue-600 transition shadow-sm">
                    <Share2 size={16} />
                  </button>
                </div>
              )}

              <div className="p-5 flex flex-col flex-1">
                <h4 className="font-bold text-lg text-slate-900 leading-tight">{p.name}</h4>
                <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{p.merchant?.business_name || 'Verified Merchant'}</div>
                <p className="text-sm text-slate-600 mt-3 line-clamp-2 mb-4">{p.description || 'No description available.'}</p>

                <div className="mt-auto space-y-3">
                  <div className="flex justify-between items-center mb-2">
                     <p className="text-blue-600 font-bold text-xl">SLE {p.price}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                     <button onClick={() => handleAddToCart(p)} className="bg-slate-100 text-slate-700 text-[11px] font-bold py-2.5 rounded-lg hover:bg-slate-200 transition flex items-center justify-center gap-1.5">
                       <ShoppingCart size={14} /> Add to Cart
                     </button>
                     <button onClick={() => handleOrderInApp(p)} className="bg-blue-600 text-white text-[11px] font-bold py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-1.5">
                       <ArrowRight size={14} /> Order In-App
                     </button>
                  </div>
                  <button onClick={() => handleWhatsAppRedirect(p)} className="w-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold py-2.5 rounded-lg hover:bg-emerald-100 transition flex items-center justify-center gap-1.5">
                     <MessageCircle size={14} /> Order via WhatsApp
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RiderTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { 
    supabase.from('bookings').select('*, driver:driver_id(full_name)').eq('rider_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); 
  }, [profile.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Trip History</h1>
      {trips.length === 0 ? <div className="text-center text-slate-500 py-10">No trips found.</div> : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div>
            <div className="font-bold text-slate-900 capitalize">{t.service_type} {t.vehicle_type ? `(${t.vehicle_type})` : ''}</div>
            <div className="text-xs text-slate-500 mt-1">{new Date(t.created_at).toLocaleString()}</div>
            <div className="text-xs font-mono text-slate-400 mt-2">{t.pickup_location?.slice(0,25)}... <ArrowRight size={10} className="inline" /> {t.destination_location?.slice(0,25)}...</div>
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

function PolicyModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="bg-slate-900 p-6 text-white shrink-0">
          <h2 className="text-xl font-bold">MatMove Safety & Compliance Policy</h2>
          <p className="text-xs text-slate-400 mt-1">Sierra Leone Road Safety Authority (SLRSA) Guidelines</p>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-sm text-slate-600 space-y-4">
          <p><strong>1. Compliance with SLRSA:</strong> All users (Drivers, Riders, and Merchants) must strictly adhere to the traffic rules and regulations set forth by the Sierra Leone Road Safety Authority (SLRSA).</p>
          <p><strong>2. Liability & Accidents:</strong> MatMove Enterprise acts solely as a technology platform connecting users. MatMove is not liable for any road traffic accidents, injuries, loss of property, or damages that occur during transit.</p>
          <p><strong>3. Vehicle Safety:</strong> Drivers must ensure their vehicles (Keke, Bike, Car, Van) are roadworthy, insured, and licensed.</p>
          <p><strong>4. Account Suspension:</strong> Any violation of these safety policies or reports of reckless behavior will result in immediate wallet freezing and account suspension.</p>
          <p className="font-bold text-slate-900 pt-2 border-t">By clicking "I Accept", you acknowledge that you have read, understood, and agree to be bound by this policy. All rights reserved by MatMove Enterprise.</p>
        </div>
        <div className="p-4 border-t bg-slate-50 shrink-0">
          <button onClick={onAccept} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md">
            I Accept & Agree
          </button>
        </div>
      </div>
    </div>
  );
}