import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Wallet, X, Smartphone, Loader2, ArrowUpRight, ArrowDownLeft, Lock, Users } from 'lucide-react';

export function WalletPage({ profile, wallet, onClose }: any) {
  // Load State
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [loadAmount, setLoadAmount] = useState('');
  const [isProcessingLoad, setIsProcessingLoad] = useState(false);

  // Payout State (Mobile Money)
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPhone, setPayoutPhone] = useState(profile?.phone || '');
  const [networkProvider, setNetworkProvider] = useState<'orange' | 'afrimoney'>('orange');
  const [isProcessingPayout, setIsProcessingPayout] = useState(false);

  // Transfer State (Internal Account)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferRecipient, setTransferRecipient] = useState('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);
  const [matmoveUsers, setMatmoveUsers] = useState<any[]>([]);

  const isApproved = profile?.role === 'rider' || profile?.kyc_status === 'approved';
  const balance = Number(wallet?.balance || 0);
  const monimeAccountId = wallet?.metadata?.monime_account_id || 'Pending Setup';

  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) { setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false); }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  useEffect(() => {
    if (isTransferModalOpen) {
      supabase.from('profiles').select('id, full_name, role, phone, business_name').neq('id', profile.id).then(({ data }) => {
        if (data) setMatmoveUsers(data);
      });
    }
  }, [isTransferModalOpen, profile.id]);

  const closeModals = () => {
    setIsLoadModalOpen(false); setIsPayoutModalOpen(false); setIsTransferModalOpen(false);
    setIsProcessingLoad(false); setIsProcessingPayout(false); setIsProcessingTransfer(false);
    setLoadAmount(''); setPayoutAmount(''); setTransferAmount(''); setTransferRecipient('');
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
    if (amt > balance) return alert('Insufficient balance');
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
      closeModals(); window.location.reload();
    } catch (err: any) { alert(err.message); setIsProcessingPayout(false); }
  };

  const executeTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return alert('Enter valid amount');
    if (amt > balance) return alert('Insufficient balance');
    if (!transferRecipient.trim()) return alert('Select a recipient account');

    setIsProcessingTransfer(true);
    try {
      const res = await fetch('/api/create-monime-transfer', { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: amt, userId: profile.id, recipientPhone: transferRecipient }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer failed');
      alert(`Internal transfer successful!`);
      closeModals(); window.location.reload();
    } catch (err: any) { alert(err.message); setIsProcessingTransfer(false); }
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
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
              <input type="tel" placeholder="Mobile Money Number (e.g. 077...)" value={payoutPhone} onChange={(e) => setPayoutPhone(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none focus:border-emerald-500" />
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
            <p className="text-sm text-slate-500 mb-6">Send money to another MatMove account.</p>
            <div className="space-y-4 mb-6">
              <input type="number" placeholder="Amount (SLE)" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-xl outline-none focus:border-purple-500" />
              <select value={transferRecipient} onChange={(e) => setTransferRecipient(e.target.value)} className="w-full border p-4 rounded-xl font-bold text-sm outline-none bg-white focus:border-purple-500">
                <option value="">Select Account...</option>
                {matmoveUsers.map(u => (
                  <option key={u.id} value={u.phone}>MatMove {String(u.role).toUpperCase()} - {u.business_name || u.full_name} ({u.phone})</option>
                ))}
              </select>
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