import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Car, MapPin, Navigation, Power, User, Phone, Loader2, X, Smartphone, ArrowUpRight, ArrowDownLeft, Users, RefreshCw, Plus, Wallet, Activity, Copy, Check, Share2, ArrowLeftRight } from 'lucide-react';

export function DriverDashboard({ profile, wallet, activeSection, onOpenWallet }: any) {
  if (activeSection === 'trips') return <DriverTrips profile={profile} />;

  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exchangeRateUsdToSle, setExchangeRateUsdToSle] = useState(24.68);

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isOnline, setIsOnline] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const isApproved = profile?.kyc_status === 'approved';
  
  const monimeAccountId = sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || 'Pending Setup';

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

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

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [showPolicy, setShowPolicy] = useState(false);
  const [isFrozen, setIsFrozen] = useState(wallet?.is_frozen || false);

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
    const channel = supabase.channel('driver-radar').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchInitialRequests(); fetchLiveBalance(); }).subscribe();
    const syncInterval = setInterval(fetchInitialRequests, 3000);
    return () => { supabase.removeChannel(channel); clearInterval(syncInterval); };
  }, [isOnline, profile?.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    setAcceptingId(booking.id);
    try {
      const res = await fetch('/api/accept-ride-escrow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: booking.id, riderId: booking.rider_id, driverId: profile.id, amount: booking.fare_amount }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to move funds to Escrow');
      setActiveRequests(prev => prev.map(r => r.id === booking.id ? { ...r, status: 'accepted', driver_id: profile.id } : r));
      fetchLiveBalance();
    } catch (err: any) { alert('Acceptance Failed: ' + err.message); } finally { setAcceptingId(null); }
  };

  const handleStartRide = async (booking: any) => {
    setAcceptingId(booking.id);
    try { 
       const res = await fetch('/api/start-ride', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: booking.id }) });
       const data = await res.json();
       if (!res.ok) throw new Error(data.error || 'Failed to start ride');
       setActiveRequests(prev => prev.map(r => r.id === booking.id ? { ...r, status: 'in_progress' } : r));
    } catch (err: any) { alert('Failed: ' + err.message); } finally { setAcceptingId(null); }
  };

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false); setIsConvertModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); setIsProcessingConvert(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone(''); setConvertAmount('');
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
      alert(`Payout requested successfully! Locking app for security.`);
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
      alert(`Internal transfer successful! Locking app for security.`);
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
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">SLE Ledger</span>
          <div className="text-3xl font-bold mt-1 text-emerald-400">SLE {Number(sleWallet?.balance || 0).toFixed(2)}</div>
          <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-800 inline-flex items-center gap-2 px-2 py-1 rounded">
             ID: {monimeAccountId}
             <button onClick={() => handleCopy(monimeAccountId)} className="hover:text-white transition">
                {copiedId === monimeAccountId ? <Check size={12} className="text-emerald-400"/> : <Copy size={12}/>}
             </button>
          </div>
        </div>
        <Wallet size={32} className="text-slate-700 mr-2 md:mr-6 pointer-events-none" />
      </div>

      <div className="bg-slate-800 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl border border-slate-700 relative">
        {usdWallet?.monime_account_id ? (
          <>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">USD Reserve</span>
              <div className="text-3xl font-bold mt-1 text-blue-400">USD {Number(usdWallet.balance || 0).toFixed(2)}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-700 inline-flex items-center gap-2 px-2 py-1 rounded">
                 ID: {usdWallet.monime_account_id}
                 <button onClick={() => handleCopy(usdWallet.monime_account_id)} className="hover:text-white transition">
                    {copiedId === usdWallet.monime_account_id ? <Check size={12} className="text-emerald-400"/> : <Copy size={12}/>}
                 </button>
              </div>
            </div>
            <Wallet size={32} className="text-slate-600 mr-2 md:mr-6 pointer-events-none" />
          </>
        ) : (
          <div className="w-full flex flex-col items-center justify-center text-center py-1">
            <button onClick={handleCreateUsdWallet} disabled={isCreatingUsd} className="bg-slate-700 hover:bg-slate-600 transition p-3 rounded-full mb-2 shadow-inner">
              {isCreatingUsd ? <Loader2 className="animate-spin text-emerald-400" size={24} /> : <Plus size={24} className="text-emerald-400" />}
            </button>
            <span className="text-sm font-bold text-slate-300">Create USD Wallet</span>
          </div>
        )}
      </div>
    </div>
  );

  const displayedTx = txFilter === 'recent' ? transactions.slice(0, 5) : transactions;

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

      {activeSection === 'home' && (
        <div className="flex-1 flex flex-col lg:flex-row">
          <div className="w-full lg:w-[450px] bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
            {WalletCards}
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
                         <span className="text-[10px] font-bold text-emerald-600 block text-right bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 mt-1">Take-Home: SLE {(r.fare_amount * 0.85).toFixed(2)}</span>
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

                     {r.status === 'pending' && (
                       <button onClick={() => handleAcceptBooking(r)} disabled={acceptingId === r.id} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 disabled:opacity-50">
                         {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Accept Request'}
                       </button>
                     )}
                     
                     {r.status === 'accepted' && r.driver_id === profile.id && (
                       <button onClick={() => handleStartRide(r)} disabled={acceptingId === r.id} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 disabled:opacity-50">
                         {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Arrived / Start Ride'}
                       </button>
                     )}

                     {r.status === 'in_progress' && r.driver_id === profile.id && (
                       <div className="w-full bg-amber-100 text-amber-800 font-bold py-3.5 rounded-xl text-center text-sm border border-amber-200 flex items-center justify-center gap-2 shadow-inner">
                         <Loader2 size={16} className="animate-spin" /> Waiting for Rider to Pay...
                       </div>
                     )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 bg-slate-200 relative min-h-[450px]">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
      )}

      {activeSection === 'wallet' && (
        <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
           <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">My Wallets</h2>
           {WalletCards}
           
           <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
             <h3 className="text-xl font-bold text-slate-900 mb-2">Wallet Actions</h3>
             <p className="text-sm text-slate-500 mb-8">Manage and convert your funds securely</p>
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
                <button onClick={() => setIsLoadModalOpen(true)} disabled={isFrozen} className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                  <div className="p-3 bg-white rounded-full shadow-sm"><ArrowDownLeft size={24}/></div> Load
                </button>
                <button onClick={() => setIsPayoutModalOpen(true)} disabled={!isApproved || isFrozen} className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                  <div className="p-3 bg-white rounded-full shadow-sm"><ArrowUpRight size={24}/></div> Withdraw
                </button>
                <button onClick={() => setIsTransferModalOpen(true)} disabled={isFrozen} className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                  <div className="p-3 bg-white rounded-full shadow-sm"><Users size={24}/></div> Transfer
                </button>
                <button onClick={() => setIsConvertModalOpen(true)} disabled={!usdWallet?.monime_account_id || isFrozen} className="p-4 sm:p-6 rounded-2xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50">
                  <div className="p-3 bg-white rounded-full shadow-sm"><RefreshCw size={24}/></div> Convert
                </button>
             </div>
           </div>

           <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm w-full">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2"><Activity size={20} className="text-blue-600"/> Transactions</h3>
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
                                          {isCredit ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}
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

      {/* 🔴 2-WAY CONVERT MODAL */}
      {isConvertModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Convert Currency</h2>
            <p className="text-sm text-slate-500 mb-4">Rate: 1 USD = SLE {exchangeRateUsdToSle}</p>
            
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
              {isProcessingConvert ? <Loader2 className="animate-spin" size={20} /> : <><ArrowLeftRight size={20} /> Convert Now</>}
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

function DriverTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { 
    if (!profile?.id) return;
    supabase.from('bookings').select('*, rider:rider_id(full_name)').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); 
  }, [profile?.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Earnings History</h1>
      {trips.length === 0 ? <div className="text-center text-slate-500 py-10">No trips completed yet.</div> : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div>
             <div className="font-bold text-slate-900 capitalize">{t.service_type} - {t.rider?.full_name || 'Rider Customer'}</div>
             <div className="text-xs text-slate-500 mt-1">{new Date(t.created_at).toLocaleString()}</div>
          </div>
          <div className="text-right">
             <div className="font-bold text-lg text-emerald-600">+ SLE {(t.fare_amount * 0.85).toFixed(2)}</div>
             <div className={`text-[10px] font-bold uppercase mt-1 ${t.status==='completed'?'text-emerald-500':'text-slate-400'}`}>{t.status}</div>
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