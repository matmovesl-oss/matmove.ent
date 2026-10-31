import ActiveTripMap from '@/components/ActiveTripMap';

import FareNegotiation from '@/components/FareNegotiation';
import { readRideFares, type FareSnapshot } from '@/services/fareNegotiationService';
import { applyRideFare, assertDriverFare, mergeRideRow } from '@/lib/useRideNegotiation';
import { loadGoogleMaps } from '@/components/RideLocationPicker';


import WalletCardsView from '@/components/WalletCards';
import TransactionHistory from '@/components/TransactionHistory';

import TripHistory from '@/components/TripHistory';

import PayoutPanel from '@/components/PayoutPanel';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { WalletTopUp } from '@/components/WalletTopUp';
import { TransactionModal } from '@/components/TransactionModal';
import { useWalletAccess } from '@/lib/useWalletAccess';
import { walletFetch } from '@/lib/apiFetch';
import { updateRide, readRidePayment } from '@/services/rideService';
import {
  Car, MapPin, Navigation, Power, User, Phone,
  Loader2, X, Smartphone, ArrowUpRight, ArrowDownLeft,
  Users, RefreshCw, Plus, Wallet, Activity, Copy,
  Check, Share2
} from 'lucide-react';

export function DriverDashboard(props: any) {
  if (props.activeSection === 'trips') {
    return <DriverTrips profile={props.profile} />;
  }

  return <DriverMain key={props.profile.id} {...props} />;
}

function DriverMain({ profile, wallet, activeSection }: any) {
  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [rideNotice, setRideNotice] = useState('');
  const [walletNotice, setWalletNotice] = useState('');
  const balanceBusy = useRef(false);
  const setupBusy = useRef(false);
  const [isSettingUpWallet, setIsSettingUpWallet] = useState(false);
  const [walletSetupError, setWalletSetupError] = useState('');
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<any>(null);

  const onlineKey=`matmove:driver-online:v1:${profile.id}`;
  const [isOnline, setIsOnline] = useState(()=>{try{return localStorage.getItem(onlineKey)==='online';}catch{return false;}});
  const toggleOnline=()=>{const next=!isOnline;try{localStorage.setItem(onlineKey,next?'online':'offline');}catch{setRideNotice('This browser cannot remember your online preference.');}setIsOnline(next);};
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [negotiatingId, setNegotiatingId] = useState<string | null>(null);
  const [fareSnapshots, setFareSnapshots] = useState<Record<string, FareSnapshot>>({});
  const tripMutex = useRef(false);
  const radarMutation = useRef(0);
  const currentDriver = useRef(profile.id);
  currentDriver.current = profile.id;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const applyDriverFare = (snapshot: FareSnapshot) => {
    if (!mounted.current || snapshot.viewerId !== currentDriver.current) return;
    setFareSnapshots(previous => {
      const old = previous[snapshot.bookingId];
      if (old && (snapshot.fareVersion < old.fareVersion || Date.parse(snapshot.serverTime) < Date.parse(old.serverTime))) return previous;
      return { ...previous, [snapshot.bookingId]: snapshot };
    });
    setActiveRequests(previous => previous.map(item => applyRideFare(item, snapshot, profile.id)));
  };
  const fareBlockReason = (booking: any) => {
    if(booking.driver_id&&booking.driver_id!==profile.id)return 'This request is assigned to another driver.';
    if(!Number.isFinite(Number(booking.fare_amount))||Number(booking.fare_amount)<=0)return 'Awaiting a confirmed fare. This request cannot be accepted or charged yet.';
    const snapshot = fareSnapshots[booking.id];
    if (!snapshot) return '';
    try { assertDriverFare(snapshot, booking, profile.id); return ''; }
    catch (error: any) { return error.message; }
  };
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [requestsRetry, setRequestsRetry] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapRetry, setMapRetry] = useState(0);

  const mapContainer = useRef<HTMLDivElement>(null);
  const googleMap = useRef<google.maps.Map | null>(null);

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
  const [transferNotice,setTransferNotice] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  const { frozen: isFrozen, approved: isApproved } = useWalletAccess(profile.id);
  const canTransact = !isFrozen && isApproved;

  const monimeAccountId = sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || 'Pending Setup';

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
    if (!profile?.id || balanceBusy.current) return;
    balanceBusy.current = true;
    setIsRefreshing(true);
    try {
      const { response, data } = await walletFetch('/api/get-live-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to read wallet balances.');

      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      if (data.transactions) setTransactions(data.transactions);
      setWalletNotice(data.sleWallet?.balanceAvailable === false ? data.sleWallet.balanceError || 'Balance unavailable.' : (data.warnings || []).join(' '));
    } catch (err: any) {
      setWalletNotice(err.message || 'Wallet refresh failed.');
      setSleWallet((previous: any) => previous ? { ...previous, balanceAvailable: false } : null);
    } finally {
      balanceBusy.current = false;
      setIsRefreshing(false);
    }
  };

  const hasSleAccount = /^fac-[A-Za-z0-9_-]+$/.test(String(sleWallet?.monime_account_id || sleWallet?.metadata?.monime_account_id || ''));
  const setupSleWallet = async () => {
    if (!canTransact || setupBusy.current) return;
    setupBusy.current = true;
    setIsSettingUpWallet(true);
    setWalletSetupError('');
    try {
      const { response, data, finish } = await walletFetch('/api/create-monime-wallet', {});
      if (!response.ok || !/^fac-[A-Za-z0-9_-]+$/.test(String(data.wallet?.monime_account_id || ''))) {
        throw new Error(data.error || 'Wallet setup was not confirmed. Retry without creating another account.');
      }
      finish();
      setSleWallet({ ...data.wallet, balance: null, balanceAvailable: false });
      await fetchLiveBalance();
    } catch (error: any) {
      setWalletSetupError(error.message || 'Wallet setup is unavailable. Please retry.');
    } finally { setupBusy.current = false; setIsSettingUpWallet(false); }
  };

  useEffect(() => {
    if (canTransact && !hasSleAccount) void setupSleWallet();
  }, [profile?.id, canTransact]);

  const walletSetupPanel = canTransact && !hasSleAccount ? <section role="status" className="m-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
    <p className="font-bold">{isSettingUpWallet ? 'Setting up your SLE wallet…' : 'Finish wallet setup'}</p>
    <p className="mt-1 text-sm">Your dashboard is available. Loading becomes available when your wallet account is ready.</p>
    {walletSetupError && <p role="alert" className="mt-2 text-red-700">{walletSetupError}</p>}
    <button type="button" disabled={isSettingUpWallet} onClick={() => void setupSleWallet()} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{isSettingUpWallet ? 'Setting up…' : 'Retry wallet setup'}</button>
  </section> : null;

  useEffect(() => {
    void fetchLiveBalance();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const refresh = () => { if (document.visibilityState === 'visible') void fetchLiveBalance(); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [profile?.id]);

  const handleCopy = async (id: string) => {
    if (!id || id === 'Pending Setup') return;
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch { alert(`Account ID: ${id}`); }
  };



  const handleCreateUsdWallet = async () => {
    if (!canTransact || isCreatingUsd) { setWalletNotice('Approval pending or wallet unavailable.'); return; }
    setIsCreatingUsd(true);
    try {
      const { response, data, finish } = await walletFetch('/api/create-usd-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to create USD wallet.');

      finish();
      await fetchLiveBalance();
      setWalletNotice('USD wallet created successfully.');
    } catch (err: any) { setWalletNotice(err.message || 'Unable to create USD wallet.'); } finally { setIsCreatingUsd(false); }
  };

  const activeTrackedTrip=activeRequests.find(r=>r.driver_id===profile.id&&['accepted','in_progress'].includes(r.status));
  useEffect(() => {
    if (activeSection !== 'home' || activeTrackedTrip || !mapContainer.current) return;
    let disposed = false;
    setMapReady(false); setMapError('');
    loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').then(() => {
      if (disposed || !mapContainer.current) return;
      googleMap.current = new google.maps.Map(mapContainer.current, {
        center: { lat: 8.4808, lng: -13.2290 }, zoom: 14,
        disableDefaultUI: true, zoomControl: true, clickableIcons: false,
        gestureHandling: 'cooperative'
      });
      setMapReady(true);
    }).catch(error => { if (!disposed) setMapError(error.message || 'Could not load the map.'); });
    return () => {
      disposed = true;
      if (googleMap.current) google.maps.event.clearInstanceListeners(googleMap.current);
      googleMap.current = null;
    };
  }, [activeSection, mapRetry, activeTrackedTrip?.id]);

  useEffect(() => {
    if (!isOnline || activeSection !== 'home') { setActiveRequests([]); setNegotiatingId(null); setFareSnapshots({}); setRequestsLoading(false); setRequestsError(''); return; }
    let disposed = false, busy = false, queued = false;
    setRequestsLoading(true); setRequestsError('');
    const fetchInitialRequests = async () => {
      if (disposed) return;
      if (busy) { queued = true; return; }
      busy = true; const readVersion = radarMutation.current; setRequestsLoading(true);
      try {
        const { data, error } = await supabase.from('bookings')
          .select('*, rider:profiles!rider_id(full_name, phone, phone_number)')
          .or(`status.in.(pending,pending_admin),driver_id.eq.${profile.id}`)
          .in('status', ['pending','pending_admin','accepted','in_progress'])
          .neq('status', 'cancelled').neq('status', 'completed')
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Invalid radar response.');
        if (!disposed && readVersion === radarMutation.current) {
          const visible=data.filter(item=>item.driver_id===profile.id||(!item.driver_id&&item.rider_id!==profile.id&&['pending','pending_admin'].includes(item.status)));
          setActiveRequests(previous => visible.map(item => mergeRideRow(previous.find(old => old.id === item.id), item)));
          setNegotiatingId(previous => visible.some(item => !item.driver_id && item.id === previous && ['pending', 'pending_admin'].includes(item.status)) ? previous : null);
          setRequestsError('');
        }
      } catch { if (!disposed) setRequestsError('Could not load ride requests. Check your connection and retry.'); }
      finally {
        busy = false;
        if (!disposed) {
          setRequestsLoading(false);
          if (queued) { queued = false; void fetchInitialRequests(); }
        }
      }
    };
    void fetchInitialRequests();
    const channel = supabase.channel(`driver-radar-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { void fetchInitialRequests(); void fetchLiveBalance(); }).subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void fetchInitialRequests(); }, 5000);
    return () => { disposed = true; void supabase.removeChannel(channel); window.clearInterval(timer); };
  }, [isOnline, activeSection, profile?.id, requestsRetry]);

  const handleAcceptBooking = async (booking: any) => {
    if (!canTransact || tripMutex.current || !Number.isFinite(Number(booking.fare_amount)) || Number(booking.fare_amount)<=0 || (booking.driver_id && booking.driver_id !== profile.id)) return;
    tripMutex.current = true;
    const userId = profile.id;
    setAcceptingId(booking.id); setRideNotice('');
    try {
      const snapshot = await readRideFares(userId, booking.id);
      if (!mounted.current || currentDriver.current !== userId) return;
      applyDriverFare(snapshot);
      assertDriverFare(snapshot, booking, userId);
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session?.user.id !== userId || !mounted.current) throw new Error('Your account changed. Sign in again.');
      const result = await updateRide('accept', booking.id);
      if (!mounted.current || currentDriver.current !== userId) return;
      radarMutation.current++;
      setActiveRequests(previous => previous.map(item => item.id === booking.id ? mergeRideRow(item, { ...item, ...result.booking }) : item));
      setNegotiatingId(null);
      setRideNotice(result.pending ? 'Escrow funding is processing. This trip has not been accepted yet; check again using this same request.' : 'Customer debit and escrow funding are confirmed. You can start the trip.');
      await fetchLiveBalance();
    } catch (err: any) {
      if (mounted.current && currentDriver.current === userId) { setRideNotice(err.message || 'Could not verify this fare. Refresh the request.'); setNegotiatingId(booking.id); }
    } finally { tripMutex.current = false; if (mounted.current) setAcceptingId(null); }
  };

  const handleCancelRide = async (booking: any) => {
    if (!canTransact || tripMutex.current) return;
    tripMutex.current = true;
    const userId = profile.id;
    setAcceptingId(booking.id); setRideNotice('');
    try {
      const result = await updateRide('cancel', booking.id);
      if (!mounted.current || currentDriver.current !== userId) return;
      radarMutation.current++;
      setActiveRequests(previous => previous.filter(item => item.id !== booking.id));
      setRideNotice('Trip cancelled successfully. A full refund has been issued to the customer.');
    } catch (err: any) { if (mounted.current) setRideNotice(err.message); }
    finally { tripMutex.current = false; if (mounted.current) setAcceptingId(null); }
  };

  const handleStartRide = async (booking: any) => {
    if (!canTransact || tripMutex.current) return;
    tripMutex.current = true;
    const userId = profile.id;
    setAcceptingId(booking.id); setRideNotice('');
    try {
      const result = await updateRide('start', booking.id);
      if (!mounted.current || currentDriver.current !== userId) return;
      radarMutation.current++;
      setActiveRequests(previous => previous.map(item => item.id === booking.id ? mergeRideRow(item, { ...item, ...result.booking }) : item));
      setRideNotice(result.pending ? 'Start is processing.' : 'Trip started. The held funds will be released when the customer confirms arrival.');
    } catch (err: any) { if (mounted.current) setRideNotice(err.message); }
    finally { tripMutex.current = false; if (mounted.current) setAcceptingId(null); }
  };

  const closeModals = () => {
    if (isProcessingPayout || isProcessingTransfer) return;
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false);
    setPayoutAmount(''); setPayoutPhone(''); setTransferAmount(''); setTransferRecipient(''); setTransferError(''); setTransferNotice('');
  };



  const executeTransfer = async () => {
    if (isProcessingTransfer) return;
    if (!canTransact) { setTransferError('Wallet access is unavailable.'); return; }
    if (!/^fac-[A-Za-z0-9_-]+$/.test(transferRecipient.trim())) { setTransferError('Enter the recipient MatMove account ID.'); return; }

    setIsProcessingTransfer(true); setTransferError(''); setTransferNotice('');
    try {
      const { response, data, finish } = await walletFetch('/api/create-monime-transfer', { amount: transferAmount, currency: transferCurrency, recipientAccountId: transferRecipient.trim() });
      if (!response.ok) throw new Error(data.error || 'Transfer could not be submitted.');
      const status = data.data?.status;

      setTransferNotice(status === 'completed' ? 'Transfer completed.' : `Transfer ${status || 'submitted'}. Do not create another payment while this transfer is pending.`);
      if (status === 'completed' || status === 'failed') { finish(); setTransferAmount(''); }
      await fetchLiveBalance();
    } catch (err: any) { setTransferError(err.message || 'Transfer could not be submitted.'); } finally { setIsProcessingTransfer(false); }
  };

  const walletCards = <WalletCardsView sleWallet={sleWallet} usdWallet={usdWallet}
    refresh={fetchLiveBalance} refreshing={isRefreshing} createUsd={handleCreateUsdWallet} creatingUsd={isCreatingUsd} />;

  const validTransactions = Array.isArray(transactions) ? transactions : [];
  const displayedTx = txFilter === 'recent' ? validTransactions.slice(0, 5) :validTransactions;

  return (
    <div className="flex-1 bg-slate-50 min-h-screen flex flex-col">
      {(rideNotice || walletNotice) && <div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{rideNotice && <p>{rideNotice}</p>}{walletNotice && <p>{walletNotice}</p>}</div>}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <button type="button" aria-label={isOnline ? 'Go offline' : 'Go online'} aria-pressed={isOnline} onClick={toggleOnline} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div><h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2></div>
        </div>

        <div className="flex gap-2">
          {!canTransact ? (
            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm border border-red-200">
              {isFrozen ? 'Wallet unavailable' : 'Approval pending'}
            </span>
          ) : (
            <>
              <button onClick={() => setIsLoadModalOpen(true)} disabled={!hasSleAccount || isSettingUpWallet} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-700 transition">Load</button>
              <button onClick={() => setIsPayoutModalOpen(true)} disabled={!hasSleAccount || isSettingUpWallet} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">Withdraw</button>
              <button onClick={() => setIsTransferModalOpen(true)} disabled={!hasSleAccount || isSettingUpWallet} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-800 transition">Transfer</button>
            </>
          )}
        </div>
      </header>
      {walletSetupPanel}

      {activeSection === 'home' && (
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-3 lg:flex-row">
          <div className="w-full lg:w-[340px] lg:shrink-0 bg-white border-r border-slate-200 flex flex-col p-4 space-y-4">
            <p className="text-xs text-slate-500">Your balance and wallet actions are in Home and Wallet.</p>
            <h3 className="font-bold text-xl text-slate-900 pt-2">Dispatch Radar</h3>

            {!isOnline ? (
              <div className="border-2 border-dashed border-slate-300 bg-slate-100 rounded-2xl p-6 text-center text-slate-400">
                <Power size={48} className="mx-auto mb-4" />
                <p>Go online to receive live ride and delivery requests.</p>
              </div>
            ) : requestsLoading && !activeRequests.length ? (
              <p role="status" className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 p-6 text-sm text-slate-600"><Loader2 size={18} className="animate-spin"/> Loading ride requests…</p>
            ) : requestsError ? (
              <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{requestsError}<button type="button" onClick={() => setRequestsRetry(n => n+1)} className="min-h-11 px-2 font-bold underline">Retry requests</button></p>
            ) : activeRequests.length === 0 ? (
              <div className="border-2 border-dashed border-emerald-300 bg-emerald-50 rounded-2xl p-6 text-center text-emerald-600 animate-pulse">
                <Car size={48} className="mx-auto mb-4" />
                <p className="font-bold">Listening for nearby requests…</p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeRequests.map(r => (
                  <div key={r.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">
                        {r.service_type}{r.scheduled_time?' · Scheduled':''}
                      </span>
                      <div>
                        <span className="text-2xl font-bold text-slate-900 block text-right">{Number.isFinite(Number(r.fare_amount))&&Number(r.fare_amount)>0?`SLE ${Number(r.fare_amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'Fare awaiting confirmation'}</span>
                        {Number.isFinite(Number(r.fare_amount))&&Number(r.fare_amount)>0&&<span className="text-[10px] font-bold text-emerald-600 block text-right bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 mt-1">Estimated take-home: SLE {(r.fare_amount * 0.85).toFixed(2)}</span>}
                      </div>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-2">
                      <div className="flex items-center gap-2 font-semibold text-slate-800"><MapPin size={14} className="text-emerald-500 shrink-0" /> Pickup: {r.pickup_location}</div>
                      <div className="flex items-center gap-2 font-semibold text-slate-800"><Navigation size={14} className="text-blue-500 shrink-0" /> Dropoff: {r.destination_location}</div>
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1.5"><User size={14} className="text-slate-400" /> {r.rider?.full_name || 'Rider Customer'}</span>
                      <span className="flex items-center gap-1.5"><Phone size={14} className="text-slate-400" /> {r.rider?.phone || r.rider?.phone_number || 'No Phone'}</span>
                    </div>

                    {r.scheduled_time&&<p className="text-xs text-slate-600">Scheduled for: {Number.isFinite(Date.parse(r.scheduled_time))?new Date(r.scheduled_time).toLocaleString():'Time needs confirmation'}</p>}
                    {r.driver_id===profile.id&&['pending','pending_admin'].includes(r.status)&&<p className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-800">Assigned to you. Review the fare and use Accept to continue the verified payment flow.</p>}
                    {['pending', 'pending_admin'].includes(r.status) && (
                      <>
                        <button type="button" onClick={() => void handleAcceptBooking(r)} disabled={!!acceptingId || !canTransact || !!fareBlockReason(r)} className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-50">
                          {acceptingId === r.id ? <span className="flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin"/> Checking request…</span> : Number.isFinite(Number(r.fare_amount))&&Number(r.fare_amount)>0?`Accept SLE ${Number(r.fare_amount).toFixed(2)}`:'Awaiting fare confirmation'}
                        </button>
                        {fareBlockReason(r) && <p role="status" className="text-xs text-amber-900">{fareBlockReason(r)}</p>}
                        {!r.driver_id && ['ride', 'delivery'].includes(r.service_type) && <button type="button" disabled={!!acceptingId || !canTransact || !Number.isFinite(Number(r.fare_amount)) || Number(r.fare_amount)<=0} onClick={() => setNegotiatingId(previous => previous === r.id ? null : r.id)} className="min-h-11 w-full rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50">{negotiatingId === r.id ? 'Hide fare offers' : 'Negotiate fare'}</button>}
                        {!r.driver_id && negotiatingId === r.id && <FareNegotiation key={`${profile.id}:${r.id}`} userId={profile.id} bookingId={r.id} role="driver" onFareChange={applyDriverFare} />}
                      </>
                    )}

                    {r.status === 'accepted' && r.driver_id === profile.id && (
                      <div className="flex gap-2">
                        <button onClick={() => void handleStartRide(r)} disabled={acceptingId === r.id} className="flex-1 bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 disabled:opacity-50">
                          {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Arrived / Start'}
                        </button>
                        <button onClick={() => void handleCancelRide(r)} disabled={acceptingId === r.id} className="flex-1 bg-red-50 text-red-600 border border-red-200 font-bold py-3.5 rounded-xl hover:bg-red-100 disabled:opacity-50">
                          {acceptingId === r.id ? <Loader2 size={18} className="animate-spin mx-auto" /> : 'Cancel (Refund)'}
                        </button>
                      </div>
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

          {activeTrackedTrip?<div className="min-w-0 flex-1"><ActiveTripMap key={activeTrackedTrip.id} userId={profile.id} bookingId={activeTrackedTrip.id} driver/></div>:          <div style={{height:"clamp(280px, 48dvh, 480px)"}} className="min-w-0 flex-1 rounded-2xl overflow-hidden relative min-h-[280px] w-full border border-slate-200 bg-slate-100 shadow-inner z-0">
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
            {mapError ? <p role="alert" className="absolute left-3 right-3 top-3 z-10 rounded-xl bg-red-50 p-3 text-sm text-red-800">{mapError}<button type="button" className="min-h-10 px-2 font-bold underline" onClick={() => setMapRetry(n => n+1)}>Retry map</button></p> : !mapReady && <p role="status" className="absolute left-3 right-3 top-3 z-10 rounded-xl bg-white p-3 text-sm text-slate-600">Loading radar map…</p>}
          </div>}
        </div>
      )}

      {activeSection === 'wallet' && (
        <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">My Wallets</h2>
          {walletCards}

          <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Wallet Actions</h3>
            <p className="text-sm text-slate-500 mb-8">Transfers support SLE to SLE and USD to USD</p>

            {!canTransact && (
              <p className="mb-4 text-sm text-red-700 bg-red-50 p-3 rounded-xl w-full">
                {isFrozen ? 'Your wallet is frozen. Contact support.' : 'Approval pending. Complete verification in Account & Profile; wallet features unlock after administrator approval.'}
              </p>
            )}

            <div className="grid grid-cols-3 gap-4 w-full">
              <button onClick={() => setIsLoadModalOpen(true)} disabled={!canTransact || !hasSleAccount || isSettingUpWallet} className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"><div className="p-3 bg-white rounded-full shadow-sm"><ArrowDownLeft size={24} /></div>Load</button>
              <button onClick={() => setIsPayoutModalOpen(true)} disabled={!canTransact || !hasSleAccount || isSettingUpWallet} className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"><ArrowUpRight size={24} /> Withdraw</button>
              <button onClick={() => setIsTransferModalOpen(true)} disabled={!canTransact || !hasSleAccount || isSettingUpWallet} className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"><div className="p-3 bg-white rounded-full shadow-sm"><Users size={24} /></div>Transfer</button>
            </div>
          </div>

          <TransactionHistory transactions={transactions} onSelect={setSelectedTx} />
        </div>
      )}

      {selectedTx && (
        <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}

      {isLoadModalOpen && (
        <WalletTopUp userId={profile.id} allowed={canTransact && hasSleAccount} onClose={() => setIsLoadModalOpen(false)} onPaid={fetchLiveBalance} />
      )}

      {isPayoutModalOpen && (
        <PayoutPanel userId={profile.id} allowed={canTransact && hasSleAccount}
          onClose={() => setIsPayoutModalOpen(false)} onBalanceChange={fetchLiveBalance} />
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} disabled={isProcessingTransfer} className="absolute right-4 top-4 p-2 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Account Transfer</h2>
            <label className="my-4 block text-sm font-bold">Send from<select value={transferCurrency} disabled={isProcessingTransfer} onChange={e => { setTransferCurrency(e.target.value as 'SLE' | 'USD'); setTransferError(''); setTransferNotice(''); }} className="mt-2 block w-full rounded-xl border p-3"><option value="SLE">SLE wallet → SLE account</option><option value="USD">USD wallet → USD account</option></select></label>
            {transferError && <p role="alert" className="mb-3 text-sm text-red-700">{transferError}</p>}
            {transferNotice && <p role="status" className="mb-3 text-sm text-blue-700">{transferNotice}</p>}
            <p className="mb-4 text-sm text-slate-500">Paste the recipient’s account ID for the selected currency.</p>
            <div className="mb-6 space-y-4">
              <input type="number" min="0.01" step="0.01" disabled={isProcessingTransfer} placeholder={`Amount (${transferCurrency})`} value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="w-full rounded-xl border p-4 text-xl font-bold" />
              <input type="text" disabled={isProcessingTransfer} placeholder="Recipient account ID (fac-...)" value={transferRecipient} onChange={e => setTransferRecipient(e.target.value)} className="w-full rounded-xl border p-4" />
            </div>
            <button onClick={() => void executeTransfer()} disabled={!canTransact || isProcessingTransfer || !transferAmount || !transferRecipient} className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 p-4 font-bold text-white disabled:opacity-50">
              {isProcessingTransfer ? <Loader2 size={20} className="animate-spin" /> : <Users size={20} />} Send Transfer
            </button>
          </div>
        </div>
      )}

      {showPolicy && <PolicyModal onAccept={handleAcceptPolicy} />}
    </div>
  );
}

function DriverTrips({ profile }: any) {
  return <TripHistory userId={profile.id} role="driver" />;
}

function PolicyModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="bg-slate-900 p-6 text-white shrink-0"><h2 className="text-xl font-bold">MatMove Safety & Compliance Policy</h2><p className="text-xs text-slate-400 mt-1">Sierra Leone Road Safety Authority (SLRSA) Guidelines</p></div>
        <div className="p-6 overflow-y-auto flex-1 text-sm text-slate-600 space-y-4">
          <p><strong>1.Compliance with SLRSA:</strong> All users must strictly adhere to the traffic rules and regulations set forth by the Sierra Leone Road Safety Authority.</p>
          <p><strong>2. Liability & Accidents:</strong> MatMove Enterprise acts solely as a technology platform connecting users.</p>
          <p><strong>3. Vehicle Safety:</strong> Drivers must ensure their vehicles are roadworthy, insured, and licensed.</p>
          <p><strong>4. Account Suspension:</strong> Any violation of these safety policies will result in immediate wallet freezing.</p>
          <p className="font-bold text-slate-900 pt-2 border-t">By clicking "I Accept", you acknowledge that you have read and agree to be bound by this policy.</p>
        </div>
        <div className="p-4 border-t bg-slate-50 shrink-0"><button onClick={onAccept} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md">I Accept & Agree</button></div>
      </div>
    </div>
  );
}