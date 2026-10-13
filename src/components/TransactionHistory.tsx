import { useState } from 'react';
import {
  Share2,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';

import {
  transactionAmount,
  transactionDirection,
  transactionTitle,
  transactionReceipt,
} from '../../shared/transaction-display.js';

type Props = {
  transactions: any[];
  onSelect: (tx: any) => void;
};

export default function TransactionHistory({
  transactions,
  onSelect,
}: Props) {
  const [recent, setRecent] = useState(true);
  const [notice, setNotice] = useState('');

  const rows = (
    Array.isArray(transactions)
      ? transactions
      : []
  ).filter(
    (transaction, index, list) =>
      transaction &&
      list.findIndex(
        item =>
          item.id === transaction.id &&
          item.amount?.currency ===
            transaction.amount?.currency
      ) === index
  );

  async function share(tx: any) {
    try {
      const text = transactionReceipt(tx);

      if (navigator.share) {
        await navigator.share({
          title: transactionTitle(tx),
          text,
        });
      } else {
        await navigator.clipboard.writeText(text);
        setNotice('Receipt copied.');
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setNotice('Could not share this receipt.');
      }
    }
  }

  const displayedRows = recent
    ? rows.slice(0, 5)
    : rows;

  return (
    <section className="rounded-3xl border bg-white p-5">
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <h3 className="text-lg font-bold">
          Transactions
        </h3>

        <div className="flex gap-2">
          <button
            onClick={() => setRecent(true)}
            className={`rounded-lg px-3 py-2 text-sm ${
              recent
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-50'
            }`}
          >
            Recent
          </button>

          <button
            onClick={() => setRecent(false)}
            className={`rounded-lg px-3 py-2 text-sm ${
              !recent
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-50'
            }`}
          >
            Loaded history
          </button>
        </div>
      </div>

      {!rows.length && (
        <p className="py-5 text-center text-slate-500">
          No transactions found.
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-blue-50 p-3"
        >
          {notice}
        </p>
      )}

      <div className="space-y-3">
        {displayedRows.map(tx => {
          const direction = transactionDirection(tx);

          const date = new Date(
            tx.timestamp ||
            tx.createTime ||
            tx.createdAt ||
            tx.created_at ||
            tx.date
          );

          const dateLabel =
            Number.isNaN(date.getTime())
              ? 'Date not provided'
              : date.toLocaleString();

          const directionLabel =
            direction === 'credit'
              ? 'Received'
              : direction === 'debit'
              ? 'Sent'
              : 'Direction not provided';

          const iconColour =
            direction === 'credit'
              ? 'bg-emerald-100 text-emerald-700'
              : direction === 'debit'
              ? 'bg-rose-100 text-rose-700'
              : 'bg-slate-200';

          const amountColour =
            direction === 'credit'
              ? 'text-emerald-700'
              : direction === 'debit'
              ? 'text-rose-700'
              : 'text-slate-600';

          return (
            <article
              key={tx.id}
              className="flex items-center gap-3 rounded-2xl border bg-slate-50 p-4"
            >
              <button
                onClick={() => onSelect(tx)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`rounded-full p-2 ${iconColour}`}
                >
                  {direction === 'credit' ? (
                    <ArrowDownLeft size={18} />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-bold">
                    {transactionTitle(tx)}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {dateLabel}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {directionLabel}
                  </p>
                </div>

                <strong
                  className={`text-right text-sm ${amountColour}`}
                >
                  {transactionAmount(tx)}
                </strong>
              </button>

              <button
                aria-label="Share transaction receipt"
                onClick={() => void share(tx)}
                className="rounded-xl p-2 text-blue-600 hover:bg-blue-50"
              >
                <Share2 size={17} />
              </button>
            </article>
          );
        })}
      </div>

      <p className="mt-4 border-t pt-3 text-xs text-slate-500">
        Latest available ledger entries, up to 50 per
        currency. Amounts marked + were received;
        amounts marked − were sent.
      </p>
    </section>
  );
}