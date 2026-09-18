import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Store, Wallet, RefreshCw, AlertCircle, ShieldCheck, X, Loader2, Lock, Plus, Package, Smartphone, CreditCard, ArrowUpRight } from 'lucide-react';

export function MerchantDashboard({ profile }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const businessName = localProfile?.business_name || localProfile?.full_name || 'Merchant';

  return (
    <div className="flex-1 bg-slate-50 min-h-screen">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-xl"><Store size={20} /></div>
          <div>
            <h2 className="font-bold text-slate-900 leading-tight">{businessName}</h2>
            <span className="text-xs font-bold text-orange-600 uppercase">Merchant Portal</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={() => setIsTopUpModalOpen(true)} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition">
            + Load Wallet
          </button>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Merchant Balance</div>
            <div className="text-lg font-bold text-slate-900">SLE {liveBalance.toLocaleString()}</div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-slate-900 rounded-3xl p-6 text-white relative shadow-lg flex justify-between items-center">
            <button onClick={fetchLiveBalance} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
              <div className="text-4xl font-bold mt-1 text-emerald-400">SLE {liveBalance.toLocaleString()}</div>
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12"><Wallet size={36} className="text-white" /></div>
          </div>
          {/* Rest of UI identical */}
        </div>
      </div>
    </div>
  );
}