import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Store, Wallet, RefreshCw, AlertCircle, ShieldCheck, X, Loader2, Lock, Plus, Package, Smartphone, CreditCard, ArrowUpRight } from 'lucide-react';

export function MerchantDashboard({ profile, wallet, onOpenWithdraw }: any) {
  const [localProfile, setLocalProfile] = useState(profile);
  const [localWallet, setLocalWallet] = useState(wallet);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const isApproved = localProfile?.kyc_status === 'approved';

  // Live Wallet Real-Time Listener
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel(`merchant-wallet-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${profile.id}` }, 
        (payload) => {
          setLocalWallet(payload.new);
          alert('Merchant Wallet updated successfully!');
        }
      ).subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const { data: wData } = await supabase.from('wallets').select('*').eq('user_id', profile.id).single();
      if (wData) setLocalWallet(wData);

      const { data: pData } = await supabase.from('profiles').select('*').eq('id', profile.id).single();
      if (pData) setLocalProfile(pData);
    } catch (err) {
      console.error('Failed to refresh merchant data', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Monime Secure Checkout Request
  const executeTopUp = async () => {
    if (!topUpAmount || Number(topUpAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: topUpAmount,
          userId: profile.id,
          role: 'merchant' // Dynamically route this specific user role
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gateway initialization failed');

      setIsProcessing(false);
      setIsTopUpModalOpen(false);

      if (data.link) {
        window.location.href = data.link;
      } else {
        alert('Could not generate checkout link. Please try again.');
      }
    } catch (err: any) {
      alert(err.message || 'Payment failed');
      setIsProcessing(false);
    }
  };

  // Vult Cashout Execution
  const executeWithdrawal = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) return alert('Enter a valid withdrawal amount');
    if (amt > Number(localWallet?.balance || 0)) return alert('Insufficient wallet balance');
    if (!withdrawPhone.trim()) return alert('Enter a valid Mobile Money number');

    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/create-vult-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          userId: profile.id,
          destinationPhone: withdrawPhone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Withdrawal failed');

      alert(`Cashout of SLE ${amt} requested! Funds will be transferred to ${withdrawPhone}.`);
      setIsWithdrawing(false);
      setIsWithdrawModalOpen(false);
      refreshData();
    } catch (err: any) {
      alert(err.message || 'Cashout request failed');
      setIsWithdrawing(false);
    }
  };

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
            <div className="text-lg font-bold text-slate-900">SLE {Number(localWallet?.balance || 0).toLocaleString()}</div>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        {!isApproved && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
            <AlertCircle className="text-amber-500 mt-0.5" size={20} />
            <div>
              <h4 className="font-bold text-amber-900 text-sm">Verification Pending</h4>
              <p className="text-xs text-amber-700 mt-1">Your store is active, but payout withdrawals are restricted until document approval.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-slate-900 rounded-3xl p-6 text-white relative shadow-lg flex justify-between items-center">
            <button onClick={refreshData} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl text-white transition flex items-center gap-2 text-xs font-bold">
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Syncing...' : 'Refresh Balance'}
            </button>
            <div>
              <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Store Operating Wallet</span>
              <div className="text-4xl font-bold mt-1 text-emerald-400">SLE {Number(localWallet?.balance || 0).toLocaleString()}</div>
            </div>
            <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm mt-8 mr-12"><Wallet size={36} className="text-white" /></div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Payout Access</h3>
              <p className="text-slate-500 text-xs mt-1">Withdraw store funds to Mobile Money.</p>
            </div>
            <button onClick={() => setIsWithdrawModalOpen(true)} disabled={!isApproved} className={`w-full font-bold p-3 rounded-xl transition text-xs shadow-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}`}>
              {isApproved ? 'Withdraw Funds' : 'Withdrawals Locked (Pending KYC)'}
            </button>
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
              <Package size={20} className="text-orange-600" /> Catalog & Orders
            </h3>
            <button className="bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-slate-800">
              <Plus size={16} /> Add Product
            </button>
          </div>
          <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-12 text-center">
            <Store size={36} className="mx-auto text-slate-400 mb-2" />
            <p className="font-bold text-slate-600 text-sm">No Active Merchant Orders</p>
            <p className="text-xs text-slate-400 mt-1">Orders placed by riders will appear here in real-time.</p>
          </div>
        </div>
      </div>

      {/* Top-Up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsTopUpModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Top Up Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Choose how you want to fund your merchant wallet.</p>

            <div className="space-y-3 mb-6">
              <button type="button" onClick={() => setFundingMethod('momo')} className={`w-full p-4 rounded-2xl border-2 flex items-center gap-4 text-left transition ${fundingMethod === 'momo' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200'}`}>
                <div className="p-3 rounded-xl bg-blue-100 text-blue-600"><Smartphone size={22} /></div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">Mobile Money</div>
                  <div className="text-xs text-slate-500">Secure checkout via Monime</div>
                </div>
              </button>

              <button type="button" onClick={() => setFundingMethod('card')} className={`w-full p-4 rounded-2xl border-2 flex items-center gap-4 text-left transition ${fundingMethod === 'card' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200'}`}>
                <div className="p-3 rounded-xl bg-emerald-100 text-emerald-600"><CreditCard size={22} /></div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">Bank Card</div>
                  <div className="text-xs text-slate-500">Visa / Mastercard secure checkout</div>
                </div>
              </button>
            </div>

            <input type="number" placeholder="Amount (SLE)" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 focus:ring-2 focus:ring-blue-600 outline-none" />
            
            <button onClick={executeTopUp} disabled={isProcessing || !topUpAmount} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Lock size={20} />} Proceed to Checkout
            </button>
          </div>
        </div>
      )}

      {/* Cashout Modal */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={() => setIsWithdrawModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Store Earnings</h2>
            <p className="text-sm text-slate-500 mb-6">Transfer store funds to Mobile Money.</p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Withdrawal Amount (SLE)</label>
                <input type="number" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Mobile Money Phone Number</label>
                <input type="tel" placeholder="+232..." value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-base outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>

            <button onClick={executeWithdrawal} disabled={isWithdrawing || !withdrawAmount} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isWithdrawing ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Cashout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}