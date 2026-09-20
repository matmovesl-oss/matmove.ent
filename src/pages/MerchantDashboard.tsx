import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Store, Wallet, Plus, Package, RefreshCw, X, Loader2, ArrowUpRight } from 'lucide-react';

export function MerchantDashboard({ profile, wallet, activeSection }: any) {
  if (activeSection === 'inventory') return <MerchantInventory profile={profile} />;

  const [liveBalance, setLiveBalance] = useState<number>(wallet?.balance || 0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isApproved = profile?.kyc_status === 'approved';

  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const fetchLiveBalance = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    try {
      const { data } = await supabase.from('wallets').select('balance').eq('user_id', profile.id).single();
      if (data) setLiveBalance(Number(data.balance));
    } catch (err) {} finally { setIsRefreshing(false); }
  };

  useEffect(() => { fetchLiveBalance(); }, [profile?.id]);

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
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div><h2 className="font-bold text-slate-900 leading-tight">{profile?.business_name || 'Merchant Store'}</h2></div>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="bg-orange-600 rounded-3xl p-8 text-white relative shadow-lg">
          <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
             <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
          </button>
          <span className="text-orange-200 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
          <div className="text-5xl font-bold mt-2">SLE {liveBalance.toFixed(2)}</div>
          <Wallet size={64} className="absolute right-8 top-8 opacity-20" />
        </div>

        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-xl">Payout Access</h3>
            <p className="text-slate-500 text-sm mt-1">Withdraw store funds to your Mobile Money account.</p>
          </div>
          <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`mt-6 w-full font-bold p-4 rounded-xl transition shadow-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>
            {isApproved ? 'Withdraw Funds' : 'Withdrawals Locked (Pending Admin KYC Approval)'}
          </button>
        </div>
      </div>

      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Store Funds</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer balance to Mobile Money via Monime.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none" />
              <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none" />
            </div>
            <button onClick={executeWithdrawal} disabled={isWithdrawing || !withdrawAmount} className="w-full bg-emerald-600 text-white font-bold p-4 rounded-xl flex justify-center gap-2 disabled:opacity-50">{isWithdrawing ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Cashout</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MerchantInventory({ profile }: any) {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div><h1 className="text-3xl font-bold text-slate-900">Store Inventory</h1><p className="text-sm text-slate-500">Manage products available in the Rider Shop.</p></div>
        <button className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-md"><Plus size={18}/> Add Product</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-3xl p-16 text-center text-slate-400 shadow-sm mt-10">
        <Package size={64} className="mx-auto mb-6 text-slate-200" />
        <h3 className="font-bold text-xl text-slate-900">No products listed</h3>
        <p className="text-sm mt-2 text-slate-500">Click "Add Product" to create your first listing for Riders to buy.</p>
      </div>
    </div>
  );
}