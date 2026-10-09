import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RideLocationPicker, TripLocations } from '@/components/RideLocationPicker';
import { WalletTopUp } from '@/components/WalletTopUp';
import { useWalletAccess } from '@/lib/useWalletAccess';
import { walletFetch } from '@/lib/apiFetch';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Store, Plus, Package, RefreshCw, X, Loader2, MapPin,
  Car, CalendarClock, Phone, Minus, Smartphone,
  ArrowDownLeft, ArrowUpRight, Users, ArrowRight,
  Trash2, Wallet, Activity, Copy, Check, Share2,
  Image as ImageIcon, User, MessageCircle,
} from 'lucide-react';

type ServiceType = 'delivery' | 'ride' | 'scheduled';
type VehicleType = 'keke' | 'bike' | 'car' | 'van';

export function MerchantDashboard(props: any) {
  if (props.activeSection === 'inventory') {
    return <MerchantInventory profile={props.profile} />;
  }

  if (props.activeSection === 'trips') {
    return <MerchantTrips profile={props.profile} />;
  }

  return <MerchantMain {...props} />;
}

function MerchantMain({ profile, wallet, activeSection }: any) {
  const [sleWallet, setSleWallet] = useState<any>(wallet);
  const [usdWallet, setUsdWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txFilter, setTxFilter] = useState<'recent' | 'all'>('recent');
  const [isCreatingUsd, setIsCreatingUsd] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [pricingRates, setPricingRates] = useState<any>({
    bike: { min: 15, perKm: 3 },
    keke: { min: 20, perKm: 5 },
    car: { min: 30, perKm: 8 },
    van: { min: 50, perKm: 15 },
  });

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<[number, number] | null>(null);

  const [serviceType, setServiceType] = useState<ServiceType>('delivery');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
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

  const canTransact = !isFrozen && isApproved;

  const monimeAccountId =
    sleWallet?.monime_account_id ||
    sleWallet?.metadata?.monime_account_id ||
    'Pending Setup';

  useEffect(() => {
    if (tripDistanceKm === null) return;

    const rate = pricingRates[vehicleType] || { min: 15, perKm: 3 };

    setOfferAmount(
      Math.max(
        rate.min,
        Math.ceil((rate.min + tripDistanceKm * rate.perKm) / 5) * 5,
      ).toString(),
    );
  }, [tripDistanceKm, vehicleType, pricingRates]);

  useEffect(() => {
    supabase.from('pricing_settings').select('*').then(({ data }) => {
      if (data?.length) {
        const rates: any = {};

        data.forEach(r => {
          rates[r.vehicle_type] = {
            min: Number(r.min_fare),
            perKm: Number(r.per_km_rate),
          };
        });

        setPricingRates(rates);
      }
    });

    if (profile?.id && !localStorage.getItem(`matmove_policy_${profile.id}`)) {
      setShowPolicy(true);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;

    const checkActiveTrip = async () => {
      const { data } = await supabase
        .from('bookings')
        .select('*, driver:driver_id(full_name, phone)')
        .eq('rider_id', profile.id)
        .in('status', ['pending', 'pending_admin', 'accepted', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setActiveBooking(data || null);
    };

    void checkActiveTrip();

    const channel = supabase
      .channel(`merchant-active-booking-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `rider_id=eq.${profile.id}`,
        },
        () => void checkActiveTrip(),
      )
      .subscribe();

    const timer = window.setInterval(() => void checkActiveTrip(), 3000);

    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(timer);
    };
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

      if (!response.ok) {
        throw new Error(data.error || 'Unable to read wallet balances.');
      }

      if (data.sleWallet) setSleWallet(data.sleWallet);
      if (data.usdWallet) setUsdWallet(data.usdWallet);
      if (data.transactions) setTransactions(data.transactions);
    } catch (err) {
      console.error('Wallet refresh failed:', err);
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
      `Amount: ${isCredit ? '+' : '-'}${tx.amount?.currency || 'SLE'} ${
        (Number(tx.amount?.value || 0) / 100).toFixed(2)
      }`,
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
      // User canceled share
    }
  };

  const handleCreateUsdWallet = async () => {
    if (!window.confirm('Create a USD wallet?')) return;

    setIsCreatingUsd(true);

    try {
      const { response, data, finish } = await walletFetch(
        '/api/create-usd-wallet',
        {},
      );

      if (!response.ok) {
        throw new Error(data.error || 'Unable to create USD wallet.');
      }

      finish();
      await fetchLiveBalance();
      alert('USD wallet created successfully.');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsCreatingUsd(false);
    }
  };

  const handleDispatchDelivery = async () => {
    if (isRequesting) return;

    if (!pickupCoords || !destinationCoords) {
      return alert('Choose pickup and destination using search or map pins.');
    }

    if (serviceType === 'scheduled' && !scheduledTime) {
      return alert('Select a time for your scheduled request.');
    }

    let finalAmount = 0;

    if (serviceType !== 'scheduled') {
      finalAmount = Number(offerAmount);

      if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
        return alert('Preview your route to calculate the fare.');
      }

      const minimumFare = pricingRates[vehicleType]?.min || 1;

      if (finalAmount < minimumFare) {
        return alert(
          `Minimum fare for ${vehicleType.toUpperCase()} is SLE ${minimumFare}.`,
        );
      }
    }

    if (Number(sleWallet?.balance || 0) < finalAmount) {
      return alert(
        `Insufficient balance. You need SLE ${finalAmount} for this request.`,
      );
    }

    setIsRequesting(true);

    try {
      const { data, error } = await supabase
        .from('bookings')
        .insert({
          rider_id: profile.id,
          service_type: serviceType === 'scheduled' ? 'delivery' : serviceType,
          vehicle_type: serviceType === 'scheduled' ? null : vehicleType,
          pickup_location: pickup,
          destination_location: destination,
          fare_amount: finalAmount,
          scheduled_time: serviceType === 'scheduled' ? scheduledTime : null,
          status: 'pending_admin',
        })
        .select()
        .single();

      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsRequesting(false);
    }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;

    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', activeBooking.id);

      if (error) throw error;
      setActiveBooking(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const completeTrip = async () => {
    if (!activeBooking || isRequesting) return;

    setIsRequesting(true);

    try {
      const response = await fetch('/api/complete-ride-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: activeBooking.id,
          driverId: activeBooking.driver_id,
          amount: activeBooking.fare_amount,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to complete this trip.');
      }

      alert('Payment released.');
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
      setIsRequesting(false);
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

    const amount = Number(payoutAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return alert('Enter a valid amount.');
    }

    if (sleWallet?.balanceAvailable === false) {
      return alert('Refresh your wallet balance before withdrawing.');
    }

    if (amount > Number(sleWallet?.balance || 0)) {
      return alert('Amount exceeds your available SLE balance.');
    }

    if (!payoutPhone.trim()) {
      return alert('Enter your mobile money number.');
    }

    setIsProcessingPayout(true);

    try {
      const { response, data, finish } = await walletFetch(
        '/api/create-monime-payout',
        {
          amount: payoutAmount,
          currency: 'SLE',
          destinationPhone: payoutPhone,
          networkProvider,
        },
      );

      if (!response.ok) {
        throw new Error(data.error || 'Payout could not be submitted.');
      }

      if (data.data?.status === 'completed') finish();

      alert(
        data.data?.status === 'completed'
          ? 'Payout completed.'
          : 'Payout submitted. Check transaction history before making another withdrawal.',
      );

      setIsPayoutModalOpen(false);
      setPayoutAmount('');
      setPayoutPhone('');
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
          recipientAccountId: transferRecipient.trim(),
        },
      );

      if (!response.ok) {
        throw new Error(data.error || 'Transfer could not be submitted.');
      }

      const status = data.data?.status;

      setTransferNotice(
        status === 'completed'
          ? 'Transfer completed.'
          : `Transfer ${status || 'submitted'}. Do not create another payment while this transfer is pending.`,
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
    <div
      className={`grid grid-cols-1 ${
        activeSection === 'wallet' ? 'md:grid-cols-2' : ''
      } gap-4`}
    >
      <div className="relative rounded-3xl bg-orange-600 p-6 text-white shadow-xl">
        <button
          onClick={() => void fetchLiveBalance()}
          disabled={isRefreshing}
          className="absolute right-4 top-4 flex items-center gap-2 rounded-xl bg-white/10 p-2 text-xs font-bold hover:bg-white/20"
        >
          <RefreshCw
            size={14}
            className={isRefreshing ? 'animate-spin' : ''}
          />
          {isRefreshing ? 'Syncing…' : 'Refresh'}
        </button>

        <p className="mt-6 text-xs font-bold uppercase text-orange-200">
          SLE Operating Wallet
        </p>
        <p className="mt-1 text-3xl font-bold">
          SLE{' '}
          {sleWallet?.balanceAvailable === false
            ? 'Unavailable'
            : Number(sleWallet?.balance || 0).toFixed(2)}
        </p>

        <div className="mt-3 flex items-center gap-2 break-all text-xs">
          <span>ID: {monimeAccountId}</span>
          <button
            onClick={() => void handleCopy(monimeAccountId)}
            aria-label="Copy SLE account ID"
          >
            {copiedId === monimeAccountId ? (
              <Check size={14} />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-700 bg-slate-800 p-6 text-white shadow-xl">
        {usdWallet?.monime_account_id ? (
          <>
            <p className="text-xs font-bold uppercase text-slate-400">
              USD Reserve Wallet
            </p>
            <p className="mt-1 text-3xl font-bold text-emerald-400">
              USD{' '}
              {usdWallet.balanceAvailable === false
                ? 'Unavailable'
                : Number(usdWallet.balance || 0).toFixed(2)}
            </p>

            <div className="mt-3 flex items-center gap-2 break-all text-xs text-slate-300">
              <span>ID: {usdWallet.monime_account_id}</span>
              <button
                onClick={() => void handleCopy(usdWallet.monime_account_id)}
                aria-label="Copy USD account ID"
              >
                {copiedId === usdWallet.monime_account_id ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-2">
            <button
              onClick={() => void handleCreateUsdWallet()}
              disabled={isCreatingUsd}
              className="mb-2 rounded-full bg-slate-700 p-3 hover:bg-slate-600"
              aria-label="Create USD wallet"
            >
              {isCreatingUsd ? (
                <Loader2 size={24} className="animate-spin text-emerald-400" />
              ) : (
                <Plus size={24} className="text-emerald-400" />
              )}
            </button>
            <span className="text-sm font-bold">Create USD Wallet</span>
          </div>
        )}
      </div>
    </div>
  );

  const validTransactions = Array.isArray(transactions) ? transactions : [];
  const displayedTransactions =
    txFilter === 'recent' ? validTransactions.slice(0, 5) : validTransactions;

  return (
    <div className="min-h-screen flex-1 bg-slate-50">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-orange-100 p-2 text-orange-600">
            <Store size={20} />
          </div>
          <h2 className="font-bold text-slate-900">
            {profile?.business_name || profile?.full_name || 'Merchant Store'}
          </h2>
        </div>

        <div className="flex gap-2">
          {!canTransact ? (
            <span className="rounded-xl border border-red-200 bg-red-100 px-4 py-2 text-xs font-bold text-red-700">
              {isFrozen ? 'Wallet unavailable' : 'Approval pending'}
            </span>
          ) : (
            <>
              <button
                onClick={() => setIsLoadModalOpen(true)}
                className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"
              >
                Load
              </button>
              <button
                onClick={() => setIsPayoutModalOpen(true)}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
              >
                Withdraw
              </button>
              <button
                onClick={() => setIsTransferModalOpen(true)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white"
              >
                Transfer
              </button>
            </>
          )}
        </div>
      </header>

      {activeSection === 'home' && (
        <div className="flex flex-col lg:flex-row">
          <div className="w-full space-y-6 border-r bg-white p-6 lg:w-[450px] lg:shrink-0">
            {walletCards}
            <h3 className="text-lg font-bold">Dispatch Request</h3>

            {!activeBooking ? (
              <>
                <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
                  <button
                    onClick={() => setServiceType('delivery')}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-xs font-bold ${
                      serviceType === 'delivery'
                        ? 'bg-white text-orange-600 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    <Package size={16} /> Delivery
                  </button>
                  <button
                    onClick={() => setServiceType('ride')}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-xs font-bold ${
                      serviceType === 'ride'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    <Car size={16} /> Ride
                  </button>
                  <button
                    onClick={() => setServiceType('scheduled')}
                    className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-xs font-bold ${
                      serviceType === 'scheduled'
                        ? 'bg-white text-emerald-600 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    <CalendarClock size={16} /> Schedule
                  </button>
                </div>

                {serviceType !== 'scheduled' && (
                  <div className="grid grid-cols-4 gap-2">
                    {(['keke', 'bike', 'car', 'van'] as VehicleType[]).map(v => (
                      <button
                        key={v}
                        onClick={() => setVehicleType(v)}
                        className={`rounded-xl py-2 text-xs font-bold uppercase ${
                          vehicleType === v
                            ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-sm text-slate-600">
                  Choose pickup and destination in the map panel, then
                  preview your route.
                </p>

                {serviceType !== 'scheduled' && (
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <label className="text-sm font-bold text-slate-600">
                      Total Fare (SLE)
                    </label>

                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={offerAmount}
                        onChange={e => setOfferAmount(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border bg-white p-2 text-lg font-bold"
                        placeholder="Amount"
                      />
                      <button
                        onClick={() =>
                          setOfferAmount(previous =>
                            Math.max(
                              pricingRates[vehicleType]?.min || 1,
                              Number(previous || 0) - 5,
                            ).toString(),
                          )
                        }
                        className="rounded-lg border bg-white p-2"
                        aria-label="Decrease fare"
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        onClick={() =>
                          setOfferAmount(previous =>
                            (Number(previous || 0) + 5).toString(),
                          )
                        }
                        className="rounded-lg border bg-white p-2"
                        aria-label="Increase fare"
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    {Number(offerAmount) > 0 && (
                      <div className="mt-3 flex justify-between gap-2 text-xs font-bold">
                        <span className="text-emerald-600">
                          Driver: SLE {(Number(offerAmount) * 0.85).toFixed(2)}
                        </span>
                        <span className="text-rose-600">
                          Platform: SLE {(Number(offerAmount) * 0.15).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {serviceType === 'scheduled' && (
                  <label className="block text-sm font-bold">
                    Schedule delivery
                    <input
                      type="datetime-local"
                      value={scheduledTime}
                      onChange={e => setScheduledTime(e.target.value)}
                      className="mt-2 w-full rounded-xl border p-3"
                    />
                  </label>
                )}

                <button
                  onClick={() => void handleDispatchDelivery()}
                  disabled={isRequesting}
                  className="w-full rounded-xl bg-slate-900 py-4 font-bold text-white disabled:opacity-50"
                >
                  {isRequesting ? (
                    <Loader2 size={20} className="mx-auto animate-spin" />
                  ) : (
                    'Request Dispatch'
                  )}
                </button>
              </>
            ) : (
              <div className="py-6 text-center">
                {['accepted', 'in_progress'].includes(activeBooking.status) ? (
                  <>
                    <Car size={48} className="mx-auto mb-4 text-emerald-600" />
                    <h4 className="text-xl font-bold">
                      {activeBooking.status === 'in_progress'
                        ? 'Trip in progress'
                        : 'Driver is on the way'}
                    </h4>
                    <p className="mt-2 text-sm text-slate-500">
                      Fare: SLE {activeBooking.fare_amount}
                    </p>

                    {activeBooking.driver && (
                      <div className="my-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-left">
                        <p className="text-xs font-bold uppercase text-emerald-600">
                          Your Driver
                        </p>
                        <p className="mt-1 font-bold">
                          {activeBooking.driver.full_name}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-sm">
                          <Smartphone size={14} />
                          {activeBooking.driver.phone}
                        </p>
                      </div>
                    )}

                    {activeBooking.status === 'in_progress' && (
                      <button
                        onClick={() => void completeTrip()}
                        disabled={isRequesting}
                        className="w-full rounded-xl bg-emerald-600 py-4 font-bold text-white disabled:opacity-50"
                      >
                        {isRequesting
                          ? 'Processing…'
                          : `Pay SLE ${activeBooking.fare_amount} & Complete Trip`}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Loader2
                      size={40}
                      className="mx-auto mb-4 animate-spin text-orange-600"
                    />
                    <h4 className="text-lg font-bold">
                      {activeBooking.status === 'pending_admin'
                        ? 'Request sent to Dispatch'
                        : 'Finding a driver'}
                    </h4>
                    <p className="mt-2 text-sm text-slate-500">
                      Please wait while a driver is assigned.
                    </p>
                    <button
                      onClick={() => void cancelTrip()}
                      className="mt-4 text-sm font-bold text-red-600"
                    >
                      Cancel Request
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <RideLocationPicker
              onChange={(selection: TripLocations) => {
                setPickup(selection.pickup?.address || '');
                setDestination(selection.destination?.address || '');
                setPickupCoords(selection.pickup?.coords || null);
                setDestinationCoords(selection.destination?.coords || null);
                setTripDistanceKm(selection.distanceKm);

                if (selection.distanceKm !== null) {
                  const rate =
                    pricingRates[vehicleType] || { min: 15, perKm: 3 };

                  setOfferAmount(
                    Math.max(
                      rate.min,
                      Math.ceil(
                        (rate.min + selection.distanceKm * rate.perKm) / 5,
                      ) * 5,
                    ).toString(),
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
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
          <h2 className="text-2xl font-bold">My Wallets</h2>
          {walletCards}

          <div className="rounded-3xl border bg-white p-6 text-center">
            <h3 className="text-xl font-bold">Wallet Actions</h3>
            <p className="mb-6 mt-2 text-sm text-slate-500">
              Transfers support SLE to SLE and USD to USD.
            </p>

            {!canTransact && (
              <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {isFrozen
                  ? 'Your wallet is frozen. Contact support.'
                  : 'Your account must be approved before transactions.'}
              </p>
            )}

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setIsLoadModalOpen(true)}
                disabled={!canTransact}
                className="flex flex-col items-center gap-3 rounded-2xl bg-blue-50 p-4 font-bold text-blue-700 disabled:opacity-50"
              >
                <ArrowDownLeft size={24} /> Load
              </button>
              <button
                onClick={() => setIsPayoutModalOpen(true)}
                disabled={!canTransact}
                className="flex flex-col items-center gap-3 rounded-2xl bg-emerald-50 p-4 font-bold text-emerald-700 disabled:opacity-50"
              >
                <ArrowUpRight size={24} /> Withdraw
              </button>
              <button
                onClick={() => setIsTransferModalOpen(true)}
                disabled={!canTransact}
                className="flex flex-col items-center gap-3 rounded-2xl bg-purple-50 p-4 font-bold text-purple-700 disabled:opacity-50"
              >
                <Users size={24} /> Transfer
              </button>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5">
            <div className="mb-5 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold">
                <Activity size={20} /> Transactions
              </h3>
              <div className="flex rounded-lg bg-slate-100 p-1">
                {(['recent', 'all'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setTxFilter(filter)}
                    className={`rounded-md px-3 py-2 text-xs font-bold ${
                      txFilter === filter ? 'bg-white shadow-sm' : ''
                    }`}
                  >
                    {filter === 'recent' ? 'Recent' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {!displayedTransactions.length && (
              <p className="py-6 text-center text-slate-500">
                No transactions found.
              </p>
            )}

            <div className="space-y-3">
              {displayedTransactions.map(tx => {
                if (!tx) return null;

                const credit =
                  String(tx.balanceImpact).toUpperCase() === 'CREDIT';
                const date =
                  tx.createdAt || tx.created_at || tx.timestamp || tx.date;
                const dateLabel =
                  date && !isNaN(new Date(date).getTime())
                    ? new Date(date).toLocaleString()
                    : 'Date pending';

                return (
                  <div
                    key={tx.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-slate-50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-full p-2 ${
                          credit
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {credit ? (
                          <ArrowDownLeft size={18} />
                        ) : (
                          <ArrowUpRight size={18} />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold">
                          {tx.description || tx.type || 'Transaction'}
                        </p>
                        <p className="text-xs text-slate-500">{dateLabel}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p
                          className={`font-bold ${
                            credit ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {credit ? '+' : '-'} {tx.amount?.currency || 'SLE'}{' '}
                          {(Number(tx.amount?.value || 0) / 100).toFixed(2)}
                        </p>
                        <p className="text-xs uppercase text-slate-500">
                          {tx.status}
                        </p>
                      </div>
                      <button
                        onClick={() => void handleShareReceipt(tx)}
                        aria-label="Share receipt"
                        className="p-2 text-slate-500"
                      >
                        <Share2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <button
              onClick={closeModals}
              disabled={isProcessingPayout}
              className="absolute right-4 top-4 p-2 text-slate-400"
              aria-label="Close withdrawal"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold">Withdraw to Mobile Money</h2>
            <p className="mb-6 mt-2 text-sm text-slate-500">
              Available: SLE{' '}
              {sleWallet?.balanceAvailable === false
                ? 'Unavailable'
                : Number(sleWallet?.balance || 0).toFixed(2)}
            </p>

            <div className="mb-6 space-y-4">
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount (SLE)"
                value={payoutAmount}
                disabled={isProcessingPayout}
                onChange={e => setPayoutAmount(e.target.value)}
                className="w-full rounded-xl border p-4 text-xl font-bold"
              />

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setNetworkProvider('orange')}
                  disabled={isProcessingPayout}
                  className={`rounded-xl border p-3 ${
                    networkProvider === 'orange'
                      ? 'border-orange-500 bg-orange-50 font-bold text-orange-700'
                      : 'text-slate-500'
                  }`}
                >
                  Orange Money
                </button>
                <button
                  onClick={() => setNetworkProvider('afrimoney')}
                  disabled={isProcessingPayout}
                  className={`rounded-xl border p-3 ${
                    networkProvider === 'afrimoney'
                      ? 'border-purple-500 bg-purple-50 font-bold text-purple-700'
                      : 'text-slate-500'
                  }`}
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
                className="w-full rounded-xl border p-4"
              />
            </div>

            <button
              onClick={() => void executePayout()}
              disabled={
                !canTransact ||
                isProcessingPayout ||
                !payoutAmount ||
                !payoutPhone
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 p-4 font-bold text-white disabled:opacity-50"
            >
              {isProcessingPayout ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <ArrowUpRight size={20} />
              )}
              {isProcessingPayout ? 'Processing…' : 'Confirm Withdrawal'}
            </button>
          </div>
        </div>
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <button
              onClick={closeModals}
              disabled={isProcessingTransfer}
              className="absolute right-4 top-4 p-2 text-slate-400"
              aria-label="Close transfer"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold">Account Transfer</h2>

            <label className="my-4 block text-sm font-bold">
              Send from
              <select
                value={transferCurrency}
                disabled={isProcessingTransfer}
                onChange={e => {
                  setTransferCurrency(e.target.value as 'SLE' | 'USD');
                  setTransferError('');
                  setTransferNotice('');
                }}
                className="mt-2 block w-full rounded-xl border p-3"
              >
                <option value="SLE">SLE wallet → SLE account</option>
                <option value="USD">USD wallet → USD account</option>
              </select>
            </label>

            {transferError && (
              <p role="alert" className="mb-3 text-sm text-red-700">
                {transferError}
              </p>
            )}
            {transferNotice && (
              <p role="status" className="mb-3 text-sm text-blue-700">
                {transferNotice}
              </p>
            )}

            <p className="mb-4 text-sm text-slate-500">
              Paste the recipient’s account ID for the selected currency.
            </p>

            <div className="mb-6 space-y-4">
              <input
                type="number"
                min="0.01"
                step="0.01"
                disabled={isProcessingTransfer}
                placeholder={`Amount (${transferCurrency})`}
                value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full rounded-xl border p-4 text-xl font-bold"
              />
              <input
                type="text"
                disabled={isProcessingTransfer}
                placeholder="Recipient account ID (fac-...)"
                value={transferRecipient}
                onChange={e => setTransferRecipient(e.target.value)}
                className="w-full rounded-xl border p-4"
              />
            </div>

            <button
              onClick={() => void executeTransfer()}
              disabled={
                !canTransact ||
                isProcessingTransfer ||
                !transferAmount ||
                !transferRecipient
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 p-4 font-bold text-white disabled:opacity-50"
            >
              {isProcessingTransfer ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Users size={20} />
              )}
              Send Transfer
            </button>
          </div>
        </div>
      )}

      {showPolicy && <PolicyModal onAccept={handleAcceptPolicy} />}
    </div>
  );
}

function MerchantInventory({ profile }: any) {
  const [activeTab, setActiveTab] =
    useState<'products' | 'orders'>('products');
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderFilter, setOrderFilter] =
    useState<'all' | 'pending' | 'completed'>('all');
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [whatsappDigits, setWhatsappDigits] = useState('232');
  const [imageUrl, setImageUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);

  const fetchProducts = async () => {
    const { data, error: queryError } = await supabase
      .from('products')
      .select('*')
      .eq('merchant_id', profile.id)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setProducts(data || []);
  };

  const fetchOrders = async () => {
    const { data, error: queryError } = await supabase
      .from('app_orders')
      .select('*, rider:rider_id(full_name, phone)')
      .eq('merchant_id', profile.id)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      return;
    }

    setOrders(data || []);
  };

  useEffect(() => {
    void fetchProducts();
    void fetchOrders();

    const timer = window.setInterval(() => void fetchOrders(), 15000);

    const channel = supabase
      .channel(`merchant-orders-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_orders',
          filter: `merchant_id=eq.${profile.id}`,
        },
        () => void fetchOrders(),
      )
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [profile.id]);

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG or WebP image.');
      event.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Your image must be 5 MB or smaller.');
      event.target.value = '';
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      const extension =
        file.type === 'image/jpeg'
          ? 'jpg'
          : file.type === 'image/png'
            ? 'png'
            : 'webp';

      const filename =
        `${profile.id}-${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('product_images')
        .upload(filename, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('product_images')
        .getPublicUrl(filename);

      setImageUrl(data.publicUrl);
    } catch (err: any) {
      setError(err.message || 'Image upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleAddProduct = async () => {
    if (isAdding || isUploading) return;

    const numericPrice = Number(price);

    if (!name.trim()) {
      setError('Enter a product name.');
      return;
    }

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Enter a valid product price.');
      return;
    }

    if (!/^[1-9]\d{6,14}$/.test(whatsappDigits)) {
      setError('Enter a WhatsApp number including its country code.');
      return;
    }

    setIsAdding(true);
    setError('');

    try {
      const { error: insertError } = await supabase
        .from('products')
        .insert({
          merchant_id: profile.id,
          name: name.trim(),
          price: numericPrice,
          description: description.trim(),
          image_url: imageUrl || null,
          whatsapp_number: `+${whatsappDigits}`,
        });

      if (insertError) throw insertError;

      setName('');
      setPrice('');
      setDescription('');
      setImageUrl('');
      await fetchProducts();
    } catch (err: any) {
      setError(err.message || 'Unable to save the product.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this product?')) return;

    setError('');

    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .eq('merchant_id', profile.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    await fetchProducts();
  };

  const handleUpdateOrderStatus = async (
    orderId: string,
    status: string,
  ) => {
    if (updatingOrder) return;

    setUpdatingOrder(orderId);
    setError('');

    try {
      const { error: updateError } = await supabase
        .from('app_orders')
        .update({ status })
        .eq('id', orderId)
        .eq('merchant_id', profile.id);

      if (updateError) throw updateError;
      await fetchOrders();
    } catch (err: any) {
      setError(err.message || 'Unable to update this order.');
    } finally {
      setUpdatingOrder(null);
    }
  };

  const handleWhatsAppCustomer = (order: any) => {
    let digits = String(
      order.customer_phone || order.rider?.phone || '',
    ).replace(/\D/g, '');

    if (digits.startsWith('0') && digits.length === 9) {
      digits = `232${digits.slice(1)}`;
    }

    if (!/^[1-9]\d{6,14}$/.test(digits)) {
      setError('This order does not have a valid customer phone number.');
      return;
    }

    const message = encodeURIComponent(
      `Hello ${order.rider?.full_name || 'there'}, regarding your MatMove order for ${order.product_name}.`,
    );

    window.open(
      `https://wa.me/${digits}?text=${message}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const displayedOrders = orders.filter(
    order => orderFilter === 'all' || order.status === orderFilter,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <h1 className="text-3xl font-bold">Inventory & Orders</h1>

        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab('products')}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              activeTab === 'products' ? 'bg-white shadow-sm' : ''
            }`}
          >
            My Catalog
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${
              activeTab === 'orders' ? 'bg-white shadow-sm' : ''
            }`}
          >
            In-App Orders
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}

      {activeTab === 'products' ? (
        <>
          <div className="space-y-4 rounded-2xl border bg-white p-5">
            <h3 className="text-lg font-bold">Add New Product</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <input
                placeholder="Product name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="rounded-xl border p-3"
              />
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Price (SLE)"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="rounded-xl border p-3"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-bold">
                WhatsApp number with country code
                <div className="mt-2 flex overflow-hidden rounded-xl border">
                  <span className="border-r bg-slate-100 px-4 py-3">+</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={whatsappDigits}
                    onChange={e =>
                      setWhatsappDigits(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="23277123456"
                    className="min-w-0 flex-1 p-3 font-normal outline-none"
                  />
                </div>
              </label>

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold">
                {isUploading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ImageIcon size={18} />
                )}
                {isUploading
                  ? 'Uploading…'
                  : imageUrl
                    ? 'Replace product image'
                    : 'Upload product image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isUploading || isAdding}
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>

            {imageUrl && (
              <img
                src={imageUrl}
                alt="Product preview"
                className="h-32 w-32 rounded-xl border object-cover"
              />
            )}

            <textarea
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border p-3"
            />

            <button
              onClick={() => void handleAddProduct()}
              disabled={isAdding || isUploading}
              className="rounded-xl bg-orange-600 px-6 py-3 font-bold text-white disabled:opacity-50"
            >
              {isAdding ? 'Saving…' : 'Add to Catalog'}
            </button>
          </div>

          {!products.length && (
            <p className="py-6 text-center text-slate-500">
              No products listed yet.
            </p>
          )}

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map(product => (
              <article
                key={product.id}
                className="relative overflow-hidden rounded-2xl border bg-white"
              >
                <button
                  onClick={() => void handleDelete(product.id)}
                  className="absolute right-3 top-3 z-10 rounded-full bg-white p-2 text-red-600 shadow"
                  aria-label={`Delete ${product.name}`}
                >
                  <Trash2 size={16} />
                </button>

                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-40 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center bg-slate-100">
                    <Package size={40} className="text-slate-300" />
                  </div>
                )}

                <div className="p-5">
                  <h4 className="text-lg font-bold">{product.name}</h4>
                  <p className="mt-1 text-xl font-bold text-orange-600">
                    SLE {Number(product.price || 0).toFixed(2)}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {product.description || 'No description'}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['all', 'pending', 'completed'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setOrderFilter(filter)}
                  className={`rounded-md px-3 py-2 text-sm font-bold capitalize ${
                    orderFilter === filter ? 'bg-white shadow-sm' : ''
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            <button
              onClick={() => void fetchOrders()}
              className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>

          {!displayedOrders.length && (
            <p className="rounded-2xl border bg-white py-10 text-center text-slate-500">
              No orders found.
            </p>
          )}

          {displayedOrders.map(order => (
            <article
              key={order.id}
              className="flex flex-col justify-between gap-4 rounded-2xl border bg-white p-5 sm:flex-row"
            >
              <div>
                <h3 className="text-lg font-bold">{order.product_name}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  Quantity: {order.quantity || 1} · {order.status}
                </p>

                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <p className="flex items-center gap-2">
                    <User size={14} />
                    {order.rider?.full_name || 'Customer'}
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone size={14} />
                    {order.customer_phone ||
                      order.rider?.phone ||
                      'No phone provided'}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin size={14} />
                    {order.delivery_location || 'No location provided'}
                  </p>
                  {order.delivery_time && (
                    <p className="flex items-center gap-2">
                      <CalendarClock size={14} />
                      {new Date(order.delivery_time).toLocaleString()}
                    </p>
                  )}
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  {new Date(order.created_at).toLocaleString()}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="text-xl font-bold text-orange-600">
                  SLE {Number(order.price || 0).toFixed(2)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                  <button
                    onClick={() => handleWhatsAppCustomer(order)}
                    className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"
                  >
                    <MessageCircle size={14} /> WhatsApp Customer
                  </button>
                  <button
                    disabled={updatingOrder !== null}
                    onClick={() =>
                      void handleUpdateOrderStatus(
                        order.id,
                        order.status === 'pending' ? 'completed' : 'pending',
                      )
                    }
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {updatingOrder === order.id
                      ? 'Saving…'
                      : order.status === 'pending'
                        ? 'Mark Completed'
                        : 'Mark Pending'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MerchantTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    const { data, error: queryError } = await supabase
      .from('bookings')
      .select('*, driver:driver_id(full_name)')
      .eq('rider_id', profile.id)
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

    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [profile.id]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Trips & Deliveries</h1>
        <button
          onClick={() => void refresh()}
          className="rounded-xl border bg-white px-4 py-2"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading trips…</p>
      ) : !trips.length && !error ? (
        <p className="py-6 text-center text-slate-500">No requests found.</p>
      ) : null}

      {trips.map(trip => (
        <article
          key={trip.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-5"
        >
          <div>
            <h3 className="font-bold capitalize">
              {trip.service_type}
              {trip.vehicle_type ? ` (${trip.vehicle_type})` : ''}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {new Date(trip.created_at).toLocaleString()}
            </p>
            <p className="mt-3 text-sm text-slate-600">
              {trip.pickup_location}
              <ArrowRight size={14} className="mx-2 inline" />
              {trip.destination_location}
            </p>
            {trip.scheduled_time && (
              <p className="mt-2 text-xs text-slate-500">
                Scheduled: {new Date(trip.scheduled_time).toLocaleString()}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-lg font-bold">
              SLE {Number(trip.fare_amount || 0).toFixed(2)}
            </p>
            <p
              className={`mt-1 rounded px-2 py-1 text-xs font-bold uppercase ${
                trip.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : trip.status === 'cancelled'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {trip.status}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function PolicyModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 bg-slate-900 p-6 text-white">
          <h2 className="text-xl font-bold">
            MatMove Safety & Compliance Policy
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Sierra Leone Road Safety Authority (SLRSA) Guidelines
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-sm text-slate-600">
          <p>
            <strong>1. Compliance with SLRSA:</strong> All users must adhere
            to the traffic rules and regulations set forth by the Sierra
            Leone Road Safety Authority.
          </p>
          <p>
            <strong>2. Liability & Accidents:</strong> MatMove Enterprise
            acts as a technology platform connecting users. Its published
            terms govern responsibilities relating to accidents, injuries,
            property loss and damage during transit.
          </p>
          <p>
            <strong>3. Vehicle Safety:</strong> Drivers must ensure their
            vehicles are roadworthy, insured and licensed.
          </p>
          <p>
            <strong>4. Account Suspension:</strong> Safety violations or
            reports of reckless behaviour may result in wallet freezing
            and account suspension.
          </p>
          <p className="border-t pt-3 font-bold text-slate-900">
            By clicking “I Accept”, you acknowledge that you have read
            and agree to this policy.
          </p>
        </div>

        <div className="shrink-0 border-t bg-slate-50 p-4">
          <button
            onClick={onAccept}
            className="w-full rounded-xl bg-indigo-600 py-4 font-bold text-white"
          >
            I Accept & Agree
          </button>
        </div>
      </div>
    </div>
  );
}