

import WalletCardsView from '@/components/WalletCards';
import TransactionHistory from '@/components/TransactionHistory';

import MerchantCheckout from '@/components/MerchantCheckout';
import TripHistory from '@/components/TripHistory';

import PayoutPanel from '@/components/PayoutPanel';
import { RideLocationPicker, TripLocations } from '@/components/RideLocationPicker';
import { WalletTopUp } from '@/components/WalletTopUp';
import { TransactionModal } from '@/components/TransactionModal';
import { useWalletAccess } from '@/lib/useWalletAccess';
import { walletFetch } from '@/lib/apiFetch';
import { updateRide, readRidePayment } from '@/services/rideService';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Car, Package, MapPin, ShoppingBag, Loader2,
  CalendarClock, Plus, Minus, ArrowRight, Wallet,
  RefreshCw, X, Smartphone, ArrowDownLeft,
  ArrowUpRight, Users, ShoppingCart, Activity,
  Copy, Check, Share2, MessageCircle, Phone
} from 'lucide-react';

const WHATSAPP_NUMBER = '23290330362';

export function RiderDashboard(props: any) {
  if (props.activeSection === 'shop') {
    return <RiderShop profile={props.profile} wallet={props.wallet} />;
  }

  if (props.activeSection === 'trips') {
    return <RiderTrips profile={props.profile} />;
  }

  return <RiderMain {...props} />;
}

function RiderMain({ profile, wallet, activeSection }: any) {
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<any>(null);

  const [pricingRates, setPricingRates] = useState<any>({
    bike: { min: 15, perKm: 3 },
    keke: { min: 20, perKm: 5 },
    car: { min: 30, perKm: 8 },
    van: { min: 50, perKm: 15 }
  });

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);

  const [serviceType,setServiceType] = useState<'ride' | 'delivery' | 'scheduled'>('ride');
  const [vehicleType, setVehicleType] = useState<'keke' | 'bike' | 'car' | 'van'>('car');
  const [offerAmount, setOfferAmount] = useState('');
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

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

  const [showPolicy, setShowPolicy] = useState(false);

  const { frozen: isFrozen, approved: isApproved } = useWalletAccess(profile.id);
  const canLoad = !isFrozen && profile.role === 'rider';
  const canSend = canLoad && isApproved;

  useEffect(() => {
    if (tripDistanceKm === null) return;

    const rate = pricingRates[vehicleType] || {
      min: 15,
      perKm: 3
    };

    setOfferAmount(
      Math.max(
        rate.min,
        Math.ceil(
          (rate.min + tripDistanceKm * rate.perKm) / 5
        ) * 5
      ).toString()
    );
  }, [tripDistanceKm, vehicleType, pricingRates]);

  const monimeAccountId =
    sleWallet?.monime_account_id ||
    sleWallet?.metadata?.monime_account_id ||
    'Pending Setup';

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShareReceipt = (tx: any) => {
    if (!tx) return;

    const isCredit = String(tx.balanceImpact).toUpperCase() === 'CREDIT';
    const amount = (tx.amount?.value / 100).toFixed(2);
    const currency = tx.amount?.currency || 'SLE';
    const dateStr =
      tx.createdAt || tx.created_at ||
      tx.timestamp || tx.date || tx.createdOn;

    const formattedDate =
      dateStr && !isNaN(new Date(dateStr).getTime())
        ? new Date(dateStr).toLocaleString()
        :'Recent';

    const receiptText =
      `MatMove Receipt\n----------------\n` +
      `Type: ${tx.description || tx.type || 'Transaction'}\n` +
      `Status: ${tx.status}\nDate: ${formattedDate}\n` +
      `Amount: ${isCredit ? '+' : '-'}${currency} ${amount}\n` +
      `TxID: ${tx.id}\n----------------\nSecurely processed by MatMove.`;

    if (navigator.share) {
      navigator.share({
        title: 'MatMove Receipt',
        text: receiptText
      }).catch(() => {
        navigator.clipboard.writeText(receiptText);
        alert('Receipt copied to clipboard!');
      });
    } else {
      navigator.clipboard.writeText(receiptText);
      alert('Receipt copied to clipboard!');
    }
  };

  useEffect(() => {
    supabase
      .from('pricing_settings')
      .select('*')
      .then(({ data }) => {
        if (data && data.length > 0) {
          const rates: any = {};
          data.forEach(r => {
            rates[r.vehicle_type] = {
              min: Number(r.min_fare),
              perKm: Number(r.per_km_rate)
            };
          });
          setPricingRates(rates);
        }
      });
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    const accepted = localStorage.getItem(`matmove_policy_${profile.id}`);
    if (!accepted) setShowPolicy(true);
  }, [profile?.id]);

  const handleAcceptPolicy = () => {
    localStorage.setItem(`matmove_policy_${profile.id}`, 'true');
    setShowPolicy(false);
  };

  useEffect(() => {
    if (!profile?.id) return;

    const checkActiveTrip = async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, driver:driver_id(full_name, phone)')
        .eq('rider_id', profile.id)
        .in('status', [
          'pending',
          'pending_admin',
          'accepted',
          'in_progress'
        ])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) setActiveBooking(data);
      else setActiveBooking(null);
    };

    checkActiveTrip();

    const channel = supabase
      .channel('rider-active-booking')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `rider_id=eq.${profile.id}`
        },
        checkActiveTrip
      )
      .subscribe();

    const syncInterval = setInterval(checkActiveTrip, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(syncInterval);
    };
  }, [profile?.id]);

  const fetchLiveBalance = async () => {
    if (!profile?.id || balanceBusy.current) return;
    balanceBusy.current = true;
    setIsRefreshing(true);
    try {
      const { response, data } = await walletFetch('/api/get-live-wallet',{});
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
    if (!canLoad || setupBusy.current) return;
    setupBusy.current = true;
    setIsSettingUpWallet(true);
    setWalletSetupError('');
    try {
      // Reuse the authenticated account reference and request key on every retry.
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
    if (canLoad && !hasSleAccount) void setupSleWallet();
    // One automatic attempt when access becomes available; failures use explicit Retry.
  }, [profile?.id, canLoad]);

  const walletSetupPanel = canLoad && !hasSleAccount ? <section role="status" className="m-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
    <p className="font-bold">{isSettingUpWallet ? 'Setting up your SLE wallet…' : 'Finish wallet setup'}</p>
    <p className="mt-1 text-sm">Your dashboard is available. Loading becomes available when your wallet account is ready.</p>
    {walletSetupError && <p role="alert" className="mt-2 text-red-700">{walletSetupError}</p>}
    <button type="button" disabled={isSettingUpWallet} onClick={() => void setupSleWallet()} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{isSettingUpWallet ? 'Setting up…' : 'Retry wallet setup'}</button>
  </section> : null;

  useEffect(() => {
    fetchLiveBalance();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    const refresh = () => { if (document.visibilityState === 'visible') void fetchLiveBalance(); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [profile?.id]);

  const handleCreateUsdWallet = async () => {
    if (!canLoad || isCreatingUsd) { setWalletNotice('Wallet access is unavailable.'); return; }
    setIsCreatingUsd(true);
    try {
      const { response, data, finish } = await walletFetch('/api/create-usd-wallet', {});
      if (!response.ok) throw new Error(data.error || 'Unable to create USD wallet.');

      finish();
      setWalletNotice('USD wallet created successfully.');
      fetchLiveBalance();
    } catch (err: any) {
      setWalletNotice(err.message || 'Unable to create USD wallet.');
    } finally {
      setIsCreatingUsd(false);
    }
  };

  const handleRequest = async () => {
    if (!pickupCoords || !destinationCoords) {
      return alert('Please select pickup and destination using address search or map pins.');
    }

    if (serviceType === 'scheduled' && !scheduledTime) {
      return alert('Select time for scheduled request.');
    }

    let finalAmount = 0;
    let finalStatus = 'pending';

    if (serviceType === 'ride' || serviceType === 'delivery') {
      finalAmount = Number(offerAmount);
      if (!finalAmount || finalAmount <= 0) {
        return alert('Preview route to calculate offer.');
      }
      const minFare = pricingRates[vehicleType]?.min || 1;
      if (finalAmount < minFare) {
        return alert(`Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minFare}`);
      }
    } else {
      finalStatus = 'pending_admin';
    }

    if ((sleWallet?.balance || 0) < finalAmount) {
      return alert(
        `Insufficient Balance. You need SLE ${finalAmount} ` +
        'to request this trip. Please Load your wallet.'
      );
    }

    setIsRequesting(true);

    try {
      const { data,error } = await supabase
        .from('bookings')
        .insert({
          rider_id: profile.id,
          service_type: serviceType,
          vehicle_type: serviceType !== 'scheduled' ? vehicleType : null,
          pickup_location: pickup,
          destination_location: destination,
          fare_amount: finalAmount,
          scheduled_time: serviceType === 'scheduled' ? scheduledTime : null,
          status: finalStatus
        })
        .select()
        .single();

      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) {
      alert('Request failed: ' + err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const cancelTrip = async () => {
    if (!activeBooking || isRequesting) return;
    setIsRequesting(true); setRideNotice('');
    try {
      const result = await updateRide('cancel', activeBooking.id);
      setRideNotice(result.pending ? 'Refund is processing. The cancellation is not settled yet.' : 'Trip cancelled. Any held fare has been returned to your wallet.');
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) { setRideNotice(err.message); }
    finally { setIsRequesting(false); }
  };

  const executeRidePayment = async () => {
    if (!activeBooking || isRequesting) return;
    setIsRequesting(true); setRideNotice('');
    try {
      const result = await updateRide('complete', activeBooking.id);
      if (!result.pending && result.payment?.settled !== true) throw new Error('Driver credit is not confirmed. Do not make a new payment.');
      const driverLeg = result.payment?.transfers?.find((leg: any) => leg.kind === 'driver');
      setRideNotice(result.pending ? 'Driver credit is processing; the trip is not completed yet. Check again.' : `Driver credited SLE ${Number(result.payment.driverEarnings).toFixed(2)}. Receipt: ${driverLeg?.transferId}.`);
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) { setRideNotice(err.message); }
    finally { setIsRequesting(false); }
  };

  const closeModals = () => {
    setIsLoadModalOpen(false);
    setIsPayoutModalOpen(false);
    setIsTransferModalOpen(false);
    setIsProcessingPayout(false);
    setIsProcessingTransfer(false);
    setPayoutAmount('');
    setTransferAmount('');
    setTransferRecipient('');
    setPayoutPhone('');
  };



  const executeTransfer = async () => {
    if (isProcessingTransfer) return;

    if (!canSend) {
      setTransferError(isFrozen ? 'Your wallet is unavailable. Contact support.' : 'Verify your identity before transferring money.');
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
      const { response, data, finish } = await walletFetch('/api/create-monime-transfer', {
        amount: transferAmount,
        currency: transferCurrency,
        recipientAccountId: transferRecipient.trim()
      });

      if (!response.ok) throw new Error(data.error || 'Transfer could not be submitted.');

      const status = data.data?.status;

      setTransferNotice(
        status === 'completed'
          ? 'Transfer completed.'
          : `Transfer ${status || 'submitted'}. Do not resend while pending.`
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

  const WalletCards = <WalletCardsView sleWallet={sleWallet} usdWallet={usdWallet}
    refresh={fetchLiveBalance} refreshing={isRefreshing} createUsd={handleCreateUsdWallet} creatingUsd={isCreatingUsd} />;

  const validTransactions = Array.isArray(transactions) ? transactions : [];
  const displayedTx = txFilter === 'recent' ? validTransactions.slice(0, 5) : validTransactions;

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Where to, {profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider'}? 👋
          </h1>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} disabled={!canLoad || !hasSleAccount || isSettingUpWallet} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Load</button>
          <button onClick={() => setIsPayoutModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50" title={canSend ? 'Withdraw' : 'Verify your identity to withdraw'}>Payout</button>
          <button onClick={() => setIsTransferModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50" title={canSend ? 'Transfer' : 'Verify your identity to transfer'}>Transfer</button>
        </div>
      </header>
      {(rideNotice || walletNotice) && <div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{rideNotice && <p>{rideNotice}</p>}{walletNotice && <p>{walletNotice}</p>}</div>}

      {walletSetupPanel}
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {activeSection === 'home' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="col-span-1 bg-white p-6 rounded-3xl border shadow-sm space-y-4 h-fit z-20">
              {WalletCards}

              <h3 className="font-bold text-lg mt-6">Request Service</h3>

              {!activeBooking ? (
                <>
                  <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setServiceType('ride')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'ride' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Car size={16} /> Ride
                    </button>
                    <button
                      onClick={() => setServiceType('delivery')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'delivery' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Package size={16} /> Delivery
                    </button>
                    <button
                      onClick={() => setServiceType('scheduled')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                    >
                      <CalendarClock size={16} /> Schedule
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(serviceType === 'ride' || serviceType === 'delivery') && (
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {(['keke', 'bike', 'car', 'van'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setVehicleType(v)}
                            className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition ${vehicleType === v ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-600' : 'bg-slate-100 text-slate-500'}`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}

                    <p className="text-sm text-slate-600">
                      Choose pickup and destination in the map panel,
                      then preview your route.
                    </p>

                    {(serviceType === 'ride' || serviceType === 'delivery') && (
                      <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-slate-500 font-bold text-sm px-2">
                            Total Fare (SLE)
                          </span>
                          <input
                            type="number"
                            placeholder="Amount"
                            value={offerAmount}
                            onChange={e => setOfferAmount(e.target.value)}
                            className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2"
                          />

                          <div className="flex gap-1">
                            <button
                              onClick={() => setOfferAmount(prev =>
                                Math.max(
                                  pricingRates[vehicleType]?.min || 1,
                                  (Number(prev) || 1) - 5
                                ).toString()
                              )}
                              className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                            >
                              <Minus size={16} />
                            </button>
                            <button
                              onClick={() => setOfferAmount(prev =>
                                ((Number(prev) || 1) + 5).toString()
                              )}
                              className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                            >
                              <Plus size={16} />
                            </button>
                          </div>
                        </div>

                        {Number(offerAmount) > 0 && (
                          <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm mt-2">
                            <div className="text-[11px] font-bold text-emerald-600">
                              Driver Earns: SLE {(Number(offerAmount) * 0.85).toFixed(2)}
                            </div>
                            <div className="text-[11px] font-bold text-rose-500">
                              Platform Fee: SLE {(Number(offerAmount) * 0.15).toFixed(2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {serviceType === 'scheduled' && (
                      <div className="flex items-center gap-2 border p-3 rounded-xl">
                        <CalendarClock size={16} className="text-emerald-600" />
                        <input
                          type="datetime-local"
                          value={scheduledTime}
                          onChange={e => setScheduledTime(e.target.value)}
                          className="w-full outline-none text-sm bg-transparent"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRequest}
                    disabled={isRequesting}
                    className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4"
                  >
                    {isRequesting
                      ? <Loader2 size={20} className="animate-spin mx-auto" />
                      : 'Confirm Request'}
                  </button>
                </>
              ) : (
                <div className="text-center py-8">
                  {activeBooking.status === 'accepted' ||
                    activeBooking.status === 'in_progress' ? (
                    <>
                      <Car size={48} className="text-emerald-600 mx-auto mb-4" />
                      <h4 className="font-bold text-xl text-slate-900">
                        {activeBooking.status === 'in_progress'
                          ? 'Trip in Progress!'
                          : 'Driver is on the way!'}
                      </h4>
                      <p className="text-sm text-slate-500 mt-2">
                        Your fare (SLE {activeBooking.fare_amount}) is held securely in Escrow.
                      </p>

                      {activeBooking.driver && (
                        <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-left mb-6">
                          <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">
                            Your Driver
                          </div>
                          <div className="font-bold text-slate-900">
                            {activeBooking.driver.full_name}
                          </div>
                          <div className="text-sm text-slate-600 flex items-center gap-1 mt-1">
                            <Smartphone size={14} /> {activeBooking.driver.phone}
                          </div>
                        </div>
                      )}

                      {activeBooking.status === 'accepted' && <button onClick={cancelTrip} disabled={isRequesting} className="mb-4 text-red-600 font-bold">Cancel & Refund Held Fare</button>}
                      {activeBooking.status === 'in_progress' && (
                        <button
                          onClick={executeRidePayment}
                          disabled={isRequesting}
                          className="w-full bg-emerald-600 text-white font-bold py-4 rounded-xl hover:bg-emerald-700 transition shadow-lg flex items-center justify-center gap-2"
                        >
                          {isRequesting
                            ? <Loader2 size={20} className="animate-spin" />
                            : 'Confirm Arrival & Release Driver Payment'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <Loader2 size={40} className="animate-spin text-orange-600 mx-auto mb-4" />
                      <h4 className="font-bold text-lg text-slate-900">
                        {activeBooking.status === 'pending_admin'
                          ? 'Request sent to Dispatch...'
                          : 'Broadcasting request...'}
                      </h4>
                      <p className="text-sm text-slate-500 mt-2">
                        Please wait while we assign a driver to your trip.
                      </p>

                      {(activeBooking.status === 'pending' ||
                        activeBooking.status === 'pending_admin') && (
                        <button
                          onClick={cancelTrip}
                          className="text-red-500 text-sm font-bold hover:underline mt-4"
                        >
                          Cancel Request
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="lg:col-span-2 min-w-0">
              <RideLocationPicker
                onChange={(selection: TripLocations) => {
                  setPickup(selection.pickup?.address || '');
                  setDestination(selection.destination?.address || '');
                  setPickupCoords(selection.pickup?.coords || null);
                  setDestinationCoords(selection.destination?.coords || null);
                  setTripDistanceKm(selection.distanceKm);

                  if (selection.distanceKm !== null) {
                    const rate = pricingRates[vehicleType] || {
                      min: 15,
                      perKm: 3
                    };

                    setOfferAmount(
                      Math.max(
                        rate.min,
                        Math.ceil(
                          (rate.min + selection.distanceKm * rate.perKm) / 5
                        ) * 5
                      ).toString()
                    );
                  } else {
                    setOfferAmount('');
                  }
                }}
              />
            </div>
          </div>
        )}

        {activeSection === 'wallet' && (
          <div className="w-full space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">
              My Wallets
            </h2>

            {WalletCards}

            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Wallet Actions
              </h3>
              <p className="text-sm text-slate-500 mb-8">
                Load your wallet anytime. Verify your identity to transfer or withdraw.
              </p>

              {!canSend && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{isFrozen ? 'Wallet unavailable. Contact support if this continues.' : 'Verify your identity in Account & Profile to unlock transfers and withdrawals. You can still load your wallet.'}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full">
                <button
                  onClick={() => setIsLoadModalOpen(true)}
                  disabled={!canLoad || !hasSleAccount || isSettingUpWallet}
                  className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm">
                    <ArrowDownLeft size={24} />
                  </div>
                  Load
                </button>

                <button
                  onClick={() => setIsPayoutModalOpen(true)}
                  disabled={!canSend || !hasSleAccount}
                  className="p-4 sm:p-6 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <ArrowUpRight size={24} /> Withdraw
                </button>

                <button
                  onClick={() => setIsTransferModalOpen(true)}
                  disabled={!canSend || !hasSleAccount}
                  className="p-4 sm:p-6 rounded-2xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm">
                    <Users size={24} />
                  </div>
                  Transfer
                </button>
              </div>
            </div>

            <TransactionHistory transactions={transactions} onSelect={setSelectedTx} />
          </div>
        )}
      </div>

      {selectedTx && (
        <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}

      {isLoadModalOpen && (
        <WalletTopUp
          userId={profile.id}
          allowed={canLoad && hasSleAccount}
          onClose={() => setIsLoadModalOpen(false)}
          onPaid={fetchLiveBalance}
        />
      )}

      {isPayoutModalOpen && (
        <PayoutPanel userId={profile.id} allowed={canSend && hasSleAccount}
          onClose={() => setIsPayoutModalOpen(false)} onBalanceChange={fetchLiveBalance} />
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
              Paste the recipient's exact MatMove Account ID.
            </p>

            <div className="space-y-4 mb-6">
              <input
                type="number"
                placeholder={`Amount (${transferCurrency})`}
                value={transferAmount}
                disabled={isProcessingTransfer}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500"
              />
              <input
                type="text"
                disabled={isProcessingTransfer}
                placeholder="Recipient ID (e.g. fac-k6V8...)"
                value={transferRecipient}
                onChange={e => setTransferRecipient(e.target.value)}
                className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500"
              />
            </div>

            <button
              onClick={executeTransfer}
              disabled={!canSend || !hasSleAccount || isProcessingTransfer || !transferAmount || !transferRecipient}
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

function RiderShop({ profile, wallet }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [orderQty,setOrderQty] = useState(1);

  const fetchShopProducts = async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*, merchant:merchant_id(business_name, whatsapp_number)')
      .order('created_at', { ascending: false });

    if (error || !data) {
      const fallback = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (fallback.data) {
        setProducts(Array.isArray(fallback.data) ? fallback.data : []);
      }
    } else {
      setProducts(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => {
    fetchShopProducts();
  }, []);

  const handleWhatsAppRedirect = (product: any) => {
    const merchantPhone =
      product.merchant?.whatsapp_number ||
      product.whatsapp_number ||
      WHATSAPP_NUMBER;

    const message = encodeURIComponent(
      `Hello! I would like to order: *${product.name}* (SLE ${product.price}).`
    );

    window.open(`https://wa.me/${merchantPhone}?text=${message}`, '_blank');
  };

  const handleShare = (product: any) => {
    const shareText = `Check out ${product.name} for SLE ${product.price} on MatMove!`;
    if (navigator.share) {
      navigator.share({ title: product.name, text: shareText }).catch(() => alert('Share cancelled.'));
    } else {
      navigator.clipboard.writeText(shareText);
      alert('Product details copied to clipboard!');
    }
  };

  const handleAddToCart = async (product: any) => {
    try {
      await supabase.from('cart_items').insert({
        rider_id: profile.id,
        product_id: product.id,
        quantity: 1
      });
      alert(`${product.name} added to your cart in the Account tab!`);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const openOrderModal = (product: any) => {
    setSelectedProduct(product);
    setOrderQty(1);
    setOrderModalOpen(true);
  };


  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <ShoppingCart className="text-blue-600" size={28} />
          <h1 className="text-3xl font-bold text-slate-900">Shop Marketplace</h1>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="text-center text-slate-500 py-10">No products listed yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => (
            <div
              key={p.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition duration-200"
            >
              {p.image_url ? (
                <div className="h-48 w-full bg-slate-100 relative group">
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => handleShare(p)}
                    className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur rounded-full text-slate-600 hover:text-blue-600 transition shadow-sm"
                  >
                    <Share2 size={16} />
                  </button>
                </div>
              ) : (
                <div className="h-48 w-full bg-slate-100 flex items-center justify-center relative">
                  <ShoppingBag className="text-slate-300" size={48} />
                  <button
                    onClick={() => handleShare(p)}
                    className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur rounded-full text-slate-600 hover:text-blue-600 transition shadow-sm"
                  >
                    <Share2 size={16} />
                  </button>
                </div>
              )}

              <div className="p-5 flex flex-col flex-1">
                <h4 className="font-bold text-lg text-slate-900 leading-tight">{p.name}</h4>
                <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">
                  {p.merchant?.business_name || 'Verified Merchant'}
                </div>
                <p className="text-sm text-slate-600 mt-3 line-clamp-2 mb-4">
                  {p.description || 'No description available.'}
                </p>

                <div className="mt-auto space-y-3">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-blue-600 font-bold text-xl">SLE {p.price}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleAddToCart(p)}
                      className="bg-slate-100 text-slate-700 text-[11px] font-bold py-2.5 rounded-lg hover:bg-slate-200 transition flex items-center justify-center gap-1.5"
                    >
                      <ShoppingCart size={14} /> Add to Cart
                    </button>
                    <button
                      onClick={() => openOrderModal(p)}
                      className="bg-blue-600 text-white text-[11px] font-bold py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-1.5"
                    >
                      <ArrowRight size={14} /> Order In-App
                    </button>
                  </div>
                  <button
                    onClick={() => handleWhatsAppRedirect(p)}
                    className="w-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold py-2.5 rounded-lg hover:bg-emerald-100 transition flex items-center justify-center gap-1.5"
                  >
                    <MessageCircle size={14} /> Order via WhatsApp
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!orderModalOpen && <MerchantCheckout userId={profile.id} items={[]}
        initialPhone={profile.phone || profile.phone_number || ''} />}
      {orderModalOpen && selectedProduct && (
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex justify-between gap-3"><h2 className="text-xl font-bold">{selectedProduct.name}</h2>
            <button className="rounded-lg border px-3 py-2" onClick={() => setOrderModalOpen(false)}>Close</button></div>
          <label className="mt-3 block font-medium">Quantity<input type="number" min="1" max="100" step="1" value={orderQty}
            onChange={e => setOrderQty(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))}
            className="mt-1 w-full rounded-xl border p-3" /></label>
          <MerchantCheckout userId={profile.id} items={[{productId: selectedProduct.id, quantity: orderQty}]}
            initialPhone={profile.phone || profile.phone_number || ''} />
        </section>
      )}
    </div>
  );
}

function RiderTrips({ profile }: any) {
  return <TripHistory userId={profile.id} role="rider" />;
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
            <strong>1. Compliance with SLRSA:</strong> All users
            (Drivers, Riders, and Merchants) must strictly adhere
            to the traffic rules and regulations set forth by
            the Sierra Leone Road Safety Authority (SLRSA).
          </p>
          <p>
            <strong>2. Liability & Accidents:</strong> MatMove Enterprise
            acts solely as a technology platform connecting users.
            MatMove is not liable for any road traffic accidents,
            injuries, loss of property, or damages that occur during transit.
          </p>
          <p>
            <strong>3. Vehicle Safety:</strong> Drivers must ensure their
            vehicles (Keke, Bike, Car, Van) are roadworthy, insured, and licensed.
          </p>
          <p>
            <strong>4. Account Suspension:</strong> Any violation of these
            safety policies or reports of reckless behavior will result
            in immediate wallet freezing and account suspension.
          </p>
          <p className="font-bold text-slate-900 pt-2 border-t">
            By clicking "I Accept", you acknowledge that you have read,
            understood, and agree to be bound by this policy.
            All rights reserved by MatMove Enterprise.
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
