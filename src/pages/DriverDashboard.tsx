import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Power, MapPin, Navigation, Wallet, ShieldCheck, Radio, RefreshCw, AlertCircle, Loader2, Lock, X, Smartphone, CreditCard, ArrowUpRight, Package, Car, CalendarClock } from 'lucide-react';

export function DriverDashboard({ profile }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [monimeId, setMonimeId] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [maxRadius, setMaxRadius] = useState<number>(5);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);

  // Modals...
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');

  const isApproved = localProfile?.kyc_status === 'approved';
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

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
      zoom: 13
    });
  }, []);

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();

    const channel = supabase.channel('driver-radar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchInitialRequests(); })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    
    // 15% AUTOMATED COMMISSION CHECK
    const commission = Number((booking.fare_amount * 0.15).toFixed(2));
    if (liveBalance < commission) {
        return alert(`Insufficient funds. You need at least SLE ${commission} in your wallet to cover the 15% platform commission and accept this trip. Please load your wallet.`);
    }

    try {
      const { error } = await supabase.from('bookings').update({ status: 'accepted', driver_id: profile.id }).eq('id', booking.id);
      if (error) throw error;
      fetchLiveBalance(); 
    } catch (err: any) { alert('Failed to accept trip: ' + err.message); }
  };

  const handleCompleteBooking = async (booking: any) => {
    try {
      const { error } = await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
      if (error) throw error;
      alert(`Trip completed! Collection recorded.`);
      fetchLiveBalance(); // Fetch latest balance post-trip
    } catch (err: any) { alert('Failed to complete trip: ' + err.message); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsOnline(!isOnline)} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2>
            <p className="text-xs text-slate-500">{isOnline ? 'Finding trip and delivery requests...' : 'Go online to start receiving trips'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block ml-4">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Driver Ledger</div>
            <div className="text-lg font-bold text-slate-900">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          {!isApproved && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
              <AlertCircle className="text-amber-500 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-amber-900 text-sm">Account Under Review</h4>
                <p className="text-xs text-amber-700 mt-1">Withdrawals are restricted until Admin approval.</p>
              </div>
            </div>
          )}

          <div className="bg-slate-900 text-white border border-slate-800 p-5 rounded-3xl relative overflow-hidden shadow-lg">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <div className="text-slate-400 mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><Wallet size={16} /> Wallet Balance</div>
            <div className="text-3xl font-bold mt-2">SLE {liveBalance.toFixed(2)}</div>
            {monimeId && <div className="mt-3 text-xs text-slate-400 font-mono bg-white/10 px-2 py-1 rounded inline-block">ID: {monimeId}</div>}
          </div>

          <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`w-full font-bold p-3.5 rounded-xl transition shadow-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>
            {isApproved ? 'Withdraw Earnings' : 'Withdrawals Locked'}
          </button>

          <div className="flex-1">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Radio size={18} className="text-blue-600" /> Dispatch Radar
            </h3>
            
            {!isOnline ? (
              <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48">
                <Power className="text-slate-400 mb-2" size={32} />
                <p className="text-sm font-bold text-slate-500">You are offline</p>
              </div>
            ) : activeRequests.filter(r => r.status !== 'completed').length === 0 ? (
              <div className="border-2 border-dashed border-emerald-200 bg-emerald-50 rounded-2xl p-8 text-center flex flex-col items-center justify-center h-48 animate-pulse">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3"><Power size={24} /></div>
                <p className="text-sm font-bold text-emerald-700">Listening for requests...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeRequests.filter(r => r.status !== 'completed').map((b: any) => (
                  <div key={b.id} className={`p-4 border rounded-xl flex flex-col gap-3 shadow-sm ${b.status === 'accepted' ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {b.service_type === 'delivery' ? <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"><Package size={10}/> Delivery</span>
                        : b.service_type === 'scheduled' ? <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"><CalendarClock size={10}/> Scheduled</span>
                        : <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1"><Car size={10}/> {b.vehicle_type || 'Ride'}</span>}
                      </div>
                      
                      <span className="text-sm font-bold text-slate-900">SLE {b.fare_amount}</span>
                      <span className="text-[10px] text-slate-500 ml-2 font-bold uppercase">(Fee: SLE {(b.fare_amount * 0.15).toFixed(2)})</span>
                      {b.scheduled_time && <div className="text-xs font-bold text-emerald-600 mt-1">For: {new Date(b.scheduled_time).toLocaleString()}</div>}
                      
                      <div className="text-xs text-slate-600 mt-2 flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" /> {b.pickup_location}</span>
                        <span className="flex items-center gap-1.5"><Navigation size={14} className="text-slate-400" /> {b.destination_location}</span>
                      </div>
                    </div>
                    {b.status === 'pending' && (
                      <button onClick={() => handleAcceptBooking(b)} className="w-full bg-slate-900 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-slate-800 transition">
                        Accept Request
                      </button>
                    )}
                    {b.status === 'accepted' && b.driver_id === profile.id && (
                      <button onClick={() => handleCompleteBooking(b)} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold text-xs hover:bg-blue-700 transition">
                        Complete & Collect Fare
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 bg-slate-200 relative min-h-[400px]">
          <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        </div>
      </div>
      
      {/* Existing Withdrawal Modal */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Driver Earnings</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer wallet funds to Mobile Money.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none" />
              <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none" />
            </div>
            <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">Confirm Cashout</button>
          </div>
        </div>
      )}
    </div>
  );
}