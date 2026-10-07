import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Plus, Package, RefreshCw, X, Loader2, MapPin, Navigation, Car, CalendarClock, Phone, Minus, Smartphone, ArrowDownLeft, ArrowUpRight, Users, ArrowRight, Trash2, Wallet, Activity, Copy, Check, Share2, ArrowLeftRight, Image as ImageIcon } from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

export function MerchantDashboard({ profile, wallet, activeSection, onOpenWallet }: any) {
  if (activeSection === 'inventory') return <MerchantInventory profile={profile} />;
  if (activeSection === 'trips') return <MerchantTrips profile={profile} />;

  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exchangeRateUsdToSle, setExchangeRateUsdToSle] = useState(24.68);

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

  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  // 🔴 2-WAY CONVERT STATES
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [convertDirection, setConvertDirection] = useState<'USD_TO_SLE' | 'SLE_TO_USD'>('USD_TO_SLE');
  const [convertAmount, setConvertAmount] = useState('');
  const [isProcessingConvert, setIsProcessingConvert] = useState(false);

  const [showPolicy, setShowPolicy] = useState(false);
  const [isFrozen, setIsFrozen] = useState(wallet?.is_frozen || false);

  const isApproved = profile?.kyc_status === 'approved';
  const monimeAccountId = sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || 'Pending Setup';
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);

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
    supabase.from('exchange_rates').select('*').eq('from_currency', 'USD').eq('to_currency', 'SLE').maybeSingle().then(({data}) => {
      if (data) setExchangeRateUsdToSle(Number(data.rate));
    });
    supabase.from('pricing_settings').select('*').then(({ data }) => {
      if (data && data.length > 0) {
        const rates: any = {};
        data.forEach(r => rates[r.vehicle_type] = { min: Number(r.min_fare), perKm: Number(r.per_km_rate) });
        setPricingRates(rates);
      }
    });
    if (profile?.id) {
      if (!localStorage.getItem(`matmove_policy_${profile.id}`)) setShowPolicy(true);
      supabase.from('wallets').select('is_frozen').eq('user_id', profile.id).eq('currency', 'SLE').single().then(({data}) => { if (data) setIsFrozen(data.is_frozen); });
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const checkActiveTrip = async () => {
      const { data } = await supabase.from('bookings').select('*, driver:driver_id(full_name, phone)').eq('rider_id', profile.id).in('status', ['pending', 'pending_admin', 'accepted', 'in_progress']).order('created_at', { ascending: false }).limit(1).single();
      if (data) setActiveBooking(data); else setActiveBooking(null);
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

  // 🔴 Initialize Mapbox & Auto-Locate User
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
            
            // Auto-reverse geocode
            try {
               const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${mapboxgl.accessToken}`);
               const data = await res.json();
               if (data.features && data.features.length > 0) {
                  setPickup(data.features[0].place_name);
               }
            } catch (e) {}

            // Set Draggable Marker
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

  // 🔴 Force web layout map resize 
  useEffect(() => {
    if (activeSection === 'home' && map.current) {
        setTimeout(() => map.current?.resize(), 300); // Critical Fix: Forces map to render correctly in Web Flexbox
    }
  }, [activeSection]);

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

    if ((sleWallet?.balance || 0) < finalAmount) {
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

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false); setIsConvertModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); setIsProcessingConvert(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone(''); setConvertAmount('');
  };

  const executeLoad = async () => {
    if (!loadAmount || Number(loadAmount) <= 0) return alert('Enter a valid amount.');
    setIsProcessingLoad(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: loadAmount, userId: profile.id, role: 'merchant' }) });
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
       setIsTransferModalOpen(false); setIsConvertModalOpen(true);
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
      <div className="bg-orange-600 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl relative">
        <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
        </button>
        <div>
          <span className="text-orange-200 text-xs font-bold uppercase tracking-wider">SLE Operating Wallet</span>
          <div className="text-3xl font-bold mt-1 text-white">SLE {Number(sleWallet?.balance || 0).toFixed(2)}</div>
          <div className="text-[10px] font-mono text-white/70 mt-2 bg-black/20 inline-flex items-center gap-2 px-2 py-1 rounded">
             ID: {monimeAccountId}
             <button onClick={() => handleCopy(monimeAccountId)} className="hover:text-white transition">
                {copiedId === monimeAccountId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
             </button>
          </div>
        </div>
        <Wallet size={32} className="text-orange-300 mr-2 md:mr-6 pointer-events-none" />
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
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div><h2 className="font-bold text-slate-900 leading-tight">{profile?.business_name || profile?.full_name || 'Merchant Store'}</h2></div>
        </div>
        <div className="flex gap-2">
          {isFrozen ? (
            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-red-200">Wallet Frozen</span>
          ) : (
            <>
              <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-700 transition">Load</button>
              {isApproved && <button onClick={() => setIsPayoutModalOpen(true)} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">Payout</button>}
              <button onClick={() => setIsTransferModalOpen(true)} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-800 transition">Transfer</button>
            </>
          )}
        </div>
      </header>

      {/* 🔴 HOME TAB ONLY: MAP AND REQUEST FORM */}
      {activeSection === 'home' && (
        <div className="flex-1 flex flex-col lg:flex-row">
          <div className="w-full lg:w-[450px] bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
            {WalletCards}
            <h3 className="font-bold text-lg mt-6">Dispatch Request</h3>
            
            {!activeBooking ? (
              <>
                <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16} /> Delivery</button>
                  <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16} /> Ride</button>
                  <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16} /> Schedule</button>
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
                     <button onClick={previewRoute} disabled={isRouting} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100">{isRouting ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />} Preview Route</button>
                   </div>

                   {(serviceType === 'ride' || serviceType === 'delivery') && (
                    <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-slate-500 font-bold text-sm px-2">Total Fare (SLE)</span>
                        <input type="number" placeholder="Amount" value={offerAmount} onChange={e => setOfferAmount(e.target.value)} className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2" />
                        <div className="flex gap-1">
                          <button onClick={() => setOfferAmount(prev => Math.max(pricingRates[vehicleType]?.min || 1, (Number(prev)||1) - 5).toString())} className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"><Minus size={16}