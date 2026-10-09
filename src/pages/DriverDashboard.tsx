import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { WalletTopUp } from '@/components/WalletTopUp';
import { useWalletAccess } from '@/lib/useWalletAccess';
import { walletFetch } from '@/lib/apiFetch';
import {
  Car, MapPin, Navigation, Power, User, Phone,
  Loader2, X, Smartphone, ArrowUpRight, ArrowDownLeft,
  Users, RefreshCw, Plus, Wallet, Activity, Copy,
  Check, Share2, ArrowRight
} from 'lucide-react';

export function DriverDashboard(props: any) {
  if (props.activeSection === 'trips') {
    return <DriverTrips profile={props.profile} />;
  }

  return <DriverMain {...props} />;
}

function DriverMain({ profile, wallet, activeSection }: any) {
  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferCurrency, setTransferCurrency] = useState<'SLE' | 'USD'>('SLE');
  const [transferError, setTransferError] = useState('');
  const [transferNotice, setTransferNotice] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  const { frozen: isFrozen, approved: isApproved } = useWalletAccess(profile.id);
  const canTransact = !isFrozen && isApproved;

  const monimeAccountId =
    sleWallet?.monime_account_id ||
    sleWallet?.metadata?.monime_account_id ||
    'Pending Setup';

  useEffect(() => {
    if (profile?.id) {
      const accepted = localStorage.getItem(`matmove_policy_${profile.id}`);
      if (!accepted) setShowPolicy(true);
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
      const { response, data } = await walletFetch('/api/get-live-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to read wallet balances.');

      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      if (data.transactions) setTransactions(data.transactions);
    } catch (err) {
      // Keep existing display
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchLiveBalance();
  }, [profile?.id]);

  const handleCopy = async (id: string) => {
    if (!id || id === 'Pending Setup') return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      alert(`Account ID: ${id}`);
    }
  };

  const handleShareReceipt = async (tx: any) => {
    const isCredit = String(tx.balanceImpact).toUpperCase() === 'CREDIT';
    const date = tx.createdAt || tx.created_at || tx.timestamp || tx.date;
    const formattedDate =
      date && !isNaN(new Date(date).getTime())
        ? new Date(date).toLocaleString()
        : 'Recent';

    const text = [
      'MatMove Receipt',
      `Type: ${tx.description || tx.type || 'Transaction'}`,
      `Status: ${tx.status || 'Unknown'}`,
      `Date: ${formattedDate}`,
      `Amount: ${isCredit ? '+' : '-'}${tx.amount?.currency || 'SLE'} ${(Number(tx.amount?.value || 0) / 100).toFixed(2)}`,
      `Transaction ID: ${tx.id}`,
    ].join('\n');

    try {
      if (navigator.share) {
        await navigator.share({ title: 'MatMove Receipt', text });
      } else {
        await navigator.clipboard.writeText(text);
        alert('Receipt copied.');
      }
    } catch {
      // User cancelled share
    }
  };

  const handleCreateUsdWallet = async () => {
    if (!window.confirm('Create a USD wallet?')) return;
    setIsCreatingUsd(true);
    try {
      const { response, data, finish } = await walletFetch('/api/create-usd-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to create USD wallet.');

      finish();
      await fetchLiveBalance();
      alert('USD wallet created successfully.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreatingUsd(false);
    }
  };

  // Mapbox initialization
  useEffect(() => {
    if (map.current || !mapContainer.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    try {
      mapboxgl.accessToken = token;
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [-13.234, 8.484],
        zoom: 13
      });

      const observer = new ResizeObserver(() => { map.current?.resize(); });
      observer.observe(mapContainer.current);

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { longitude, latitude } = pos.coords;
            map.current?.flyTo({ center: [longitude, latitude], zoom: 15 });
            new mapboxgl.Marker({ color: '#10B981' }).setLngLat([longitude, latitude]).addTo(map.current!);
          },
          () => {},
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Radar logic
  useEffect(() => {
    if (!isOnline) {
      setActiveRequests([]);
      return;
    }

    const fetchInitialRequests = async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, rider:profiles!rider_id(full_name, phone, phone_number)')
        .or(`status.eq.pending,driver_id.eq.${profile.id}`)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (data) setActiveRequests(data);
    };

    void fetchInitialRequests();

    const channel = supabase
      .channel('driver-radar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        void fetchInitialRequests();
        void fetchLiveBalance();
      })
      .subscribe();

    const timer = setInterval(() => void fetchInitialRequests(), 3000);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [isOnline, profile?.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!canTransact) return alert('You must be approved and unfrozen to accept trips.');
    setAcceptingId(booking.id);
    try {
      const res = await fetch('/api/accept-ride-escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          riderId: booking.rider_id,
          driverId: profile.id,
          amount: booking.fare_amount
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to move funds to Escrow');

      setActiveRequests(prev => prev.map(r => r.id === booking.id ? { ...r, status: 'accepted', driver_id: profile.id } : r));
      await fetchLiveBalance();
    } catch (err: any) {
      alert('Acceptance Failed: ' + err.message);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleStartRide = async (booking: any) => {
    setAcceptingId(booking.id);
    try {
      const res = await fetch('/api/start-ride', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start ride');

      setActiveRequests(prev => prev.map(r => r.id === booking.id ? { ...r, status: 'in_progress' } : r));
    } catch (err: any) {
      alert('Failed: ' + err.message);
    } finally {
      setAcceptingId(null);
    }
  };

  const closeModals = () => {
    if (isProcessingPayout || isProcessingTransfer) return;
    setIsLoadModalOpen(false);
    setIsPayoutModalOpen(false);
    setIsTransferModalOpen(false);
    setPayoutAmount('');
    setPayoutPhone('');
    setTransferAmount('');
    setTransferRecipient('');
    setTransferError('');
    setTransferNotice('');
  };

  const executePayout = async () => {
    if (isProcessingPayout || !canTransact) return;

    const amt = Number(payoutAmount);
    if (!Number.isFinite(amt) || amt <= 0) return alert('Enter a valid amount.');

    if (sleWallet?.balanceAvailable === false) {
      return alert('Refresh your wallet balance before withdrawing.');
    }

    if (amt > Number(sleWallet?.balance || 0)) {
      return alert('The withdrawal amount exceeds your available SLE balance.');
    }

    if (!payoutPhone.trim()) {
      return alert('Enter your mobile money phone number.');
    }

    setIsProcessingPayout(true);

    try {
      const { response, data, finish } = await walletFetch(
        '/api/create-monime-payout',
        {
          amount: payoutAmount,
          currency: 'SLE',
          destinationPhone: payoutPhone,
          networkProvider
        }
      );

      if (!response.ok) {
        throw new Error(data.error || 'Payout could not be submitted.');
      }

      if (data.data?.status === 'completed') finish();

      alert(
        data.data?.status === 'completed'
          ? 'Payout completed successfully.'
          : 'Payout submitted. Check your transaction history before initiating another payout.'
      );

      closeModals();
      await fetchLiveBalance();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsProcessingPayout(false);
    }
  };

  const executeTransfer = async () => {
    if (isProcessingTransfer) return;

    if (!canTransact) {
      setTransferError('Wallet access is unavailable.');
      return;
    }

    if (!/^fac-[A-Za-z0-9_-]+$/.test(transferRecipient.trim())) {
      setTransferError('Enter the recipient MatMove account ID.');
      return;
    }

    setIsProcessingTransfer(true);
    setTransferError('');
    setTransferNotice('');

    try {
      const { response, data, finish } = await walletFetch(
        '/api/create-monime-transfer',
        {
          amount: transferAmount,
          currency: transferCurrency,
          recipientAccountId: transferRecipient.trim()
        }
      );

      if (!response.ok) {
        throw new Error(data.error || 'Transfer could not be submitted.');
      }

      const status = data.data?.status;

      setTransferNotice(
        status === 'completed'
          ? 'Transfer completed.'
          : `Transfer ${status || 'submitted'}. Do not create another payment while this transfer is pending.`
      );

      if (status === 'completed' || status === 'failed') {
        finish();
        setTransferAmount('');
      }

      await fetchLiveBalance();
    } catch (err: any) {
      setTransferError(err.message || 'Transfer could not be submitted.');
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  const walletCards = (
    <div className={`grid grid-cols-1 ${activeSection === 'wallet' ? 'md:grid-cols-2' : ''} gap-4`}>
      <div className="bg-slate-900 rounded-3xl p-6 text-white flex justify-between items-center shadow-xl relative">
        <button
          onClick={() => void fetchLiveBalance()}
          disabled={isRefreshing}
          className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'Syncing…' : 'Refresh'}
        </button>

        <div>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
            SLE Ledger
          </span>
          <div className="text-3xl font-bold mt-1 text-emerald-400">
            SLE {sleWallet?.balanceAvailable === false
              ? 'Unavailable'
              : Number(sleWallet?.balance || 0).toFixed(2)}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-800 inline-flex items-center gap-2 px-2 py-1 rounded">
            ID: {monimeAccountId}
            <button onClick={() => void handleCopy(monimeAccountId)} className="hover:text-white transition" aria-label="Copy SLE account ID">
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
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                USD Reserve
              </span>
              <div className="text-3xl font-bold mt-1 text-blue-400">
                USD {usdWallet.balanceAvailable === false
                  ? 'Unavailable'
                  : Number(usdWallet.balance || 0).toFixed(2)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-2 bg-slate-700 inline-flex items-center gap-2 px-2 py-1 rounded">
                ID: {usdWallet.monime_account_id}
                <button onClick={() => void handleCopy(usdWallet.monime_account_id)} className="hover:text-white transition" aria-label="Copy USD account ID">
                  {copiedId === usdWallet.monime_account_id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            <Wallet size={32} className="text-slate-600 mr-2 md:mr-6 pointer-events-none" />
          </>
        ) : (
          <div className="w-full flex flex-col items-center justify-center text-center py-1">
            <button
              onClick={() => void handleCreateUsdWallet()}
              disabled={isCreatingUsd}
              className="bg-slate-700 hover:bg-slate-600 transition p-3 rounded-full mb-2 shadow-inner"
              aria-label="Create USD wallet"
            >
              {isCreatingUsd ? <Loader2 size={24} className="animate-spin text-emerald-400" /> : <Plus size={24} className="text-emerald-400" />}
            </button>
            <span className="text-sm font-bold text-slate-300">Create USD Wallet</span>
          </div>
        )}
      </div>
    </div>
  );

  const validTransactions = Array.isArray(transactions) ? transactions : [];
  const displayedTx = txFilter === 'recent' ? validTransactions.slice(0, 5) : validTransactions;

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">
              {isOnline ? 'You are Online' : 'You are Offline'}
            </h2>
          </div>
        </div>

        <div className="flex gap-2">
          {!canTransact ? (
            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-red-200">
              {isFrozen ? 'Wallet unavailable' : 'Approval pending'}
            </span>
          ) : (
            <>
              <button onClick={() => setIsLoadModalOpen(true)} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-700 transition">
                Load
              </button>
              <button onClick={() => setIsPayoutModalOpen(true)} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">
                Withdraw
              </button>
              <button onClick={() => setIsTransferModalOpen(true)} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-800 transition">
                Transfer
              </button>
            </>
          )}
        </div>
      </header>

      {activeSection === 'home' && (
        <div className="flex-1 flex flex-col lg:flex-row">
          <div className="w-full lg:w-[450px] bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
            {walletCards}
            <h3 className="font-bold text-xl text-slate-900 pt-2">Dispatch Radar</h3>

            {!isOnline ? (
              <div className="border-2 border-dashed border-slate-300 bg-slate-100 rounded-3xl p-12 text-center text-slate-400">
                <Power size={48} className="mx-auto mb-4" />
                <p>Go online to receive live ride and delivery requests.</p>
              </div>
            ) : activeRequests.length === 0 ? (
              <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-3xl p-12 text-center text-emerald-600 animate-pulse">
                <Car size={48} className="mx-auto mb-4" />
                <p className="font-bold">Listening for nearby requests…</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeRequests.map(r => (
                  <div key={r.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
                        {r.service_type}
                      </span>
                      <div>
                        <span className="text-2xl font-bold text-slate-900 block text-right">
                          SLE {r.fare_amount}
                        </span>
                        <span className="text-[10px] font-bold text-emerald-600 block text-right bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 mt-1">
                          Take-Home: SLE {(r.fare_amount * 0.85).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                        <MapPin size={14} className="text-emerald-500 shrink-0" />
                        Pickup: {r.pickup_location}
                      </div>
                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                        <Navigation size={14} className="text-blue-500 shrink-0" />
                        Dropoff: {r.destination_location}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1.5">
                        <User size={14} className="text-slate-400" />
                        {r.rider?.full_name || 'Rider Customer'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Phone size={14} className="text-slate-400" />
                        {r.rider?.phone || r.rider?.phone_number || 'No Phone'}
                      </span>
                    </div>

                    {r.status === 'pending' && (
                      <button
                        onClick={() => void handleAcceptBooking(r)}
                        disabled={acceptingId === r.id || !canTransact}
                        className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 disabled:opacity-50"
                      >
                        {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Accept Request'}
                      </button>
                    )}

                    {r.status === 'accepted' && r.driver_id === profile.id && (
                      <button
                        onClick={() => void handleStartRide(r)}
                        disabled={acceptingId === r.id}
                        className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 disabled:opacity-50"
                      >
                        {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Arrived / Start Ride'}
                      </button>
                    )}

                    {r.status === 'in_progress' && r.driver_id === profile.id && (
                      <div className="w-full bg-amber-100 text-amber-800 font-bold py-3.5 rounded-xl text-center text-sm border border-amber-200 flex items-center justify-center gap-2 shadow-inner">
                        <Loader2 size={16} className="animate-spin" /> Waiting for Rider to Pay…
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-1 lg:col-span-2 bg-slate-200 rounded-3xl overflow-hidden relative min-h-[300px] h-[350px] md:h-[450px] lg:h-[600px] w-full border border-slate-200 shadow-inner z-0 flex flex-col">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full flex-1" />
          </div>
        </div>
      )}

      {activeSection === 'wallet' && (
        <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">
            My Wallets
          </h2>

          {walletCards}

          <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Wallet Actions
            </h3>
            <p className="text-sm text-slate-500 mb-8">
              Transfers support SLE to SLE and USD to USD
            </p>

            {!canTransact && (
              <p className="mb-4 text-sm text-red-700 bg-red-50 p-3 rounded-xl w-full">
                {isFrozen
                  ? 'Your wallet is frozen. Contact support.'
                  : 'Your account must be approved before transactions.'}
              </p>
            )}

            <div className="grid grid-cols-3 gap-4 w-full">
              <button
                onClick={() => setIsLoadModalOpen(true)}
                disabled={!canTransact}
                className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
              >
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <ArrowDownLeft size={24} />
                </div>
                Load
              </button>

              <button
                onClick={() => setIsPayoutModalOpen(true)}
                disabled={!canTransact}
                className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
              >
                <ArrowUpRight size={24} /> Withdraw
              </button>

              <button
                onClick={() => setIsTransferModalOpen(true)}
                disabled={!canTransact}
                className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
              >
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <Users size={24} />
                </div>
                Transfer
              </button>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Activity size={20} className="text-blue-600" /> Transactions
              </h3>
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button
                  onClick={() => setTxFilter('recent')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${txFilter === 'recent' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                >
                  Recent
                </button>
                <button
                  onClick={() => setTxFilter('all')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${txFilter === 'all' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                >
                  All Time
                </button>
              </div>
            </div>

            {displayedTx.length === 0 ? (
              <div className="text-center text-slate-500 py-6">
                No transactions found.
              </div>
            ) : (
              <div className="space-y-3">
                {displayedTx.map(tx => {
                  if (!tx) return null;

                  const isCredit = String(tx.balanceImpact).toUpperCase() === 'CREDIT';
                  const dateStr =
                    tx.createdAt || tx.created_at ||
                    tx.timestamp || tx.date || tx.createdOn;
                  const isValidDate = dateStr && !isNaN(new Date(dateStr).getTime());
                  const formattedDate = isValidDate
                    ? new Date(dateStr).toLocaleString()
                    : 'Date pending';

                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-full ${isCredit ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                          {isCredit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">
                            {tx.description || tx.type || 'Transfer'}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {formattedDate}
                          </p>
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-4">
                        <div>
                          <p className={`font-bold ${isCredit ? 'text-emerald-600' : 'text-slate-900'}`}>
                            {isCredit ? '+' : '-'}{' '}
                            {tx.amount?.currency || 'SLE'}{' '}
                            {((tx.amount?.value || 0) / 100).toFixed(2)}
                          </p>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {tx.status}
                          </span>
                        </div>
                        <button
                          onClick={() => void handleShareReceipt(tx)}
                          className="text-slate-400 hover:text-blue-600 transition p-2 rounded-full hover:bg-white"
                          title="Copy Receipt"
                        >
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

      {isLoadModalOpen && (
        <WalletTopUp
          userId={profile.id}
          allowed={canTransact}
          onClose={() => setIsLoadModalOpen(false)}
          onPaid={fetchLiveBalance}
        />
      )}

      {isPayoutModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} disabled={isProcessingPayout} className="absolute top-4 right-4 text-slate-400">
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold mb-1">Mobile Payout</h2>
            <p className="text-sm text-slate-500 mb-6">
              Available: SLE {sleWallet?.balanceAvailable === false ? 'Unavailable' : Number(sleWallet?.balance || 0).toFixed(2)}
            </p>

            <div className="space-y-4 mb-6">
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount (SLE)"
                value={payoutAmount}
                disabled={isProcessingPayout}
                onChange={e => setPayoutAmount(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-emerald-500"
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setNetworkProvider('orange')}
                  disabled={isProcessingPayout}
                  className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-500'}`}
                >
                  Orange Money
                </button>
                <button
                  onClick={() => setNetworkProvider('afrimoney')}
                  disabled={isProcessingPayout}
                  className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'afrimoney' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-slate-200 text-slate-500'}`}
                >
                  Afrimoney
                </button>
              </div>

              <input
                type="tel"
                inputMode="tel"
                placeholder="e.g. 077123456 or 030123456"
                value={payoutPhone}
                disabled={isProcessingPayout}
                onChange={e => setPayoutPhone(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <button
              onClick={() => void executePayout()}
              disabled={!canTransact || isProcessingPayout || !payoutAmount || !payoutPhone}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50"
            >
              {isProcessingPayout ? <Loader2 size={20} className="animate-spin" /> : <ArrowUpRight size={20} />}
              {isProcessingPayout ? 'Processing…' : 'Confirm Payout'}
            </button>
          </div>
        </div>
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} disabled={isProcessingTransfer} className="absolute top-4 right-4 text-slate-400">
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold mb-1">Account Transfer</h2>

            <label className="block my-4 text-sm font-bold">
              Send from
              <select
                value={transferCurrency}
                disabled={isProcessingTransfer}
                onChange={e => {
                  setTransferCurrency(e.target.value as 'SLE' | 'USD');
                  setTransferError('');
                  setTransferNotice('');
                }}
                className="block w-full rounded-xl border p-3 mt-2"
              >
                <option value="SLE">SLE wallet → SLE account</option>
                <option value="USD">USD wallet → USD account</option>
              </select>
            </label>

            {transferError && (
              <p role="alert" className="mb-3 text-sm text-red-700">{transferError}</p>
            )}
            {transferNotice && (
              <p role="status" className="mb-3 text-sm text-blue-700">{transferNotice}</p>
            )}

            <p className="text-sm text-slate-500 mb-6">
              Paste the recipient's account ID for the selected currency.
            </p>

            <div className="space-y-4 mb-6">
              <input
                type="number"
                min="0.01"
                step="0.01"
                disabled={isProcessingTransfer}
                placeholder={`Amount (${transferCurrency})`}
                value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500"
              />
              <input
                type="text"
                disabled={isProcessingTransfer}
                placeholder="Recipient account ID (fac-...)"
                value={transferRecipient}
                onChange={e => setTransferRecipient(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500"
              />
            </div>

            <button
              onClick={() => void executeTransfer()}
              disabled={!canTransact || isProcessingTransfer || !transferAmount || !transferRecipient}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50"
            >
              {isProcessingTransfer ? <Loader2 size={20} className="animate-spin" /> : <Users size={20} />}
              Send Transfer
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!profile?.id) return;
    const { data, error: queryError } = await supabase
      .from('bookings')
      .select('*, rider:rider_id(full_name)')
      .eq('driver_id', profile.id)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
    } else {
      setTrips(data || []);
      setError('');
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void refresh();

    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [profile?.id]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Earnings History</h1>
        <button onClick={() => void refresh()} className="border bg-white px-4 py-2 rounded-xl text-sm font-bold">
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="bg-red-50 text-red-700 p-3 rounded-xl">{error}</p>
      )}

      {loading ? (
        <p>Loading earnings history…</p>
      ) : trips.length === 0 && !error ? (
        <div className="text-center text-slate-500 py-10">No trips completed yet.</div>
      ) : trips.map(t => (
        <div key={t.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-center">
          <div>
            <div className="font-bold text-slate-900 capitalize">
              {t.service_type} - {t.rider?.full_name || 'Rider Customer'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {new Date(t.created_at).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-lg text-emerald-600">
              + SLE {(Number(t.fare_amount || 0) * 0.85).toFixed(2)}
            </div>
            <div className={`text-[10px] font-bold uppercase mt-1 ${t.status === 'completed' ? 'text-emerald-500' : 'text-slate-400'}`}>
              {t.status}
            </div>
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
          <p className="text-xs text-slate-400 mt-1">
            Sierra Leone Road Safety Authority (SLRSA) Guidelines
          </p>
        </div>

        <div className="p-6 overflow-y-auto flex-1 text-sm text-slate-600 space-y-4">
          <p>
            <strong>1. Compliance with SLRSA:</strong> All users (Drivers, Riders, and Merchants) must strictly adhere to the traffic rules and regulations set forth by the Sierra Leone Road Safety Authority (SLRSA).
          </p>
          <p>
            <strong>2. Liability & Accidents:</strong> MatMove Enterprise acts solely as a technology platform connecting users. MatMove is not liable for any road traffic accidents, injuries, loss of property, or damages that occur during transit.
          </p>
          <p>
            <strong>3. Vehicle Safety:</strong> Drivers must ensure their vehicles (Keke, Bike, Car, Van) are roadworthy, insured, and licensed.
          </p>
          <p>
            <strong>4. Account Suspension:</strong> Any violation of these safety policies or reports of reckless behavior will result in immediate wallet freezing and account suspension.
          </p>
          <p className="font-bold text-slate-900 pt-2 border-t">
            By clicking "I Accept", you acknowledge that you have read, understood, and agree to be bound by this policy. All rights reserved by MatMove Enterprise.
          </p>
        </div>

        <div className="p-4 border-t bg-slate-50 shrink-0">
          <button
            onClick={onAccept}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md"
          >
            I Accept & Agree
          </button>
        </div>
      </div>
    </div>
  );
}