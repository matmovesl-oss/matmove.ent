import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, MapPin, Navigation, Power, User, Phone, Loader2, X, Smartphone, ArrowUpRight, ArrowDownLeft, Users, RefreshCw } from 'lucide-react';

export function DriverDashboard({ profile, wallet, activeSection, onOpenWallet }: any) {
  if (activeSection === 'trips') return <DriverTrips profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isOnline, setIsOnline] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const isApproved = profile?.kyc_status === 'approved';
  
  const monimeAccountId = wallet?.metadata?.monime_account_id || 'Pending Setup';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  // New Dedicated Modals
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
  const [monimeAccounts, setMonimeAccounts] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (isTransferModalOpen) {
      fetch('/api/get-monime-accounts')
        .then(res => res.json())
        .then(data => {
          if (data.accounts) {
            const otherAccounts = data.accounts.filter((acc: any) => acc.id !== monimeAccountId);
            setMonimeAccounts(otherAccounts);
          }
        })
        .catch(err => console.error("Failed to load Monime accounts:", err));
    }
  }, [isTransferModalOpen, monimeAccountId]);

  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/get-live-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id })
      });
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(Number(data.balance));
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    try {
      mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
      map.current = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/streets-v12', center: [-13.234, 8.484], zoom: 13 });
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*, rider:profiles!rider_id(full_name, phone, phone_number)').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();
    const channel = supabase.channel('driver-radar').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetchInitialRequests).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile?.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    const commission = Number((booking.fare_amount * 0.15).toFixed(2));
    if (liveBalance < commission) return alert(`Insufficient funds. You need at least SLE ${commission} in your wallet to cover the platform commission.`);
    try { await supabase.from('bookings').update({ status: 'accepted', driver_id: profile.id }).eq('id', booking.id); fetchLiveBalance(); } catch (err: any) { alert('Failed: ' + err.message); }
  };

  const handleCompleteBooking = async (booking: any) => {
    try { await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id); alert(`Trip completed! Collection recorded.`); fetchLiveBalance(); } catch (err: any) { alert('Failed to complete: ' + err.message); }
  };

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone('');
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
      closeModals(); fetchLiveBalance();
    } catch (err: any) { alert(err.message); setIsProcessingPayout(false); }
  };

  const executeTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (!transferRecipient.trim()) return alert('Select a recipient account');

    setIsProcessingTransfer(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, recipientAccountId: transferRecipient }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Internal transfer successful!`);
      closeModals(); fetchLiveBalance();
    } catch (err: any) { alert(err.message); setIsProcessingTransfer(false); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsOnline(!isOnline)} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div><h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2></div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-sm">Load</button>
          <button onClick={() => isApproved ? setIsPayoutModalOpen(true) : alert('KYC Approval required')} className={`px-3 py-2 rounded-xl text-xs font-bold transition shadow-sm ${isApproved ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>Payout</button>
          <button onClick={() => isApproved ? setIsTransferModalOpen(true) : alert('KYC Approval required')} className={`px-3 py-2 rounded-xl text-xs font-bold transition shadow-sm ${isApproved ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>Transfer</button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          
          <div className="bg-slate-900 text-white rounded-3xl p-6 relative shadow-lg">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
               <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
            </button>
            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Driver Ledger</span>
            <div className="text-3xl font-bold mt-1 text-emerald-400">SLE {liveBalance.toFixed(2)}</div>
            <div className="text-xs font-mono text-slate-400 mt-2 bg-slate-800 inline-block px-2 py-1 rounded">Account ID: {monimeAccountId}</div>
          </div>

          <h3 className="font-bold text-xl text-slate-900 pt-2">Dispatch Radar</h3>
          {!isOnline ? (
            <div className="border-2 border-dashed border-slate-300 bg-slate-100 rounded-3xl p-12 text-center text-slate-400">
              <Power size={48} className="mx-auto mb-4" />
              <p>Go online to receive live ride and delivery requests.</p>
            </div>
          ) : activeRequests.length === 0 ? (
            <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-3xl p-12 text-center text-emerald-600 animate-pulse">
               <Car size={48} className="mx-auto mb-4" />
               <p className="font-bold">Listening for nearby requests...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeRequests.map(r => (
                <div key={r.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md space-y-3">
                   <div className="flex justify-between items-start">
                     <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">{r.service_type}</span>
                     <div>
                       <span className="text-2xl font-bold text-slate-900 block text-right">SLE {r.fare_amount}</span>
                       <span className="text-[10px] font-bold text-slate-400 block text-right">Fee: SLE {(r.fare_amount * 0.15).toFixed(2)}</span>
                     </div>
                   </div>

                   <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-2">
                     <div className="flex items-center gap-2 font-semibold text-slate-800"><MapPin size={14} className="text-emerald-500 shrink-0"/> Pickup: {r.pickup_location}</div>
                     <div className="flex items-center gap-2 font-semibold text-slate-800"><Navigation size={14} className="text-blue-500 shrink-0"/> Dropoff: {r.destination_location}</div>
                   </div>

                   <div className="flex items-center justify-between text-xs font-bold text-slate-600 pt-1 border-t border-slate-100">
                     <span className="flex items-center gap-1.5"><User size={14} className="text-slate-400"/> {r.rider?.full_name || 'Rider Customer'}</span>
                     <span className="flex items-center gap-1.5"><Phone size={14} className="text-slate-400"/> {r.rider?.phone || r.rider?.phone_number || 'No Phone'}</span>
                   </div>

                   {r.status === 'pending' && <button onClick={() => handleAcceptBooking(r)} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800">Accept Request</button>}
                   {r.status === 'accepted' && r.driver_id === profile.id && <button onClick={() => handleCompleteBooking(r)} className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700">Complete & Collect Fare</button>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 bg-slate-200 relative min-h-[450px]">
          <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        </div>
      </div>

      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <button onClick={executeLoad} disabled={isProcessingLoad || !loadAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingLoad ? <Loader2 className="animate-spin" size={20} /> : <><ArrowDownLeft size={20} /> Checkout</>}
            </button>
          </div>
        </div>
      )}

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

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Internal Transfer</h2>
            <p className="text-sm text-slate-500 mb-6">Send money to another MatMove account.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500" />
              <select value={transferRecipient} onChange={(e) => setTransferRecipient(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500">
                <option value="">Select Account...</option>
                {monimeAccounts.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <button onClick={executeTransfer} disabled={isProcessingTransfer || !transferAmount || !transferRecipient} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingTransfer ? <Loader2 className="animate-spin" size={20} /> : <Users size={20} />} Send Transfer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DriverTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { 
    if (!profile?.id) return;
    supabase.from('bookings').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); 
  }, [profile?.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Earnings History</h1>
      {trips.length === 0 ? <div className="text-center text-slate-500 py-10">No trips completed yet.</div> : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div><div className="font-bold text-slate-900 capitalize">{t.service_type}</div><div className="text-xs text-slate-500 mt-1">{new Date(t.created_at).toLocaleDateString()}</div></div>
          <div className="text-right"><div className="font-bold text-lg text-emerald-600">+ SLE {t.fare_amount}</div><div className="text-[10px] text-slate-500 font-bold uppercase mt-1">{t.status}</div></div>
        </div>
      ))}
    </div>
  );
}