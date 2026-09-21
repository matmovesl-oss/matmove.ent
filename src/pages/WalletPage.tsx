import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Wallet, X, Smartphone, Loader2, ArrowUpRight, ArrowDownLeft, Lock, Users, RefreshCw, Clock, FileText } from 'lucide-react';

export function WalletPage({ profile, wallet, onClose }: any) {
  const [liveBalance, setLiveBalance] = useState<number>(Number(wallet?.balance || 0));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(true);
  const [selectedTx, setSelectedTx] = useState<any>(null);

  // Modals
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [isProcessingLoad, setIsProcessingLoad] = useState(false);

  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState(''); 
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  const isApproved = profile?.role === 'rider' || profile?.kyc_status === 'approved';
  const monimeAccountId = wallet?.metadata?.monime_account_id || 'Pending Setup';

  const fetchLiveBalanceAndTransactions = async () => {
    if (!profile?.id) return;
    setIsRefreshing(true);
    setIsLoadingTx(true);
    try {
      const balRes = await fetch('/api/get-live-wallet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: profile.id })
      });
      const balData = await balRes.json();
      if (balData.balance !== undefined) setLiveBalance(Number(balData.balance));

      const txRes = await fetch('/api/get-monime-transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: profile.id })
      });
      const txData = await txRes.json();
      if (txData.transactions) setTransactions(txData.transactions);

    } catch (err) {} finally { 
      setIsRefreshing(false); 
      setIsLoadingTx(false);
    }
  };

  useEffect(() => { fetchLiveBalanceAndTransactions(); }, [profile?.id]);

  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false); setSelectedTx(null);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient(''); setPayoutPhone('');
  };

  const executeLoad = async () => {
    if (!loadAmount || Number(loadAmount) <= 0) return alert('Enter a valid amount');
    setIsProcessingLoad(true);
    try {
      const res = await fetch('/api/create-monime-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: loadAmount, userId: profile.id, role: profile.role }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment gateway failed');
      if (data.link) window.location.href = data.link;
    } catch (err: any) { alert(err.message); setIsProcessingLoad(false); }
  };

  const executePayout = async () => {
    const amt = Number(payoutAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > liveBalance) return alert('Insufficient balance');
    if (!payoutPhone.trim()) return alert('Enter recipient mobile money number');

    setIsProcessingPayout(true);
    try {
      const res = await fetch('/api/create-monime-payout', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, destinationPhone: payoutPhone, networkProvider }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payout failed');
      alert(`Payout requested successfully!`);
      closeModals(); fetchLiveBalanceAndTransactions(); 
    } catch (err: any) { alert(err.message); setIsProcessingPayout(false); }
  };

  const executeTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > liveBalance) return alert('Insufficient balance');
    if (!transferRecipient.trim() || !transferRecipient.startsWith('fac-')) return alert('Enter a valid MatMove Account ID (starts with fac-)');

    setIsProcessingTransfer(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, recipientAccountId: transferRecipient.trim() }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Internal transfer successful!`);
      closeModals(); fetchLiveBalanceAndTransactions();
    } catch (err: any) { alert(err.message); setIsProcessingTransfer(false); }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div><span className="text-xs font-bold text-blue-600 uppercase tracking-wider">MatMove Wallet</span><h1 className="text-3xl font-bold text-slate-900 capitalize">{profile?.role} Ledger</h1></div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full"><X size={24} /></button>
      </div>

      <div className="bg-slate-900 text-white rounded-3xl p-8 mb-8 relative shadow-xl overflow-hidden">
        <button onClick={fetchLiveBalanceAndTransactions} disabled={isRefreshing} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition flex items-center gap-2 text-xs font-bold z-10">
           <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> {isRefreshing ? 'Syncing...' : 'Refresh'}
        </button>
        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Available SLE Balance</span>
        <div className="text-5xl font-bold mt-2 text-blue-400">SLE {liveBalance.toFixed(2)}</div>
        <div className="text-xs font-mono text-slate-400 mt-4 bg-slate-800 inline-flex flex-col sm:flex-row gap-2 px-3 py-1.5 rounded-lg border border-slate-700">
           <span>Account ID:</span> <span className="text-white select-all">{monimeAccountId}</span>
        </div>
        <Wallet size={80} className="absolute right-6 top-6 opacity-10 text-white pointer-events-none" />
      </div>

      <h2 className="text-lg font-bold text-slate-900 mb-4">Wallet Actions</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <button onClick={() => setIsLoadModalOpen(true)} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-500 flex flex-col items-center justify-center gap-3 transition">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center"><ArrowDownLeft size={24} /></div>
          <span className="font-bold text-slate-900">Load Wallet</span>
        </button>

        <button onClick={() => isApproved ? setIsPayoutModalOpen(true) : alert('KYC Approval required.')} className={`bg-white border rounded-2xl p-5 shadow-sm flex flex-col items-center justify-center gap-3 transition ${isApproved ? 'border-emerald-200 hover:border-emerald-500' : 'border-slate-100 opacity-60'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isApproved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            {isApproved ? <Smartphone size={24} /> : <Lock size={24} />}
          </div>
          <span className={`font-bold ${isApproved ? 'text-slate-900' : 'text-slate-400'}`}>Mobile Payout</span>
        </button>

        <button onClick={() => isApproved ? setIsTransferModalOpen(true) : alert('KYC Approval required.')} className={`bg-white border rounded-2xl p-5 shadow-sm flex flex-col items-center justify-center gap-3 transition ${isApproved ? 'border-purple-200 hover:border-purple-500' : 'border-slate-100 opacity-60'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isApproved ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-400'}`}>
            {isApproved ? <Users size={24} /> : <Lock size={24} />}
          </div>
          <span className={`font-bold ${isApproved ? 'text-slate-900' : 'text-slate-400'}`}>Internal Transfer</span>
        </button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-900">Recent Transactions</h2>
        <Clock size={18} className="text-slate-400" />
      </div>

      {isLoadingTx ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600" size={24} /></div>
      ) : transactions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-sm shadow-sm">No recent transactions found.</div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx: any) => {
             const amountSLE = (tx.amount?.value || 0) / 100;
             const isCredit = tx.type === 'credit';
             return (
               <div key={tx.id} onClick={() => setSelectedTx(tx)} className="bg-white border border-slate-200 p-4 rounded-2xl flex justify-between items-center shadow-sm cursor-pointer hover:border-blue-300 transition group">
                 <div className="flex items-center gap-4">
                   <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isCredit ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                     {isCredit ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}
                   </div>
                   <div>
                     <div className="font-bold text-slate-900 group-hover:text-blue-600 transition">{isCredit ? 'Received Funds' : 'Sent Funds'}</div>
                     <div className="text-[10px] font-mono text-slate-400 mt-1">{new Date(tx.timestamp).toLocaleString()}</div>
                   </div>
                 </div>
                 <div className="flex items-center gap-3">
                   <div className={`font-bold text-lg ${isCredit ? 'text-emerald-600' : 'text-slate-900'}`}>
                     {isCredit ? '+' : '-'} SLE {amountSLE.toFixed(2)}
                   </div>
                   <FileText size={16} className="text-slate-300 group-hover:text-blue-500" />
                 </div>
               </div>
             );
          })}
        </div>
      )}

      {selectedTx && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full relative shadow-2xl">
            <button onClick={() => setSelectedTx(null)} className="absolute top-4 right-4 text-slate-400 hover:bg-slate-100 rounded-full p-1"><X size={20} /></button>
            <div className="text-center border-b border-dashed border-slate-300 pb-6 mb-6 mt-4">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet size={32} className="text-slate-900" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Transaction Receipt</h2>
              <p className="text-xs text-slate-500 uppercase tracking-widest mt-1">MatMove Financial</p>
            </div>
            <div className="space-y-4 mb-8 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-bold text-slate-900">SLE {((selectedTx.amount?.value || 0) / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Type</span>
                <span className="font-bold text-slate-900 capitalize">{selectedTx.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date</span>
                <span className="font-bold text-slate-900 text-right">{new Date(selectedTx.timestamp).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Transaction ID</span>
                <span className="font-mono text-xs text-slate-900 truncate max-w-[150px]" title={selectedTx.id}>{selectedTx.id}</span>
              </div>
              {selectedTx.reference && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Reference</span>
                  <span className="font-mono text-xs text-slate-900 truncate max-w-[150px]">{selectedTx.reference}</span>
                </div>
              )}
            </div>
            <button onClick={() => setSelectedTx(null)} className="w-full bg-slate-100 text-slate-900 font-bold p-4 rounded-xl hover:bg-slate-200 transition">
              Close Receipt
            </button>
          </div>
        </div>
      )}

      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Load Wallet</h2>
            <p className="text-sm text-slate-500 mb-6">Top up via Mobile Money.</p>
            <input type="number" placeholder="Amount (SLE)" value={loadAmount} onChange={(e) => setLoadAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-2xl text-center mb-6 outline-none focus:border-blue-500" />
            <button onClick={executeLoad} disabled={isProcessingLoad || !loadAmount} className="w-full bg-slate-900 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingLoad ? <Loader2 className="animate-spin" size={20} /> : <><ArrowDownLeft size={20} /> Checkout</>}
            </button>
          </div>
        </div>
      )}

      {isPayoutModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Mobile Payout</h2>
            <p className="text-sm text-slate-500 mb-6">Cashout to Mobile Money.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-emerald-500" />
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setNetworkProvider('orange')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'orange' ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Orange</button>
                <button onClick={() => setNetworkProvider('afrimoney')} className={`p-3 border rounded-xl flex items-center justify-center gap-2 ${networkProvider === 'afrimoney' ? 'border-purple-500 bg-purple-50 text-purple-700 font-bold' : 'border-slate-200 text-slate-500'}`}>Afrimoney</button>
              </div>
              <input type="tel" placeholder="e.g. 077123456 or 030123456" value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none focus:border-emerald-500" />
            </div>
            <button onClick={executePayout} disabled={isProcessingPayout || !payoutAmount || !payoutPhone} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingPayout ? <Loader2 className="animate-spin" size={20} /> : <ArrowUpRight size={20} />} Confirm Payout
            </button>
          </div>
        </div>
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full relative shadow-2xl">
            <button onClick={closeModals} className="absolute top-4 right-4 text-slate-400"><X size={20} /></button>
            <h2 className="text-2xl font-bold mb-1">Internal Transfer</h2>
            <p className="text-sm text-slate-500 mb-6">Paste the recipient's exact MatMove Account ID.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500" />
              <input type="text" placeholder="Recipient ID (e.g. fac-k6V8...)" value={transferRecipient} onChange={(e) => setTransferRecipient(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500" />
            </div>
            <button onClick={executeTransfer} disabled={isProcessingTransfer || !transferAmount || !transferRecipient} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-xl flex justify-center items-center gap-2 transition disabled:opacity-50">
              {isProcessingTransfer ? <Loader2 className="animate-spin" size={20} /> : <Users size={20} />} Send Transfer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}