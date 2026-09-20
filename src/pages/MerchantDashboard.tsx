import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Wallet, Plus, Package, RefreshCw, X, Loader2, ArrowUpRight, MapPin, Navigation, Car, CalendarClock, Smartphone, CreditCard, Lock } from 'lucide-react';

export function MerchantDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'inventory') return <MerchantInventory profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isApproved = profile?.kyc_status === 'approved';

  // Request State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);
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

  const handleDispatchDelivery = async () => {
    if (!pickup || !destination) return alert('Enter pickup and destination.');
    setIsRequesting(true);
    try {
      const { error } = await supabase.from('bookings').insert({
        rider_id: profile.id,
        service_type: 'delivery',
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: 0,
        status: 'pending_admin'
      });
      if (error) throw error;
      alert('Delivery dispatch requested! Sent to Dispatch Admin.');
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
      window.location.href = data.link || data.checkoutUrl;
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
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div><h2 className="font-bold text-slate-900 leading-tight">{profile?.business_name || profile?.full_name || 'Merchant Store'}</h2></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm">+ Load Wallet</button>
          <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm ${isApproved ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>Withdraw</button>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="bg-orange-600 rounded-3xl p-8 text-white relative shadow-lg">
          <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold">
             <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
          </button>
          <span className="text-orange-200 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
          <div className="text-5xl font-bold mt-2">SLE {liveBalance.toFixed(2)}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit">
            <h3 className="font-bold text-lg">Dispatch Delivery</h3>
            <div className="space-y-3">
               <div className="border border-slate-200 rounded-xl p-3 flex items-center gap-3">
                 <MapPin className="text-emerald-500" size={20} />
                 <input type="text" placeholder="Store Pickup Location" value={pickup} onChange={e=>setPickup(e.target.value)} className="w-full outline-none bg-transparent text-sm" />
               </div>
               <div className="border border-slate-200 rounded-xl p-3 flex items-center gap-3">
                 <Navigation className="text-blue-500" size={20} />
                 <input type="text" placeholder="Customer Dropoff Location" value={destination} onChange={e=>setDestination(e.target.value)} className="w-full outline-none bg-transparent text-sm" />
               </div>
               <button onClick={handleDispatchDelivery} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md">
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
              <button onClick={() => setLoadMethod('monime')} className={`p-4 border rounded-xl flex flex-col items-center gap-2 ${loadMethod === 'monime' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}><Smartphone size={24} /> <span className="text-xs font-bold">Mobile Money</span></button>
              <button onClick={() => setLoadMethod('flot')} className={`p-4 border rounded-xl flex flex-col items-center gap-2 ${loadMethod === 'flot' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}><CreditCard size={24} /> <span className="text-xs font-bold">Bank Card</span></button>
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
              {p.image_url && <img src={p.image_url} alt={p.name} className="w-full h-36 object-cover rounded-xl mb-3" />}
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
              <input type="url" placeholder="Image URL (e.g., Supabase bucket link)" value={imageUrl} onChange={e=>setImageUrl(e.target.value)} className="w-full border p-3 rounded-xl outline-none text-sm" />
              <button type="submit" disabled={isSaving} className="w-full bg-slate-900 text-white font-bold p-3.5 rounded-xl flex justify-center">{isSaving ? <Loader2 className="animate-spin" size={18}/> : 'Save Product'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}