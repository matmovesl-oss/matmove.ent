import { useState } from 'react';
import {
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Check,
} from 'lucide-react';

import {
  transactionDirection,
  transactionAmount,
  transactionTitle,
  transactionReceipt,
} from '../../shared/transaction-display.js';

type Props = {
  tx: any;
  onClose: () => void;
};

export function TransactionModal({
  tx,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  if (!tx) return null;

  const direction = transactionDirection(tx);
  const isCredit = direction === 'credit';
  const isDebit = direction === 'debit';

  const dateValue =
    tx.timestamp ||
    tx.createTime ||
    tx.createdAt ||
    tx.created_at ||
    tx.date;

  const date = new Date(dateValue);

  const formattedDate =
    Number.isNaN(date.getTime())
      ? 'Date not provided'
      : date.toLocaleString();

  const iconColour = isCredit
    ? 'bg-emerald-100 text-emerald-600'
    : isDebit
    ? 'bg-rose-100 text-rose-600'
    : 'bg-slate-100 text-slate-600';

  const amountColour = isCredit
    ? 'text-emerald-600'
    : isDebit
    ? 'text-rose-600'
    : 'text-slate-900';

  async function copyTxId() {
    const reference = tx.id || tx.reference;

    if (!reference) {
      setNotice('Transaction reference is unavailable.');
      return;
    }

    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setNotice('Transaction reference copied.');

      window.setTimeout(
        () => setCopied(false),
        2000
      );
    } catch {
      setNotice('Could not copy the reference.');
    }
  }

  async function shareReceipt() {
    try {
      const text = transactionReceipt(tx);

      if (navigator.share) {
        await navigator.share({
          title: 'MatMove receipt',
          text,
        });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Receipt copied.');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setNotice('Could not share the receipt.');
      }
    }
  }

  const reference = tx.id || tx.reference;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-receipt-title"
        className="relative max-h-[85vh] w-full max-w-md space-y-5 overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          aria-label="Close transaction details"
          className="absolute right-4 top-4 rounded-full bg-slate-50 p-2 text-slate-400 hover:text-slate-600"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center pt-6 text-center">
          <div
            className={`mb-3 rounded-full p-4 ${iconColour}`}
          >
            {isCredit ? (
              <ArrowDownLeft size={32} />
            ) : (
              <ArrowUpRight size={32} />
            )}
          </div>

          <h2
            id="transaction-receipt-title"
            className="text-sm font-bold text-slate-600"
          >
            {transactionTitle(tx)}
          </h2>

          <p
            className={`mt-2 text-3xl font-bold ${amountColour}`}
          >
            {transactionAmount(tx)}
          </p>

          <p className="mt-1 text-sm text-slate-500">
            {isCredit
              ? 'Money received'
              : isDebit
              ? 'Money sent'
              : 'Direction not provided'}
          </p>
        </div>

        <dl className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-3 border-b pb-2">
            <dt className="font-medium text-slate-500">
              Description
            </dt>

            <dd className="text-right font-bold text-slate-900">
              {transactionTitle(tx)}
            </dd>
          </div>

          <div className="flex justify-between gap-3 border-b pb-2">
            <dt className="font-medium text-slate-500">
              Status
            </dt>

            <dd className="text-right font-bold text-slate-900">
              {tx.status || 'Recorded in wallet ledger'}
            </dd>
          </div>

          <div className="flex justify-between gap-3 border-b pb-2">
            <dt className="font-medium text-slate-500">
              Date & time
            </dt>

            <dd className="text-right font-bold text-slate-900">
              {formattedDate}
            </dd>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <dt className="font-medium text-slate-500">
              Transaction reference
            </dt>

            <dd>
              <button
                onClick={() => void copyTxId()}
                className="flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-600"
              >
                {reference
                  ? `${String(reference).slice(0, 10)}...`
                  : 'Unavailable'}

                {copied ? (
                  <Check size={12} />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            </dd>
          </div>
        </dl>

        {tx.businessDetails && (
          <p className="rounded-xl bg-blue-50 p-3 text-sm">
            {tx.businessDetails}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="text-sm text-blue-700"
          >
            {notice}
          </p>
        )}

        <div className="space-y-3 border-t pt-4">
          <button
            onClick={() => void shareReceipt()}
            className="w-full rounded-xl border py-3 font-bold"
          >
            Share receipt
          </button>

          <button
            onClick={onClose}
            className="w-full rounded-xl bg-slate-900 py-3.5 font-bold text-white"
          >
            Close details
          </button>
        </div>
      </div>
    </div>
  );
}