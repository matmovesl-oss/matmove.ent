import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Store, Wallet, RefreshCw, AlertCircle, ShieldCheck, X, Loader2, Lock, Plus, Package, Smartphone, CreditCard, ArrowUpRight, MapPin, Navigation, Car, CalendarClock } from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';

export function MerchantDashboard({ profile }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [monimeId, setMonimeId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Request State
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('delivery');
  const [scheduledTime, setScheduledTime] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Modals...
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
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

  useEffect(() => {
    fetchLiveBalance();
  }, [profile?.id]);

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

  const handleRequest = async () => {
    if (!pickup || !destination) return alert('Enter pickup and destination');
    if (serviceType === 'scheduled' && !scheduledTime) return alert('Select time for scheduled request.');
    const estimate = serviceType === 'delivery' ? 15 : 25;
    
    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
        rider_id: profile.id, // Merchants act as requesters
        service_type: serviceType,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: estimate,
        scheduled_time: serviceType === 'scheduled' ? scheduledTime : null,
        status: 'pending'
      }).select().single();
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert('Request failed: ' + err.message); } 
    finally { setIsRequesting(false); }
  };

  const businessName = localProfile?.business_name || localProfile?.full_name || 'Merchant';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
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
          <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4">
            <h3 className="font-bold text-lg">Dispatch Request</h3>
            <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setServiceType('delivery')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Package size={16}/> Delivery</button>
              <button onClick={() => setServiceType('ride')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}><Car size={16}/> Ride</button>
              <button onClick={() => setServiceType('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}><CalendarClock size={16}/> Schedule</button>
            </div>
            
            {!activeBooking ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border p-3 rounded-xl">
                  <Store size={16} className="text-slate-400" />
                  <input type="text" placeholder="Pickup (Store Location)" value={pickup} onChange={e => setPickup(e.target.value)} className="w-full outline-none text-sm" />
                </div>
                <div className="flex items-center gap-2 border p-3 rounded-xl">
                  <MapPin size={16} className="text-emerald-600" />
                  <input type="text" placeholder="Customer Destination" value={destination} onChange={e => setDestination(e.target.value)} className="w-full outline-none text-sm" />
                </div>
                {serviceType === 'scheduled' && (
                  <div className="flex items-center gap-2 border p-3 rounded-xl">
                    <CalendarClock size={16} className="text-emerald-600" />
                    <input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-full outline-none text-sm text-slate-700" />
                  </div>
                )}
                <button onClick={handleRequest} disabled={isRequesting} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800">
                  {isRequesting ? <Loader2 className="animate-spin mx-auto" /> : `Find Driver`}
                </button>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="font-bold text-slate-900">{activeBooking.status === 'pending' ? 'Dispatching driver...' : 'Driver Assigned'}</p>
                <button onClick={() => setActiveBooking(null)} className="text-xs text-slate-500 underline mt-4">Reset Dashboard</button>
              </div>
            )}
          </div>
          
          {/* Map */}
          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[350px] border border-slate-200">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      </div>
      
      {/* Existing Modals implementation remains exactly the same logic */}
      {/* Top-Up Modal */}
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