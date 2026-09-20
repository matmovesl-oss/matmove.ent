import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Car, MapPin, Navigation, Power, Package, CalendarClock, ArrowUpRight, X, Loader2, Wallet } from 'lucide-react';

export function DriverDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'trips') return <DriverTrips profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isOnline, setIsOnline] = useState(false);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);

  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const isApproved = profile?.kyc_status === 'approved';

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    try {
      const { data } = await supabase.from('wallets').select('balance').eq('user_id', profile.id).single();
      if (data) setLiveBalance(Number(data.balance));
    } catch (err) {}
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

  useEffect(() => {
    if (!isOnline) { setActiveRequests([]); return; }
    const fetchInitialRequests = async () => {
      const { data } = await supabase.from('bookings').select('*').or(`status.eq.pending,driver_id.eq.${profile.id}`).neq('status', 'cancelled').order('created_at', { ascending: false });
      if (data) setActiveRequests(data);
    };
    fetchInitialRequests();

    const channel = supabase.channel('driver-radar').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, fetchInitialRequests).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isOnline, profile.id]);

  const handleAcceptBooking = async (booking: any) => {
    if (!isApproved) return alert('You must be KYC Approved by an Admin to accept trips.');
    const commission = Number((booking.fare_amount * 0.15).toFixed(2));
    if (liveBalance < commission) return alert(`Insufficient funds. You need at least SLE ${commission} in your wallet to cover the platform commission.`);
    try { await supabase.from('bookings').update({ status: 'accepted', driver_id: profile.id }).eq('id', booking.id); fetchLiveBalance(); } catch (err: any) { alert('Failed: ' + err.message); }
  };

  const handleCompleteBooking = async (booking: any) => {
    try { await supabase.from('bookings').update({ status: 'completed' }).eq('id', booking.id); alert(`Trip completed! Collection recorded.`); fetchLiveBalance(); } catch (err: any) { alert('Failed to complete: ' + err.message); }
  };

  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > liveBalance) return alert('Insufficient balance');
    if (!withdrawPhone.trim()) return alert('Enter valid Mobile Money number');
    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-monime-payout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: withdrawPhone }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');
      alert(`Cashout requested! Pending Admin approval.`);
      setIsWithdrawModalOpen(false); fetchLiveBalance();
    } catch (err: any) { alert(err.message); } finally { setIsWithdrawing(false); }
  };

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsOnline(!isOnline)} className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${isOnline ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
          <div><h2 className="font-bold text-slate-900 text-lg">{isOnline ? 'You are Online' : 'You are Offline'}</h2></div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Driver Ledger</div>
          <div className="text-base font-bold text-slate-900">SLE {liveBalance.toFixed(2)}</div>
        </div>
      </header>

      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`w-full font-bold p-4 rounded-2xl transition shadow-sm flex items-center justify-center gap-2 ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'}`}>
          <Wallet size={18} /> {isApproved ? 'Withdraw Earnings via Monime' : 'Withdrawals Locked (Pending KYC)'}
        </button>

        <h3 className="font-bold text-2xl text-slate-900 pt-4">Live Dispatch Radar</h3>
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
              <div key={r.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md">
                 <div className="flex justify-between items-start mb-4">
                   <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider">{r.service_type}</span>
                   <span className="text-2xl font-bold text-slate-900">SLE {r.fare_amount}</span>
                 </div>
                 <div className="space-y-2 mb-6">
                   <div className="flex items-center gap-2 text-sm text-slate-700"><MapPin size={16} className="text-emerald-500"/> {r.pickup_location}</div>
                   <div className="flex items-center gap-2 text-sm text-slate-700"><Navigation size={16} className="text-blue-500"/> {r.destination_location}</div>
                 </div>
                 {r.status === 'pending' && <button onClick={() => handleAcceptBooking(r)} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800">Accept Request</button>}
                 {r.status === 'accepted' && r.driver_id === profile.id && <button onClick={() => handleCompleteBooking(r)} className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700">Complete & Collect Fare</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Driver Earnings</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer wallet funds to Mobile Money.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none" />
              <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none" />
            </div>
            <button onClick={executeWithdrawal} disabled={isWithdrawing || !withdrawAmount} className="w-full bg-emerald-600 text-white font-bold p-4 rounded-xl flex justify-center gap-2 disabled:opacity-50">{isWithdrawing ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Cashout</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DriverTrips({ profile }: any) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => { supabase.from('bookings').select('*').eq('driver_id', profile.id).order('created_at', { ascending: false }).then(({data}) => { if(data) setTrips(data); }); }, [profile.id]);

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