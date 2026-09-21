import { useState } from 'react';
import { Wallet, X, Smartphone, Loader2, ArrowUpRight, ArrowDownLeft, Lock } from 'lucide-react';

export function WalletPage({ profile, wallet, onClose }: any) {
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState(profile?.phone || '');
  const [isProcessing, setIsProcessing] = useState(false);

  const isApproved = profile?.role === 'rider' || profile?.kyc_status === 'approved';
  const balance = Number(wallet?.balance || 0);

  const closeModals = () => {
    setIsLoadModalOpen(false);
    setIsWithdrawModalOpen(false);
    setIsProcessing(false);
    setAmount('');
  };

  const handleOpenWithdraw = () => {
    if (!isApproved) return alert('Withdrawals are unlocked once your KYC application is approved by MatMove Admin.');
    setIsWithdrawModalOpen(true);
  };

  const executeLoad = async () => {
    if (!amount || Number(amount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount, userId: profile.id, role: profile.role }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment gateway failed');
      
      if (data.link || data.checkoutUrl) window.location.href = data.link || data.checkoutUrl;
      else throw new Error('No checkout URL received');
    } catch (err: any) { alert(err.message); setIsProcessing(false); }
  };

  const executeWithdraw = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return alert('Enter a valid withdrawal amount');
    if (amt > balance) return alert('Insufficient balance in wallet');
    if (!withdrawPhone.trim()) return alert('Enter Mobile Money number');
    
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-payout', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: withdrawPhone }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert('Withdrawal processed successfully!');
      closeModals(); window.location.reload();
    } catch (err: any) { alert(err.message); setIsProcessing(false); }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div><span className="text-xs font-bold text-blue-600 uppercase tracking-wider">MatMove Wallet</span><h1 className="text-3xl font-bold text-slate-900 capitalize">{profile?.role} Ledger</h1></div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full"><X size={24} /></button>
      </div>

      <div className="bg-slate-900 text-white rounded-3xl p-8 mb-8 relative shadow-xl overflow-hidden">
        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Available SLE Balance</span>
        <div className="text-5xl font-bold mt-2 text-blue-400">SLE {balance.toFixed(2)}</div>
        <Wallet size={80} className="absolute right-6 top-6 opacity-10 text-white" />
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-4">Wallet Actions</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div onClick={() => setIsLoadModalOpen(true)} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:border-blue-500 cursor-pointer transition flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4"><div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><ArrowDownLeft size={24} /></div><div><h3 className="font-bold text-slate-900 text-base">Load Wallet</h3><p className="text-xs text-slate-500">Top up via Mobile Money.</p></div></div>
          <button className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition text-sm">Add Funds</button>
        </div>

        <div onClick={handleOpenWithdraw} className={`bg-white border rounded-3xl p-6 shadow-sm flex flex-col justify-between transition ${isApproved ? 'border-emerald-200 hover:border-emerald-500 cursor-pointer' : 'border-slate-100 opacity-60 cursor-not-allowed'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              {isApproved ? <ArrowUpRight size={24} /> : <Lock size={24} />}
            </div>
            <div>
              <h3 className={`font-bold text-base ${isApproved ? 'text-slate-900' : 'text-slate-500'}`}>Withdraw SLE</h3>
              <p className="text-xs text-slate-500">{isApproved ? 'Transfer funds to Mobile Money.' : 'Admin KYC Approval required.'}</p>
            </div>
          </div>
          <button disabled={!isApproved} className={`w-full font-bold py-3 rounded-xl transition text-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-slate-200 text-slate-400'}`}>
            {isApproved ? 'Withdraw Funds' : 'Withdrawals Locked'}
          </button>
        </div>
      </div>

      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>

            <input type="number" placeholder="Amount (SLE)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />

            <button onClick={executeLoad} disabled={isProcessing || !amount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <><Smartphone size={20} /> Checkout with Monime</>}
            </button>
          </div>
        </div>
      )}

      {isWithdrawModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Withdraw Funds</h2>
            <p className="text-sm text-slate-500 mb-6">Cash out to your Mobile Money account.</p>

            <input type="number" placeholder="Amount (SLE)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl text-center mb-4 outline-none focus:border-emerald-500" />
            <input type="tel" placeholder="Mobile Money Number (+232...)" value={withdrawPhone} onChange={(e) => setWithdrawPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm mb-6 outline-none focus:border-emerald-500" />

            <button onClick={executeWithdraw} disabled={isProcessing || !amount} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : 'Confirm Cashout'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}