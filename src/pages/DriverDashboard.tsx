import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Power, MapPin, Navigation, Wallet, ShieldCheck, Radio, RefreshCw, AlertCircle, Loader2, Lock, X, Smartphone, CreditCard, ArrowUpRight } from 'lucide-react';

export function DriverDashboard({ profile }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [liveBalance, setLiveBalance] = useState<number>(0);
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

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
      const data = await res.json();
      if (data.balance !== undefined) setLiveBalance(data.balance);
    } catch (err) { console.error(err); } 
    finally { setIsRefreshing(false); }
  };

  useEffect(() => {
    fetchLiveBalance();
  }, [profile?.id]);

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();
    const channel = supabase.channel('public:bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { fetchInitialRequests(); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile.id]);

  const handleCompleteBooking = async (booking: any) => {
    try {
      await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
      alert(`Trip completed! SLE ${booking.fare_amount} added to your ledger.`);
      fetchLiveBalance();
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
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition">
            + Load Wallet
          </button>
          <div className="text-right hidden sm:block ml-4">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Driver Earnings</div>
            <div className="text-lg font-bold text-slate-900">SLE {liveBalance.toLocaleString()}</div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full lg:w-96 bg-white border-r border-slate-200 flex flex-col p-6 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 relative">
            <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl relative">
              <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-3 right-3 p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 transition">
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
              <div className="text-slate-500 mb-1"><Wallet size={20} /></div>
              <div className="text-xl font-bold text-slate-900">SLE {liveBalance.toFixed(2)}</div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Wallet Balance</div>
            </div>
          </div>
          {/* Rest of the UI radar map and modals remain identical to the original */}
        </div>
      </div>
    </div>
  );
}