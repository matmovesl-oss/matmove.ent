import ActiveTripMap from '@/components/ActiveTripMap';
import { ProductGallery, catalogMoney, catalogCheckoutAllowed } from '@/components/ProductCatalog';
import FareNegotiation from '@/components/FareNegotiation';
import { useCustomerActiveRide } from '@/lib/useRideNegotiation';
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
import { updateRide } from '@/services/rideService';
import { useTripRequest } from '@/lib/useTripRequest';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Car, CarFront, Bike, Truck, Package, MapPin, ShoppingBag, Loader2,
  CalendarClock, Plus, Minus, ArrowRight, Wallet,
  RefreshCw, X, Smartphone, ArrowDownLeft,
  ArrowUpRight, Users, ShoppingCart, Activity,
  Copy, Check, Share2, MessageCircle, Phone, Clock, FileText
} from 'lucide-react';

const WHATSAPP_NUMBER = '23290330362';

export function RiderDashboard(props: any) {
  if (props.activeSection === 'shop') {
    return <RiderShop profile={props.profile} wallet={props.wallet} />;
  }

  if (props.activeSection === 'trips') {
    return <RiderTrips profile={props.profile} />;
  }

  return <RiderMain key={props.profile?.id || 'rider-main'} {...props} />;
}

function RiderMain({ profile, wallet, activeSection, onBack }: any) {
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

  const defaultPricing = {
    bike: { min: 15, perKm: 3 },
    keke: { min: 20, perKm: 5 },
    car: { min: 30, perKm: 8 },
    van: { min: 50, perKm: 15 }
  };

  const [pricingRates, setPricingRates] = useState<any>(defaultPricing);
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);

  const [viewMode, setViewMode] = useState<'active' | 'new'>('active');
  const [serviceType, setServiceType] = useState<'ride' | 'delivery' | 'scheduled'>('ride');
  const [vehicleType, setVehicleType] = useState<'keke' | 'bike' | 'car' | 'van'>('car');
  const [offerAmount, setOfferAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'digital' | 'cash'>('digital');
  const [cashEnabled, setCashEnabled] = useState(false);
  const [cashAccountsVerified, setCashAccountsVerified] = useState(false);
  const [cashConfigLoading, setCashConfigLoading] = useState(true);
  const [tripDistanceKm, setTripDistanceKm] = useState<number | null>(null);
  const [scheduledTime, setScheduledTime] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [passengerCount, setPassengerCount] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bookingSheetExpanded, setBookingSheetExpanded] = useState(true);
  const [routeEditing, setRouteEditing] = useState(true);
  const [bookingSheetDragDelta, setBookingSheetDragDelta] = useState(0);
  const sheetPointerStart = useRef<number | null>(null);
  const sheetDragged = useRef(false);

  const {
    booking: activeBooking,
    setBooking: setActiveBooking,
    loading: tripLoading,
    error: tripError,
    retry: retryTrip,
    applySnapshot: applyFareSnapshot
  } = useCustomerActiveRide(profile?.id);
  const tripRequest = useTripRequest(profile?.id || '');

  useEffect(() => {
    let timer: any;
    if (activeBooking && activeBooking.status === 'accepted' && activeBooking.accepted_at) {
      const updateElapsed = () => {
        const diff = Math.floor((Date.now() - new Date(activeBooking.accepted_at).getTime()) / 1000);
        setElapsedSeconds(diff >= 0 ? diff : 0);
      };
      updateElapsed();
      timer = setInterval(updateElapsed, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [activeBooking]);

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

  const { frozen: isFrozen, approved: isApproved } = useWalletAccess(profile?.id);
  const canLoad = !isFrozen && profile?.role === 'rider';
  const canSend = canLoad && isApproved;

  useEffect(() => {
    let live = true;
    setCashConfigLoading(true);
    setCashEnabled(false);
    setCashAccountsVerified(false);
    if (!profile?.id) {
      setCashConfigLoading(false);
      return () => { live = false; };
    }
    void (async () => {
      try {
        const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=cash_config', {});
        if (!response.ok) throw new Error('Cash configuration unavailable.');
        finish();
        if (live) {
          setCashEnabled(data?.enabled === true);
          setCashAccountsVerified(data?.accountsVerified === true);
        }
      } catch {
        if (live) { setCashEnabled(false); setCashAccountsVerified(false); }
      } finally {
        if (live) setCashConfigLoading(false);
      }
    })();
    return () => { live = false; };
  }, [profile?.id]);

  useEffect(() => {
    if (serviceType !== 'ride') setPaymentMethod('digital');
  }, [serviceType]);

  useEffect(() => {
    if (tripDistanceKm === null) return;
    const rate = pricingRates?.[vehicleType] || defaultPricing[vehicleType] || { min: 15, perKm: 3 };
    setOfferAmount(
      Math.max(
        rate.min,
        Math.ceil((rate.min + tripDistanceKm * rate.perKm) / 5) * 5
      ).toString()
    );
  }, [tripDistanceKm, vehicleType, pricingRates]);

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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
    if (profile?.id) {
      localStorage.setItem(`matmove_policy_${profile.id}`, 'true');
    }
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
    if (!canLoad || setupBusy.current) return;
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
    } finally {
      setupBusy.current = false;
      setIsSettingUpWallet(false);
    }
  };

  useEffect(() => {
    if (canLoad && !hasSleAccount) void setupSleWallet();
  }, [profile?.id, canLoad]);

  const walletSetupPanel = canLoad && !hasSleAccount ? (
    <section role="status" className="m-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <p className="font-bold">{isSettingUpWallet ? 'Setting up your SLE wallet…' : 'Finish wallet setup'}</p>
      <p className="mt-1 text-sm">Your dashboard is available. Loading becomes available when your wallet account is ready.</p>
      {walletSetupError && <p role="alert" className="mt-2 text-red-700">{walletSetupError}</p>}
      <button type="button" disabled={isSettingUpWallet} onClick={() => void setupSleWallet()} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{isSettingUpWallet ? 'Setting up…' : 'Retry wallet setup'}</button>
    </section>
  ) : null;

  useEffect(() => {
    fetchLiveBalance();
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
    if (tripLoading || tripError || activeBooking || isRequesting) return;
    if (tripRequest.error) {
      setRideNotice(tripRequest.error);
      return;
    }

    // If a previous request lost its response, recover that exact request.
    // Never build a new payload or create another booking until it is resolved.
    const retainedDetails = tripRequest.retained?.details as Record<string, unknown> | undefined;
    const finalAmount = Number(retainedDetails?.fare_amount ?? offerAmount);

    if (!retainedDetails && (!pickupCoords || !destinationCoords)) {
      setRideNotice('Please select pickup and destination using address search or map pins.');
      return;
    }

    if (!retainedDetails && serviceType === 'scheduled' && !scheduledTime) {
      setRideNotice('Select a time for your scheduled request.');
      return;
    }

    if (!retainedDetails && (!/^\d+(\.\d{1,2})?$/.test(offerAmount.trim()) || !Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > 1000000)) {
      setRideNotice('Enter and review a positive fare with at most two decimal places, up to SLE 1,000,000.');
      return;
    }

    if (!retainedDetails) {
      const minFare = pricingRates?.[vehicleType]?.min || defaultPricing[vehicleType].min;
      if (finalAmount < minFare) {
        setRideNotice(`Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minFare}.`);
        return;
      }

      const fareMinor = Math.round(finalAmount * 100);
      const driverCashMinor = Math.round(fareMinor * 0.85);
      const requiredWalletAmount = paymentMethod === 'cash'
        ? (fareMinor - driverCashMinor) / 100
        : finalAmount;
      if ((sleWallet?.balance || 0) < requiredWalletAmount) {
        setRideNotice(paymentMethod === 'cash'
          ? `Insufficient SLE wallet balance. You need SLE ${requiredWalletAmount.toFixed(2)} to secure MatMove's 15% cash-ride fee.`
          : `Insufficient balance. You need SLE ${finalAmount} to request this trip. Please load your wallet.`);
        return;
      }
    }

    setIsRequesting(true);
    setRideNotice('');

    try {
      const details = retainedDetails ? undefined : {
        client_version: 1,
        payment_method: paymentMethod,
        service_type: serviceType,
        vehicle_type: vehicleType,
        pickup_location: pickup,
        destination_location: destination,
        fare_amount: finalAmount.toFixed(2),
        scheduled_time: serviceType === 'scheduled' ? new Date(scheduledTime).toISOString() : null,
        passenger_count: passengerCount,
        passenger_name: null,
        pickup_pin: { lat: pickupCoords![1], lng: pickupCoords![0] },
        destination_pin: { lat: destinationCoords![1], lng: destinationCoords![0] }
      };

      const booking = await tripRequest.submit(details);
      setActiveBooking(booking);
      if ((retainedDetails?.payment_method ?? paymentMethod) === 'cash') void fetchLiveBalance();
      setViewMode('active');
      setRideNotice('');
    } catch (err: any) {
      setRideNotice(err?.message || 'Trip request could not be confirmed. Check the original request before trying again.');
    } finally {
      setIsRequesting(false);
    }
  };

  const cancelTrip = async () => {
    if (!activeBooking || isRequesting) return;
    
    const isAfterFiveMinutes = elapsedSeconds > 300;
    const penaltyAmount = Number(activeBooking.fare_amount || 0) * 0.01;
    const driverShare = penaltyAmount * 0.5;
    const escrowShare = penaltyAmount * 0.5;

    if (activeBooking.status === 'accepted' && isAfterFiveMinutes) {
      const confirmed = window.confirm(
        `It has been over 5 minutes since driver acceptance. Cancelling now incurs a 1% dispatch fee (SLE ${penaltyAmount.toFixed(2)}), split 50/50 between the driver (SLE ${driverShare.toFixed(2)}) and escrow (SLE ${escrowShare.toFixed(2)}). Continue?`
      );
      if (!confirmed) return;
    }

    setIsRequesting(true);
    setRideNotice('');
    try {
      const result = await updateRide('cancel', activeBooking.id);
      
      if (activeBooking.status === 'accepted') {
        setRideNotice(
          isAfterFiveMinutes
            ? `Trip cancelled. A 1% dispatch fee of SLE ${penaltyAmount.toFixed(2)} was split 50/50 between driver and escrow.`
            : 'Trip cancelled within the 5-minute free window. Full refund returned to your wallet.'
        );
      } else {
        setRideNotice(result.pending ? 'Refund is processing. The cancellation is not settled yet.' : 'Trip cancelled. Any held fare has been returned to your wallet.');
      }
      
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) {
      setRideNotice(err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const executeRidePayment = async () => {
    if (!activeBooking || isRequesting) return;
    setIsRequesting(true);
    setRideNotice('');
    try {
      const result = await updateRide(activeBooking.payment_method === 'cash' ? 'cash_confirm' : 'complete', activeBooking.id);
      if (activeBooking.payment_method === 'cash') {
        const payment = result.payment;
        if (payment?.status === 'settled' && result.success === true && result.pending === false) {
          setRideNotice('Both cash confirmations are verified and MatMove has captured its reserved fee. Cash collection is settled.');
          setActiveBooking(null);
        } else {
          setRideNotice(payment?.driverCashConfirmed && payment?.riderCashConfirmed
            ? 'Both cash confirmations are recorded. MatMove fee capture is still being verified; do not repeat the cash handover.'
            : 'Your cash-handover confirmation is recorded. The assigned driver must also confirm receipt before MatMove captures its fee.');
          setActiveBooking({ ...activeBooking, ...(result.booking || {}) });
        }
        await fetchLiveBalance();
        return;
      }
      if (!result.pending && result.payment?.settled !== true) throw new Error('Driver credit is not confirmed.');
      const driverLeg = result.payment?.transfers?.find((leg: any) => leg.kind === 'driver');
      setRideNotice(`Driver credited SLE ${Number(result.payment.driverEarnings).toFixed(2)}. Receipt: ${driverLeg?.transferId || 'Settled'}.`);
      setActiveBooking(result.pending ? { ...activeBooking, ...result.booking } : null);
      await fetchLiveBalance();
    } catch (err: any) {
      setRideNotice(err.message);
    } finally {
      setIsRequesting(false);
    }
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
      setTransferError(isFrozen ? 'Your wallet is unavailable.' : 'Verify your identity before transferring.');
      return;
    }
    if (!/^fac-[A-Za-z0-9_-]+$/.test(transferRecipient.trim())) {
      setTransferError('Enter a valid recipient account ID.');
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

      const status = String(data?.status || data?.data?.status || 'completed').toLowerCase();
      setTransferNotice(status === 'completed' ? 'Transfer completed successfully.' : `Transfer ${status}.`);

      if (status === 'completed' || status === 'failed') {
        finish?.();
        setTransferAmount('');
        setTransferRecipient('');
      }

      await fetchLiveBalance();
    } catch (err: any) {
      setTransferError(err.message || 'Transfer failed.');
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  const WalletCards = (
    <WalletCardsView
      sleWallet={sleWallet}
      usdWallet={usdWallet}
      refresh={fetchLiveBalance}
      refreshing={isRefreshing}
      createUsd={handleCreateUsdWallet}
      creatingUsd={isCreatingUsd}
    />
  );

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className={`bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm ${activeSection === 'wallet' || activeSection === 'home' ? 'hidden' : ''}`}>
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Where to, {profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider'}? 👋
          </h1>
        </div>

        <div className="flex gap-2">
          <button onClick={() => setIsLoadModalOpen(true)} disabled={!canLoad || !hasSleAccount || isSettingUpWallet} className="bg-blue-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Load</button>
          <button onClick={() => setIsPayoutModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-emerald-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Payout</button>
          <button onClick={() => setIsTransferModalOpen(true)} disabled={!canSend || !hasSleAccount} className="bg-slate-900 text-white px-3.5 py-2 rounded-xl text-xs font-bold disabled:opacity-50">Transfer</button>
        </div>
      </header>

      {(rideNotice || walletNotice) && (
        <div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          {rideNotice && <p>{rideNotice}</p>}
          {walletNotice && <p>{walletNotice}</p>}
        </div>
      )}

      {walletSetupPanel}

      <div className="mx-auto max-w-7xl space-y-4 px-0 pb-8 sm:px-4">
        {(activeSection === 'home' || activeSection === 'ride' || !activeSection) && (
          <div className="relative flex min-h-[100dvh] min-w-0 flex-col gap-0 overflow-visible">
            {(activeBooking || (pickupCoords && destinationCoords && !routeEditing)) && <div className={`fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 mx-auto w-full max-w-5xl ${bookingSheetExpanded ? 'max-h-[min(66dvh,700px)]' : 'max-h-[148px]'} overscroll-contain overflow-y-auto rounded-t-[2rem] border border-slate-200 bg-white px-4 pb-5 pt-3 shadow-[0_-18px_50px_rgba(15,23,42,0.2)] space-y-4 sm:px-6`} style={{height:bookingSheetExpanded?'min(66dvh,700px)':'148px',transform:bookingSheetDragDelta ? 'translateY(' + bookingSheetDragDelta + 'px)' : undefined, transition:sheetPointerStart.current===null ? 'transform 220ms cubic-bezier(.2,.8,.2,1)' : 'none'}}>
              <button type="button" aria-label="Drag or tap to expand or collapse ride booking panel" aria-expanded={bookingSheetExpanded} onPointerDown={event=>{sheetDragged.current=false;sheetPointerStart.current=event.clientY;event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(sheetPointerStart.current!==null)setBookingSheetDragDelta(event.clientY-sheetPointerStart.current);}} onPointerUp={event=>{const start=sheetPointerStart.current;if(start===null)return;const delta=event.clientY-start;if(Math.abs(delta)>28){sheetDragged.current=true;if(delta<0)setBookingSheetExpanded(true);else setBookingSheetExpanded(false);}sheetPointerStart.current=null;setBookingSheetDragDelta(0);}} onPointerCancel={()=>{sheetPointerStart.current=null;setBookingSheetDragDelta(0);}} onClick={()=>{if(sheetDragged.current){sheetDragged.current=false;return;}setBookingSheetExpanded(value=>!value);}} className="mx-auto flex h-6 w-16 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"><span className="h-1.5 w-12 rounded-full bg-slate-300"/></button><div><p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-emerald-700">Move around Freetown</p><p className="mt-1 text-sm text-slate-500">Choose a service, set your route and review your fare.</p></div>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <button onClick={() => setViewMode('active')} className={`font-bold ${viewMode === 'active' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>Active Request</button>
                <button onClick={() => setViewMode('new')} className={`font-bold ${viewMode === 'new' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400'}`}>Create New</button>
              </div>

              {(tripError || tripRequest.error || rideNotice) && (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
                  {tripRequest.error || rideNotice || tripError}
                  {tripError && <button type="button" onClick={retryTrip} className="min-h-11 px-2 font-bold underline">Retry trip</button>}
                </p>
              )}
              {tripRequest.retained && (
                <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  A previous trip request is awaiting confirmation. Check that original request before creating another.
                </p>
              )}

              {tripLoading && !activeBooking && viewMode === 'active' ? (
                <div className="grid grid-cols-1 gap-4 animate-pulse">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4">
                    <div className="h-6 bg-slate-200 rounded w-1/2"></div>
                    <div className="h-12 bg-slate-100 rounded-xl"></div>
                    <div className="h-12 bg-slate-100 rounded-xl"></div>
                  </div>
                </div>
              ) : null}

              {viewMode === 'new' || (!activeBooking && viewMode === 'active') ? (
                <>
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Seats / Passengers (Max 3)</label>
                    <div className="flex gap-2">
                      {[1, 2, 3].map(count => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setPassengerCount(count)}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${
                            passengerCount === count
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                          }`}
                        >
                          {count} Seat{count > 1 ? 's' : ''}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5" aria-label="Choose a booking service">
                    <button
                      onClick={() => setServiceType('ride')}
                      aria-pressed={serviceType === 'ride'} className={`min-h-[4.5rem] rounded-xl px-2 py-3 text-xs font-extrabold flex flex-col items-center justify-center gap-1.5 transition ${serviceType === 'ride' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100' : 'text-slate-500 hover:bg-white/70'}`}
                    >
                      <Car size={16} /> Ride
                    </button>
                    <button
                      onClick={() => setServiceType('delivery')}
                      aria-pressed={serviceType === 'delivery'} className={`min-h-[4.5rem] rounded-xl px-2 py-3 text-xs font-extrabold flex flex-col items-center justify-center gap-1.5 transition ${serviceType === 'delivery' ? 'bg-white text-orange-700 shadow-sm ring-1 ring-orange-100' : 'text-slate-500 hover:bg-white/70'}`}
                    >
                      <Package size={16} /> Delivery
                    </button>
                    <button
                      onClick={() => setServiceType('scheduled')}
                      aria-pressed={serviceType === 'scheduled'} className={`min-h-[4.5rem] rounded-xl px-2 py-3 text-xs font-extrabold flex flex-col items-center justify-center gap-1.5 transition ${serviceType === 'scheduled' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100' : 'text-slate-500 hover:bg-white/70'}`}
                    >
                      <CalendarClock size={16} /> Schedule
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-extrabold text-slate-800">Choose your vehicle</span><span className="text-[10px] font-semibold text-slate-400">Tap to select</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(['keke', 'bike', 'car', 'van'] as const).map(v => {
                        const VehicleIcon = v === 'bike' ? Bike : v === 'van' ? Truck : CarFront;
                        const label = v === 'bike' ? 'Motorbike' : v === 'keke' ? 'Keke' : v === 'car' ? 'Car' : 'Van';
                        const selected = vehicleType === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setVehicleType(v)}
                            aria-label={`Choose ${label}`}
                            aria-pressed={selected}
                            className={`group relative flex min-h-[76px] items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left transition duration-200 ${selected ? 'border-emerald-400 bg-gradient-to-br from-emerald-50 to-white text-emerald-900 shadow-[0_8px_24px_rgba(5,150,105,.12)] ring-1 ring-emerald-200' : 'border-slate-200 bg-white text-slate-600 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md'}`}
                          >
                            <span aria-hidden="true" className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] shadow-inner transition ${selected ? 'bg-gradient-to-br from-emerald-600 to-teal-500 text-white' : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600'}`}>
                              <span className="absolute inset-1 rounded-[14px] border border-white/40"/>
                              <VehicleIcon size={24} strokeWidth={2.1}/>
                              {selected && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white ring-2 ring-emerald-500"/>}
                            </span>
                            <span className="min-w-0"><span className="block text-xs font-black">{label}</span><span className="mt-0.5 block text-[10px] text-slate-400">{v==='keke'?'3 seats':v==='bike'?'Quick solo ride':v==='car'?'Comfort ride':'Extra space'}</span></span>
                          </button>
                        );
                      })}
                    </div></div>

                    <p className="text-xs leading-5 text-slate-500">Choose pickup and destination on the map above. MatMove will preview your route and estimate the fare.</p>

                    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-slate-500 font-bold text-sm px-2">Total Fare (SLE)</span>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={offerAmount}
                          onChange={e => setOfferAmount(e.target.value)}
                          className="w-full outline-none text-lg bg-transparent font-bold text-slate-900 text-right pr-2"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => setOfferAmount(prev => Math.max(pricingRates[vehicleType]?.min || 1, (Number(prev) || 1) - 5).toString())}
                            className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                          >
                            <Minus size={16} />
                          </button>
                          <button
                            onClick={() => setOfferAmount(prev => ((Number(prev) || 1) + 5).toString())}
                            className="w-8 h-8 flex items-center justify-center bg-white border rounded-lg text-slate-600 hover:bg-slate-100"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>

                      {Number(offerAmount) > 0 && (
                        <div className="flex justify-between items-center bg-white p-2 rounded border border-slate-100 shadow-sm mt-2">
                          <div className="text-[11px] font-bold text-emerald-600">Driver Earns: SLE {(Number(offerAmount) * 0.85).toFixed(2)}</div>
                          <div className="text-[11px] font-bold text-rose-500">Platform Fee: SLE {(Number(offerAmount) * 0.15).toFixed(2)}</div>
                        </div>
                      )}
                    </div>



                    {serviceType === 'ride' && (
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <label className="block text-xs font-bold text-slate-700">
                          Payment method
                          <select
                            value={paymentMethod}
                            disabled={cashConfigLoading || !cashEnabled}
                            onChange={e => setPaymentMethod(e.target.value as 'digital' | 'cash')}
                            className="mt-2 w-full rounded-lg border p-3 text-sm font-semibold disabled:bg-slate-100"
                          >
                            <option value="digital">Digital wallet — full fare escrow</option>
                            <option value="cash" disabled={!cashEnabled}>Physical cash + 15% SLE wallet fee</option>
                          </select>
                        </label>
                        {cashConfigLoading ? (
                          <p className="mt-2 text-xs text-slate-500">Checking cash collection availability…</p>
                        ) : !cashEnabled ? (
                          <p className="mt-2 text-xs text-amber-800">{cashAccountsVerified ? 'Both Monime SLE accounts are verified. Physical cash rides remain disabled until MatMove completes final production approval.' : 'Physical cash rides are not enabled yet. MatMove is still verifying the separate escrow and platform-fee accounts.'}</p>
                        ) : null}
                        {paymentMethod === 'cash' && Number(offerAmount) > 0 && (() => {
                          const fareMinor = Math.round(Number(offerAmount) * 100);
                          const driverCashMinor = Math.round(fareMinor * 0.85);
                          const feeMinor = fareMinor - driverCashMinor;
                          return (
                            <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                              Driver receives {'SLE ' + (driverCashMinor / 100).toFixed(2)} in physical cash. MatMove secures {'SLE ' + (feeMinor / 100).toFixed(2)} from your SLE wallet into escrow, then releases it to the platform fee account after both rider and driver confirm the handover. Your total fare remains {'SLE ' + (fareMinor / 100).toFixed(2)}.
                            </p>
                          );
                        })()}
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
                    disabled={isRequesting || !tripRequest.ready || !!tripRequest.error}
                    className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition shadow-md mt-4"
                  >
                    {isRequesting || tripRequest.working ? <Loader2 size={20} className="animate-spin mx-auto" /> : tripRequest.retained ? 'Check Original Request' : 'Confirm Request'}
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  {activeBooking && (activeBooking.status === 'accepted' || activeBooking.status === 'in_progress') ? (
                    <>
                      <Car size={44} className="text-emerald-600 mx-auto mb-3" />
                      <h4 className="font-bold text-lg text-slate-900">
                        {activeBooking.status === 'in_progress' ? 'Trip in Progress!' : 'Driver is on the way!'}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {activeBooking.payment_method === 'cash'
                          ? 'Cash ride: driver receives SLE ' + (Math.round(Math.round(Number(activeBooking.fare_amount || 0) * 100) * 0.85) / 100).toFixed(2) + ' physically; MatMove\'s 15% fee is reserved digitally.'
                          : 'Fare (SLE ' + Number(activeBooking.fare_amount || 0).toLocaleString() + ') held securely in Escrow.'}
                      </p>

                      {activeBooking.driver && (
                        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-left mb-4">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">Assigned Driver</span>
                          <span className="font-bold text-slate-900 block text-sm">{activeBooking.driver.full_name}</span>
                          <span className="text-xs text-slate-600 flex items-center gap-1 mt-0.5"><Smartphone size={13} /> {activeBooking.driver.phone}</span>
                        </div>
                      )}

                      {activeBooking.status === 'accepted' && activeBooking.payment_method !== 'cash' && (
                        <div className={`p-3 rounded-2xl border text-xs mb-3 space-y-1 ${elapsedSeconds <= 300 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                          <div className="flex items-center gap-1.5 font-bold">
                            <Clock size={15} />
                            {elapsedSeconds <= 300 ? (
                              <span>Free Cancellation: {Math.floor((300 - elapsedSeconds) / 60)}:{(300 - elapsedSeconds) % 60 < 10 ? '0' : ''}{(300 - elapsedSeconds) % 60}</span>
                            ) : (
                              <span>Late Cancellation: 1% Fee Applies (Split 50/50)</span>
                            )}
                          </div>
                        </div>
                      )}

                      {activeBooking.status === 'accepted' && activeBooking.payment_method === 'cash' && (
                        <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Accepted cash rides cannot be cancelled by the rider through the app under the current policy. Contact MatMove support for review.</p>
                      )}

                      {activeBooking.status === 'accepted' && activeBooking.payment_method !== 'cash' && (
                        <button onClick={cancelTrip} disabled={isRequesting} className="mb-2 text-rose-600 font-bold border border-rose-200 bg-rose-50 p-2.5 rounded-xl w-full text-xs">
                          Cancel Trip & Release Hold
                        </button>
                      )}

                      {activeBooking.status === 'in_progress' && (
                        <button
                          onClick={executeRidePayment}
                          disabled={isRequesting}
                          className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl text-xs hover:bg-emerald-700 transition shadow-lg flex items-center justify-center gap-2"
                        >
                          {isRequesting ? <Loader2 size={18} className="animate-spin" /> : activeBooking.payment_method === 'cash' ? 'Confirm Cash Handed to Driver' : 'Confirm Arrival & Release Driver Payment'}
                        </button>
                      )}
                    </>
                  ) : activeBooking ? (
                    <>
                      <Loader2 size={36} className="animate-spin text-orange-600 mx-auto mb-3" />
                      <h4 className="font-bold text-base text-slate-900">
                        {activeBooking.status === 'cash_reserve_pending' ? 'Securing MatMove cash fee…' : activeBooking.status === 'cash_review_required' ? 'Cash payment requires support review' : activeBooking.status === 'pending_admin' ? 'Request sent to Dispatch...' : 'Searching for Drivers...'}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">{activeBooking.status === 'cash_reserve_pending' ? 'Your request stays hidden from drivers until the 15% fee reserve is verified.' : activeBooking.status === 'cash_review_required' ? 'This request has not been released to drivers. Do not submit another payment.' : 'Please wait while nearby drivers review your request.'}</p>
                      <button onClick={cancelTrip} className="text-rose-600 text-xs font-bold hover:underline mt-3">Cancel Request</button>
                    </>
                  ) : null}

                  {activeBooking && activeBooking.payment_method !== 'cash' && ['pending', 'pending_admin'].includes(activeBooking.status) && ['ride', 'delivery'].includes(activeBooking.service_type) && (
                    <div className="mt-3 text-left">
                      <FareNegotiation key={`${profile?.id}:${activeBooking.id}`} userId={profile?.id} bookingId={activeBooking.id} role="rider" onFareChange={applyFareSnapshot} />
                    </div>
                  )}
                </div>
              )}
            </div>}

            <div className="order-1 min-w-0">
              {activeBooking && ['accepted', 'in_progress'].includes(activeBooking.status) ? (
                <ActiveTripMap key={activeBooking.id} userId={profile?.id} bookingId={activeBooking.id} />
              ) : (
                <RideLocationPicker
                  layout="map-first"
                  key={profile?.id || 'location-picker'}
                  userId={profile?.id}
                  onBack={onBack}
                  bookingReady={Boolean(pickupCoords && destinationCoords)}
                  bookingSheetExpanded={bookingSheetExpanded}
                  onRouteEditingChange={setRouteEditing}
                  onChange={(selection: TripLocations) => {
                    const ready = Boolean(selection.pickup && selection.destination);
                    setRouteEditing(!ready);
                    if (ready) { setBookingSheetExpanded(true); setViewMode('new'); }
                    setPickup(selection.pickup?.address || '');
                    setDestination(selection.destination?.address || '');
                    setPickupCoords(selection.pickup?.coords || null);
                    setDestinationCoords(selection.destination?.coords || null);
                    setTripDistanceKm(selection.distanceKm);

                    if (selection.distanceKm !== null) {
                      const rate = pricingRates?.[vehicleType] || defaultPricing[vehicleType] || { min: 15, perKm: 3 };
                      setOfferAmount(
                        Math.max(
                          rate.min,
                          Math.ceil((rate.min + selection.distanceKm * rate.perKm) / 5) * 5
                        ).toString()
                      );
                    } else {
                      setOfferAmount('');
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}

        {activeSection === 'wallet' && (
          <div className="w-full space-y-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-4 px-2">My Wallets</h2>
            {WalletCards}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center mt-6">
              <h3 className="text-xl font-bold text-slate-900 mb-2">Wallet Actions</h3>
              <p className="text-sm text-slate-500 mb-8">Load your wallet anytime. Verify your identity to transfer or withdraw.</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full">
                <button
                  onClick={() => setIsLoadModalOpen(true)}
                  disabled={!canLoad || !hasSleAccount || isSettingUpWallet}
                  className="p-4 sm:p-6 rounded-2xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition flex flex-col items-center gap-3 font-bold disabled:opacity-50"
                >
                  <div className="p-3 bg-white rounded-full shadow-sm"><ArrowDownLeft size={24} /></div>
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
                  <div className="p-3 bg-white rounded-full shadow-sm"><Users size={24} /></div>
                  Transfer
                </button>
              </div>
            </div>

            <TransactionHistory transactions={transactions} onSelect={setSelectedTx} />
          </div>
        )}
      </div>

      {selectedTx && <TransactionModal tx={selectedTx} onClose={() => setSelectedTx(null)} />}
      {isLoadModalOpen && (
        <WalletTopUp userId={profile?.id} allowed={canLoad && hasSleAccount} onClose={() => setIsLoadModalOpen(false)} onPaid={fetchLiveBalance} />
      )}
      {isPayoutModalOpen && (
        <PayoutPanel userId={profile?.id} allowed={canSend && hasSleAccount} onClose={() => setIsPayoutModalOpen(false)} onBalanceChange={fetchLiveBalance} />
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} disabled={isProcessingTransfer} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Account Transfer</h2>
            <label className="block my-4 text-sm font-bold">
              Send from
              <select
                value={transferCurrency}
                disabled={isProcessingTransfer}
                onChange={e => { setTransferCurrency(e.target.value as 'SLE' | 'USD'); setTransferError(''); setTransferNotice(''); }}
                className="block w-full rounded-xl border p-3 mt-2"
              >
                <option value="SLE">SLE wallet → SLE account</option>
                <option value="USD">USD wallet → USD account</option>
              </select>
            </label>

            {transferError && <p role="alert" className="mb-3 text-sm text-red-700 font-bold">{transferError}</p>}
            {transferNotice && <p role="status" className="mb-3 text-sm text-emerald-700 font-bold">{transferNotice}</p>}

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
                placeholder="Recipient Account ID (e.g. fac-k6V8...)"
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
  const [orderQty, setOrderQty] = useState(1);
  const checkoutDialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = checkoutDialog.current;
    if (orderModalOpen && dialog && !dialog.open) dialog.showModal();
    else if (!orderModalOpen && dialog?.open) dialog.close();
  }, [orderModalOpen]);
  const cartWriteLock = useRef(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [cartNotice, setCartNotice] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');

  const fetchShopProducts = useCallback(async () => {
    setProductsLoading(true); setProductsError('');
    try {
      let result = await supabase.from('products').select('*, merchant:merchant_id(business_name, whatsapp_number)').is('deleted_at',null).order('created_at', { ascending: false });
      if (result.error) result = await supabase.from('products').select('*').is('deleted_at',null).order('created_at', { ascending: false });
      if (result.error) throw result.error;
      setProducts(result.data || []);
    } catch {
      setProductsError('Could not load shop products.');
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShopProducts();
  }, [fetchShopProducts]);

  const handleAddToCart = async (product: any) => {
    if (cartWriteLock.current || !catalogCheckoutAllowed(product)) return;
    cartWriteLock.current = true; setCartBusy(true);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session) throw new Error('Sign in again.');
      const { error } = await supabase.from('cart_items').insert({
        rider_id: profile.id,
        product_id: product.id,
        quantity: 1
      });
      if (error) throw error;
      setCartNotice(`${product.name} added to cart.`);
    } catch (e: any) {
      setCartNotice(e.message || 'Could not update cart.');
    } finally {
      cartWriteLock.current = false; setCartBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingCart className="text-blue-600" size={28} />
        <h1 className="text-3xl font-bold text-slate-900">Shop Marketplace</h1>
      </div>
      {cartNotice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm">{cartNotice}</p>}
      {productsLoading ? (
        <div className="py-12 text-center text-sm text-slate-500"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> Loading products…</div>
      ) : productsError ? (
        <div className="p-4 bg-red-50 text-red-800 text-sm rounded-xl">{productsError}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col shadow-sm">
              <ProductGallery product={p} />
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-base text-slate-900">{p.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description}</p>
                </div>
                <div className="mt-4 pt-3 border-t">
                  <span className="text-lg font-black text-blue-600 block mb-3">{catalogMoney(p.price, p.currency ?? 'SLE')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={cartBusy || !catalogCheckoutAllowed(p)}
                      onClick={() => handleAddToCart(p)}
                      className="bg-slate-100 text-slate-700 text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <ShoppingCart size={14} /> Add to Cart
                    </button>
                    <button
                      disabled={!catalogCheckoutAllowed(p)}
                      onClick={() => { setSelectedProduct(p); setOrderQty(1); setOrderModalOpen(true); }}
                      className="bg-blue-600 text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <ArrowRight size={14} /> Order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <dialog ref={checkoutDialog} onClose={() => setOrderModalOpen(false)} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border-0 bg-white p-5 shadow-2xl backdrop:bg-slate-950/60">
        <div className="flex items-center justify-between gap-3 mb-4"><h2 className="text-xl font-bold">{selectedProduct?.name || 'Order Checkout'}</h2><button type="button" className="text-slate-400" onClick={() => setOrderModalOpen(false)}><X size={20} /></button></div>
        {selectedProduct && (
          <label className="block text-xs font-bold text-slate-700 mb-3">
            Quantity
            <input type="number" min="1" max="100" value={orderQty} onChange={e => setOrderQty(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full border rounded-xl p-2.5 text-sm" />
          </label>
        )}
        <MerchantCheckout userId={profile?.id} items={selectedProduct ? [{ productId: selectedProduct.id, quantity: orderQty }] : []} initialPhone={profile?.phone || profile?.phone_number || ''} />
      </dialog>
    </div>
  );
}

function RiderTrips({ profile }: any) {
  return <TripHistory userId={profile?.id} role="rider" />;
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
          <p><strong>1. Compliance with SLRSA:</strong> All users must strictly adhere to road traffic regulations set forth by SLRSA.</p>
          <p><strong>2. Liability:</strong> MatMove operates as a technology platform connecting users and is not liable for traffic accidents or road delays.</p>
          <p><strong>3. Vehicle Safety:</strong> All vehicles must be inspected, insured, and licensed.</p>
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