import { useState, useEffect } from 'react';
import { Wallet, X, Smartphone, Loader2, ArrowUpRight, ArrowDownLeft, Lock } from 'lucide-react';

export function WalletPage({ profile, wallet, onClose }: any) {
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTarget, setTransferTarget] = useState<'mobile_money' | 'matmove_user'>('mobile_money');
  const [transferPhone, setTransferPhone] = useState(profile?.phone || '');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isTransferring, setIsTransferring] = useState(false);

  const isApproved = profile?.role === 'rider' || profile?.kyc_status === 'approved';
  const balance = Number(wallet?.balance || 0);
  const monimeAccountId = wallet?.metadata?.monime_account_id || 'Pending Setup';

  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { setIsProcessing(false); setIsLoadModalOpen(false); }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const closeModals = () => {
    setIsLoadModalOpen(false);
    setIsTransferModalOpen(false);
    setIsProcessing(false);
    setIsTransferring(false);
    setLoadAmount('');
    setTransferAmount('');
  };

  const handleOpenTransfer = () => {
    if (!isApproved) return alert('Transfers are unlocked once your KYC application is approved by MatMove Admin.');
    setIsTransferModalOpen(true);
  };

  const executeLoad = async () => {
    if (!loadAmount || Number(loadAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessing(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: loadAmount, userId: profile.id, role: profile.role }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment gateway failed');
      if (data.link || data.checkoutUrl) window.location.href = data.link || data.checkoutUrl;
    } catch (err: any) { alert(err.message); setIsProcessing(false); }
  };

  const executeTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > balance) return alert('Insufficient balance');
    if (!transferPhone.trim()) return alert('Enter the recipient\'s phone number');

    setIsTransferring(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          amount: amt, 
          userId: profile.id, 
          transferType: transferTarget,
          destinationPhone: transferPhone,
          networkProvider: networkProvider
        }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Transfer processed successfully!`);
      closeModals(); window.location.reload();
    } catch (err: any) { alert(err.message); setIsTransferring(false); }
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
        <div className="text-xs font-mono text-slate-400 mt-4 bg-slate-800 inline-block px-3 py-1.5 rounded-lg border border-slate-700">Account ID: {monimeAccountId}</div>
        <Wallet size={80} className="absolute right-6 top-6 opacity-10 text-white" />
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-4">Wallet Actions</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div onClick={() => setIsLoadModalOpen(true)} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:border-blue-500 cursor-pointer transition flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4"><div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><ArrowDownLeft size={24} /></div><div><h3 className="font-bold text-slate-900 text-base">Load Wallet</h3><p className="text-xs text-slate-500">Top up via Mobile Money.</p></div></div>
          <button className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition text-sm">Add Funds</button>
        </div>

        <div onClick={handleOpenTransfer} className={`bg-white border rounded-3xl p-6 shadow-sm flex flex-col justify-between transition ${isApproved ? 'border-emerald-200 hover:border-emerald-500 cursor-pointer' : 'border-slate-100 opacity-60 cursor-not-allowed'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              {isApproved ? <ArrowUpRight size={24} /> : <Lock size={24} />}
            </div>
            <div>
              <h3 className={`font-bold text-base ${isApproved ? 'text-slate-900' : 'text-slate-500'}`}>Transfer Funds</h3>
              <p className="text-xs text-slate-500">{isApproved ? 'Send to MatMove users or Mobile Money.' : 'Admin KYC Approval required.'}</p>
            </div>
          </div>
          <button disabled={!isApproved} className={`w-full font-bold py-3 rounded-xl transition text-sm ${isApproved ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' : 'bg-slate-200 text-slate-400'}`}>
            {isApproved ? 'Transfer Funds' : 'Transfers Locked'}
          </button>
        </div>
      </div>

      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <button onClick={executeLoad} disabled={isProcessing || !loadAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <><Smartphone size={20} /> Checkout with Monime</>}
            </button>
          </div>
        </div>
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Transfer Funds</h2>
            <p className="text-sm text-slate-500 mb-6">Send money instantly via Monime.</p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Transfer Amount (SLE)</label>
                <input type="number" placeholder="0.00" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none mt-1 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Transfer Destination</label>
                <select value={transferTarget} onChange={(e) => setTransferTarget(e.target.value as any)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none mt-1 focus:border-blue-500 bg-white appearance-none">
                  <option value="mobile_money">Mobile Money (External Cashout)</option>
                  <option value="matmove_user">MatMove Account (Internal Transfer)</option>
                </select>
              </div>
              {transferTarget === 'mobile_money' && (
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setNetworkProvider('orange')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Orange</button>
                  <button onClick={() => setNetworkProvider('afrimoney')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'afrimoney' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Afrimoney</button>
                </div>
              )}
              <input type="tel" placeholder={transferTarget === 'mobile_money' ? "Mobile Money Number (+232...)" : "Recipient's Registered Phone (+232...)"} value={transferPhone} onChange={(e) => setTransferPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none focus:border-blue-500" />
            </div>
            <button onClick={executeTransfer} disabled={isTransferring || !transferAmount} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isTransferring ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Transfer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}