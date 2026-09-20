import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Wallet, Plus, Package, RefreshCw, X, Loader2, ArrowUpRight, MapPin, Navigation, Car, CalendarClock, Smartphone, CreditCard, Upload } from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

export function MerchantDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'inventory') return <MerchantInventory profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isApproved = profile?.kyc_status === 'approved';

  // Request & Map State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [activeInput, setActiveInput] = useState<'pickup' | 'destination' | null>(null);

  const [serviceType, setServiceType] = useState<ServiceType>('delivery');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [isRequesting, setIsRequesting] = useState(false);

  // Modals
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [loadMethod, setLoadMethod] = useState<'flot' | 'monime' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    // @ts-ignore
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
      const { data } = await supabase.from('wallets').select('balance').eq('user_id', profile.id).single();
      if (data) setLiveBalance(Number(data.balance));
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-13.234, 8.484], zoom: 12 });
  }, []);

  const searchPlaces = (query: string, type: 'pickup' | 'destination') => {
    if (type === 'pickup') { setPickup(query); setPickupCoords(null); } else { setDestination(query); setDestinationCoords(null); }
    if (query.trim().length < 3) { type === 'pickup' ? setPickupSuggestions([]) : setDestinationSuggestions([]); return; }
    // @ts-ignore
    if (!window.google) return;
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

  const handleDispatchDelivery = async () => {
    if (!pickup || !destination) return alert('Select pickup and dropoff locations.');
    setIsRequesting(true);
    try {
      const { error } = await supabase.from('bookings').insert({
        rider_id: profile.id,
        service_type: serviceType,
        vehicle_type: vehicleType,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: 0,
        status: 'pending_admin'
      });
      if (error) throw error;
      alert('Dispatch request sent to Dispatch Admin!');
      setPickup(''); setDestination('');
    } catch (err: any) { alert(err.message); } finally { setIsRequesting(false); }
  };

  const executeLoadWallet = async () => {
    if (!loadAmount || !loadMethod) return alert('Enter amount and select payment method.');
    setIsProcessing(true);
    try {
      const endpoint = loadMethod === 'flot' ? '/api/create-flot-checkout' : '/api/create-monime-checkout';
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: loadAmount, userId: profile.id, email: profile.email, phone: profile.phone, role: 'merchant' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment failed');
      const redirectUrl = data.link || data.checkoutUrl;
      if (redirectUrl) window.location.href = redirectUrl;
    } catch (err: any) { alert(err.message); setIsProcessing(false); }
  };

  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > liveBalance) return alert('Insufficient balance');
    if (!withdrawPhone.trim()) return alert('Enter valid Mobile Money number');
    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-monime-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: withdrawPhone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
      alert(`Cashout requested! Pending Admin approval.`);
      setIsWithdrawModalOpen(false); fetchLiveBalance();
    } catch (err: any) { alert(err.message); } finally { setIsWithdrawing(false); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen" onClick={() => setActiveInput(null)}>
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div><h2 className="font-bold text-slate-900 leading-tight">{profile?.business_name || profile?.full_name || 'Merchant Store'}</h2></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setIsProcessing(false); setLoadAmount(''); setLoadMethod(null); setIsLoadModalOpen(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm">+ Load Wallet</button>
          <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm ${isApproved ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>Withdraw</button>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="bg-orange-600 rounded-3xl p-8 text-white relative shadow-lg">
          <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
             <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
          </button>
          <span className="text-orange-200 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
          <div className="text-5xl font-bold mt-2">SLE {liveBalance.toFixed(2)}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit">
            <h3 className="font-bold text-lg">Dispatch Request</h3>
            
            <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
              <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
              <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
            </div>

            <div className="space-y-3">
               <div className="relative z-30" onClick={e => e.stopPropagation()}>
                 <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'pickup' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
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
                 <div className={`flex items-center gap-2 border p-3 rounded-xl transition ${activeInput === 'destination' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
                   <Navigation size={16} className="text-blue-600 shrink-0" />
                   <input type="text" placeholder="Customer Dropoff Location" value={destination} onChange={e => searchPlaces(e.target.value, 'destination')} onFocus={() => setActiveInput('destination')} className="w-full outline-none text-sm bg-transparent" />
                 </div>
                 {activeInput === 'destination' && destinationSuggestions.length > 0 && (
                   <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-[9999]">
                     {destinationSuggestions.map((s, i) => <button key={i} onClick={() => handleSelectPlace(s.place_id, s.description, 'destination')} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100"><div className="text-sm font-bold text-slate-900">{s.structured_formatting?.main_text || s.description}</div></button>)}
                   </div>
                 )}
               </div>

               <button onClick={handleDispatchDelivery} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-2">
                 {isRequesting ? <Loader2 className="animate-spin mx-auto"/> : 'Request Delivery Driver'}
               </button>
            </div>
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
            <h2 className="text-2xl font-bold mb-1">Load Unified Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Choose how you want to fund your account.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button onClick={() => setLoadMethod('monime')} className={`p-4 border rounded-xl flex flex-col items-center gap-2 ${loadMethod === 'monime' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-500'}`}><Smartphone size={24} /> <span className="text-xs">Mobile Money</span></button>
              <button onClick={() => setLoadMethod('flot')} className={`p-4 border rounded-xl flex flex-col items-center gap-2 ${loadMethod === 'flot' ? 'border-blue-500 bg-blue-50 text-blue-700 font-bold' : 'border-slate-200 text-slate-500'}`}><CreditCard size={24} /> <span className="text-xs">Bank Card</span></button>
            </div>
            <button onClick={executeLoadWallet} disabled={isProcessing || !loadAmount || !loadMethod} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center gap-2 disabled:opacity-50">{isProcessing ? <Loader2 className="animate-spin" size={20} /> : 'Proceed to Checkout'}</button>
          </div>
        </div>
      )}

      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Store Funds</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer balance to Mobile Money via Monime.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none" />
              <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none" />
            </div>
            <button onClick={executeWithdrawal} disabled={isWithdrawing || !withdrawAmount} className="w-full bg-emerald-600 text-white font-bold p-4 rounded-xl flex justify-center gap-2 disabled:opacity-50">{isWithdrawing ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Cashout</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MerchantInventory({ profile }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from('products').select('*').eq('merchant_id', profile.id).order('created_at', { ascending: false });
    if (data) setProducts(data);
    setLoading(false);
  };

  useEffect(() => { fetchProducts(); }, [profile.id]);

  // IMAGE FILE ATTACHMENT CONVERTER
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) return alert('File size must be under 2MB.');
      const reader = new FileReader();
      reader.onloadend = () => setImageUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !price) return alert('Name and Price are required');
    setIsSaving(true);
    try {
      const { error } = await supabase.from('products').insert({
        merchant_id: profile.id,
        name,
        price: Number(price),
        description,
        image_url: imageUrl || null
      });
      if (error) throw error;
      setIsAddModalOpen(false);
      setName(''); setPrice(''); setDescription(''); setImageUrl('');
      fetchProducts();
    } catch (err: any) { alert(err.message); } finally { setIsSaving(false); }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div><h1 className="text-3xl font-bold text-slate-900">Store Inventory</h1><p className="text-sm text-slate-500">Manage products available in the Rider Shop.</p></div>
        <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-md"><Plus size={18}/> Add Product</button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2" size={24} /> Loading inventory...</div>
      ) : products.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center text-slate-400 shadow-sm mt-10">
          <Package size={64} className="mx-auto mb-6 text-slate-200" />
          <h3 className="font-bold text-xl text-slate-900">No products listed</h3>
          <p className="text-sm mt-2 text-slate-500">Click "Add Product" to create your first listing for Riders to buy.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm p-4">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="w-full h-36 object-cover rounded-xl mb-3" />
              ) : (
                <div className="w-full h-36 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 mb-3"><Package size={32} /></div>
              )}
              <h3 className="font-bold text-slate-900 text-base">{p.name}</h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
              <div className="text-lg font-bold text-slate-900 mt-3">SLE {p.price}</div>
            </div>
          ))}
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl space-y-4">
            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold">Add New Product</h2>
            <form onSubmit={handleAddProduct} className="space-y-4">
              <input required type="text" placeholder="Product Name" value={name} onChange={e=>setName(e.target.value)} className="w-full border p-3 rounded-xl outline-none text-sm" />
              <input required type="number" placeholder="Price (SLE)" value={price} onChange={e=>setPrice(e.target.value)} className="w-full border p-3 rounded-xl outline-none text-sm font-bold" />
              <textarea placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)} className="w-full border p-3 rounded-xl outline-none text-sm" rows={3} />
              
              {/* IMAGE FILE ATTACHMENT */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-500 uppercase">Product Image Attachment</label>
                <input type="file" accept="image/*" onChange={handleImageFileChange} className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                {imageUrl && <img src={imageUrl} alt="Preview" className="h-20 w-20 object-cover rounded-xl mt-2 border" />}
              </div>

              <button type="submit" disabled={isSaving} className="w-full bg-slate-900 text-white font-bold p-3.5 rounded-xl flex justify-center">{isSaving ? <Loader2 className="animate-spin" size={18}/> : 'Save Product'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}