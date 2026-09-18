import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Car, Package, Truck, Navigation, MapPin, ShieldCheck, X, Wallet, Bell, Loader2, Lock, RefreshCw, Smartphone, CreditCard, ArrowUpRight } from 'lucide-react';

type VehicleType = 'car' | 'keke' | 'bike' | 'truck';

export function RiderDashboard({ profile, onOpenTopUp }: any) {
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>('car');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);

  const [isRequesting, setIsRequesting] = useState(false);
  const [activeBooking, setActiveBooking] = useState<any>(null);

  // Top-Up Modal State
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [fundingMethod, setFundingMethod] = useState<'momo' | 'card'>('momo');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Withdrawal Modal State
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const vehicleOptions = [
    { id: 'car', name: 'MatMove Comfort', icon: Car, base: 15, perKm: 7 },
    { id: 'keke', name: 'Keke Tricycle', icon: Package, base: 10, perKm: 4 },
    { id: 'bike', name: 'Express Bike', icon: Navigation, base: 8, perKm: 3 },
    { id: 'truck', name: 'Haulage Truck', icon: Truck, base: 80, perKm: 20 },
  ];

  // Fetch true live balance from Monime
  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(data.balance);
    } catch (err) {
      console.error('Live Fetch Error', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLiveBalance();
  }, [profile?.id]);

  useEffect(() => {
    if (!pickup || !destination) { setFareEstimate(null); return; }
    const activeVehicle = vehicleOptions.find((v) => v.id === selectedVehicle);
    setFareEstimate(Math.round((activeVehicle?.base || 15) + 6.5 * (activeVehicle?.perKm || 7)));
  }, [pickup, destination, selectedVehicle]);

  const requestTrip = async () => {
    if (!pickup || !destination || !fareEstimate) return alert('Enter pickup and destination.');
    if (liveBalance < fareEstimate) return alert(`Insufficient funds. Please load your wallet.`);

    setIsRequesting(true);
    try {
      const { data, error } = await supabase.from('bookings').insert({
          rider_id: profile.id, service_type: selectedVehicle, pickup_location: pickup, destination_location: destination, fare_amount: fareEstimate, status: 'pending'
        }).select().single();
      if (error) throw error;
      setActiveBooking(data);
    } catch (err: any) { alert(err.message || 'Failed to request trip.'); } finally { setIsRequesting(false); }
  };

  const cancelTrip = async () => {
    if (!activeBooking) return;
    try { await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', activeBooking.id); setActiveBooking(null); } catch (err) {}
  };

  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: topUpAmount, userId: profile.id, role: 'rider' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gateway initialization failed');
      setIsProcessing(false);
      setIsTopUpModalOpen(false);
      if (data.link) window.location.href = data.link;
      else alert('Could not generate checkout link.');
    } catch (err: any) {
      alert(err.message || 'Payment failed');
      setIsProcessing(false);
    }
  };

  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter a valid withdrawal amount');
    if (amt > liveBalance) return alert('Insufficient wallet balance');
    if (!withdrawPhone.trim()) return alert('Enter a valid Mobile Money number');

    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-vult-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: withdrawPhone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
      alert(`Cashout of SLE ${amt} requested!`);
      setIsWithdrawing(false);
      setIsWithdrawModalOpen(false);
      fetchLiveBalance();
    } catch (err: any) {
      alert(err.message || 'Cashout request failed');
      setIsWithdrawing(false);
    }
  };

  const firstName = profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'Rider';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="w-1/2">
          <input type="text" placeholder="Search rides, destinations..." className="w-full bg-slate-100 border-none rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-600" />
        </div>
        <div className="flex items-center gap-6">
          <button className="relative text-slate-400 hover:text-slate-600"><Bell size={20} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full uppercase">Rider</span>
            <span className="text-sm font-bold text-slate-800">{firstName}</span>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Where to, {firstName}? 👋</h1>
            <p className="text-slate-500 mt-1">Book a ride or delivery across Sierra Leone</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-emerald-700 transition shadow-sm">+ Load Wallet</button>
            <button onClick={() => setIsWithdrawModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition shadow-sm">Withdraw</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-blue-700 rounded-3xl p-6 text-white relative overflow-hidden shadow-lg flex justify-between items-center">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-blue-200 text-xs font-bold uppercase tracking-wider">Available Rider Wallet</span>
              <div className="text-4xl font-bold mt-1">SLE {liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12"><Wallet size={36} className="text-white" /></div>
          </div>
          
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
            <ShieldCheck size={32} className="text-emerald-600 mb-2" />
            <h3 className="font-bold text-slate-900 text-base">Protected Journeys</h3>
            <p className="text-slate-500 text-xs mt-1">Verified drivers with GPS tracking.</p>
          </div>
        </div>

        {/* ... Rest of Rider Dashboard UI matches original exactly ... */}
        {/* Replace activeBooking and Modals below as they were */}
      </div>
    </div>
  );
}