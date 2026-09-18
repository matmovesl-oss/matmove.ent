import { useState, useEffect } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, CheckCircle2, CreditCard, LockKeyhole, ReceiptText, Send, ShieldCheck, Smartphone, Wallet, X } from 'lucide-react';

export function WalletPage({ profile, wallet, onClose, onTopUp, onWithdraw, onSendMoney }: any) {
  const [liveSleBalance, setLiveSleBalance] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState(true);

  // Live Mirror: Fetch true balance directly from Monime on load
  useEffect(() => {
    if (!profile?.id) return;
    const fetchBalance = async () => {
      try {
        const res = await fetch(`/api/get-live-wallet?userId=${profile.id}`);
        const data = await res.json();
        if (data.balance !== undefined) setLiveSleBalance(data.balance);
      } catch (err) {
        console.error("Failed to fetch true balance", err);
      } finally {
        setIsSyncing(false);
      }
    };
    fetchBalance();
  }, [profile?.id]);

  const role = String(profile?.role || profile?.customer_role || '').toLowerCase();
  const isRider = role === 'rider' || role === 'client';
  const isDriver = role === 'driver';
  const isMerchant = role === 'merchant' || role === 'vendor';
  const isCustomer = isRider || isDriver || isMerchant;

  const isVerified = String(profile?.kyc_status || profile?.verification_status).trim().toLowerCase() === 'approved';
  const canWithdraw = isVerified && liveSleBalance > 0;
  const firstName = profile?.first_name || profile?.full_name?.split(' ')?.[0] || 'User';

  const roleLabel = isRider ? 'Rider Wallet' : isDriver ? 'Driver Wallet' : isMerchant ? 'Merchant Wallet' : 'MatMove Wallet';

  return (
    <div className="min-h-screen bg-slate-50 pb-24 md:pb-10">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-5 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Wallet size={19} />
              </div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">MatMove Wallet • Secure Gateway</p>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-3">{roleLabel}</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">Hello, {firstName}. Manage your active funds directly from the Monime ledger.</p>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-2.5 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition">
              <X size={20} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <section className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg overflow-hidden relative">
          <div className="absolute -right-20 -top-20 w-56 h-56 rounded-full bg-blue-500/10" />
          <div className="absolute -right-10 -bottom-24 w-48 h-48 rounded-full bg-emerald-500/10" />

          <div className="relative">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
                  <Wallet size={18} /> Available SLE Balance
                </div>
                <div className="text-4xl sm:text-5xl font-bold mt-3 tracking-tight flex items-center gap-3">
                  SLE {liveSleBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  {isSyncing && <span className="text-sm text-blue-400 font-normal animate-pulse">Syncing...</span>}
                </div>
                <p className="text-xs text-slate-400 mt-3">Your true active balance mirrored from Monime.</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <ShieldCheck size={22} />
              </div>
            </div>

            <div className="mt-7 pt-5 border-t border-white/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
              <span className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-400" /> Protected by Monime API</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-400" /> Live Webhook Sync</span>
            </div>
          </div>
        </section>

        {isCustomer && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">Wallet Actions</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <button onClick={onTopUp} className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-blue-300 transition">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4"><ArrowDownToLine size={22} /></div>
                <h3 className="font-bold text-slate-900">Load Wallet</h3>
                <p className="text-sm text-slate-500 mt-1">Top up using Mobile Money checkout.</p>
              </button>

              {isRider && (
                <button onClick={onSendMoney} className="group bg-white border border-slate-200 rounded-2xl p-5 text-left shadow-sm hover:border-emerald-300 transition">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-4"><Send size={22} /></div>
                  <h3 className="font-bold text-slate-900">Pay / Send Money</h3>
                  <p className="text-sm text-slate-500 mt-1">Pay drivers directly from your balance.</p>
                </button>
              )}

              <button onClick={onWithdraw} disabled={!canWithdraw} className={`group rounded-2xl p-5 text-left shadow-sm transition border ${canWithdraw ? 'bg-white border-slate-200 hover:border-blue-300' : 'bg-slate-100 border-slate-200 cursor-not-allowed'}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${canWithdraw ? 'bg-blue-50 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                  {canWithdraw ? <ArrowUpFromLine size={22} /> : <LockKeyhole size={22} />}
                </div>
                <h3 className={`font-bold ${canWithdraw ? 'text-slate-900' : 'text-slate-500'}`}>Withdraw SLE</h3>
                <p className={`text-sm mt-1 ${canWithdraw ? 'text-slate-500' : 'text-slate-400'}`}>
                  {canWithdraw ? 'Withdraw your balance to Mobile Money.' : 'Verification required to withdraw funds.'}
                </p>
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}