import { useEffect, useRef, useState } from 'react';
import { shareTransactionReceiptPdf } from '@/lib/pdfReceipt';
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
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!tx) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tx]);

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
      const result = await shareTransactionReceiptPdf(tx);
      setNotice(result === 'shared'
        ? 'Branded PDF receipt shared.'
        : 'Branded PDF receipt downloaded.');
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        setNotice(error instanceof Error ? error.message : 'Could not create the PDF receipt.');
      }
    }
  }

  const reference = tx.id || tx.reference;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-2 backdrop-blur-sm sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-receipt-title"
        className="relative max-h-[calc(100dvh-1rem)] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:space-y-5 sm:rounded-3xl sm:p-6"
      >
        <button
          onClick={onClose}
          aria-label="Close transaction details"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-slate-600 sm:right-4 sm:top-4"
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