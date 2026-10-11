import { X, ArrowDownLeft, ArrowUpRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function TransactionModal({
  tx,
  onClose
}: {
  tx: any;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!tx) return null;

  const isCredit = String(tx.balanceImpact).toUpperCase() === 'CREDIT';
  const amount = ((tx.amount?.value || 0) / 100).toFixed(2);
  const currency = tx.amount?.currency || 'SLE';
  const dateStr = tx.createdAt || tx.created_at || tx.timestamp || tx.date;
  const formattedDate = dateStr && !isNaN(new Date(dateStr).getTime())
    ? new Date(dateStr).toLocaleString()
    : 'Recent';

  const copyTxId = () => {
    navigator.clipboard.writeText(tx.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-5">
        <button onClick={onClose} className="absolute right-4 top-4 p-2 text-slate-400 hover:text-slate-600 rounded-full bg-slate-50">
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center pt-2">
          <div className={`p-4 rounded-full mb-3 ${isCredit ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
            {isCredit ? <ArrowDownLeft size={32} /> : <ArrowUpRight size={32} />}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {isCredit ? 'Credit Transaction' : 'Debit Transaction'}
          </span>
          <h2 className={`text-3xl font-bold mt-1 ${isCredit ? 'text-emerald-600' : 'text-slate-900'}`}>
            {isCredit ? '+' : '-'}{currency} {amount}
          </h2>
        </div>

        <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm border border-slate-100">
          <div className="flex justify-between border-b pb-2">
            <span className="text-slate-500 font-medium">Description</span>
            <span className="font-bold text-slate-900 text-right">{tx.description || tx.type || 'Transfer'}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-slate-500 font-medium">Status</span>
            <span className={`font-bold uppercase ${tx.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>{tx.status}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-slate-500 font-medium">Date & Time</span>
            <span className="font-bold text-slate-900 text-right">{formattedDate}</span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-slate-500 font-medium">Transaction ID</span>
            <button onClick={copyTxId} className="flex items-center gap-1.5 font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
              {tx.id?.slice(0, 8)}... {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        <button onClick={onClose} className="w-full rounded-xl bg-slate-900 py-3.5 font-bold text-white">
          Close Details
        </button>
      </div>
    </div>
  );
}