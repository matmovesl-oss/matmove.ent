import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

import {
  analyticsWindow,
  merchantAnalytics,
} from '../../shared/merchant-analytics.js';

const sle = (value: number) =>
  `SLE ${(value / 100).toFixed(2)}`;

type Props = {
  userId: string;
  onBack: () => void;
};

export default function MerchantAnalytics({
  userId,
  onBack,
}: Props) {
  const [period, setPeriod] = useState('weekly');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');

  const busy = useRef(false);
  const version = useRef(0);

  async function refresh() {
    if (busy.current) return;

    busy.current = true;
    const currentVersion = version.current;

    try {
      const window = analyticsWindow(period);
      const data: any[] = [];

      for (let page = 0; page < 100; page++) {
        const result = await supabase
          .from('app_orders')
          .select(
            'id,rider_id,product_name,price,quantity,status,created_at,wallet_payment_status,wallet_payment_id,wallet_product_id'
          )
          .eq('merchant_id', userId)
          .gte(
            'created_at',
            window.previousStart.toISOString()
          )
          .lt(
            'created_at',
            window.end.toISOString()
          )
          .order('created_at', {
            ascending: true,
          })
          .order('id', {
            ascending: true,
          })
          .range(
            page * 500,
            page * 500 + 499
          );

        if (result.error) {
          throw result.error;
        }

        data.push(...(result.data || []));

        if ((result.data || []).length < 500) {
          break;
        }

        if (page === 99) {
          throw new Error(
            'This range contains more than 50,000 order items. Select a shorter period.'
          );
        }
      }

      if (version.current === currentVersion) {
        setRows(data);
        setError('');
        setUpdated(
          new Date().toLocaleTimeString()
        );
      }
    } catch (error: any) {
      if (version.current === currentVersion) {
        setError(
          error.message ||
          'Unable to read business analytics.'
        );
      }
    } finally {
      busy.current = false;

      if (version.current === currentVersion) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    version.current++;

    setLoading(true);
    setRows([]);
    setUpdated('');
    setError('');

    void refresh();

    const timer = window.setInterval(() => {
      if (
        document.visibilityState === 'visible'
      ) {
        void refresh();
      }
    }, 5000);

    return () => {
      version.current++;
      window.clearInterval(timer);
    };
  }, [period, userId]);

  const data = merchantAnalytics(rows, period);

  const maximum = Math.max(
    1,
    ...data.buckets.map(
      bucket => bucket.revenueMinor
    )
  );

  const growth =
    data.growthPercent === null
      ? data.revenueMinor
        ? 'Paid sales recorded; no paid sales in the previous period.'
        : 'No paid sales in either period.'
      : `${
          data.growthPercent >= 0 ? '+' : ''
        }${data.growthPercent.toFixed(1)}% compared with the previous matching period`;

  const cards = [
    [
      'Paid product sales',
      sle(data.revenueMinor),
      'from-emerald-600 to-teal-700',
    ],
    [
      'Paid checkouts',
      String(data.paidOrders),
      'from-blue-600 to-indigo-700',
    ],
    [
      'Average paid checkout',
      sle(data.averageOrderMinor),
      'from-violet-600 to-purple-700',
    ],
    [
      'Paying customers',
      String(data.customers),
      'from-orange-500 to-rose-600',
    ],
  ];

  return (
    <section className="mx-auto max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
      <button
        onClick={onBack}
        className="text-sm font-bold text-blue-700"
      >
        ← Back to profile
      </button>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">
            Business analytics
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Confirmed in-app product sales · Freetown time
          </p>
        </div>

        <div className="flex gap-2">
          <select
            value={period}
            onChange={event =>
              setPeriod(event.target.value)
            }
            className="rounded-xl border bg-white p-3"
          >
            <option value="daily">
              Today
            </option>
            <option value="weekly">
              Last 7 days
            </option>
            <option value="monthly">
              Last 30 days
            </option>
          </select>

          <button
            onClick={() => void refresh()}
            className="rounded-xl border bg-white px-4 py-2"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-red-700"
        >
          {error}{' '}
          {updated
            ? 'Previously loaded data is shown below.'
            : ''}
        </p>
      )}

      {loading ? (
        <p>Loading your sales...</p>
      ) : error && !updated ? (
        <p>
          Sales totals are unavailable. Refresh after
          resolving the error.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(
              ([label, value, colour]) => (
                <article
                  key={label}
                  className={`rounded-3xl bg-gradient-to-br p-5 text-white shadow-sm ${colour}`}
                >
                  <p className="text-sm font-medium opacity-90">
                    {label}
                  </p>

                  <p className="mt-3 text-3xl font-black">
                    {value}
                  </p>
                </article>
              )
            )}
          </div>

          <p
            className={`rounded-xl p-4 font-semibold ${
              data.growthPercent !== null &&
              data.growthPercent < 0
                ? 'bg-rose-50 text-rose-800'
                : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            {growth}
          </p>

          <section className="rounded-3xl border bg-white p-5">
            <h2 className="text-xl font-bold">
              Sales over time
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Actual paid product amounts; delivery
              and platform fees are excluded.
            </p>

            <div className="mt-5 overflow-x-auto">
              <div
                className="flex h-52 min-w-max items-end gap-3"
                role="list"
                aria-label="Paid sales by time"
              >
                {data.buckets.map(bucket => {
                  const date = new Date(
                    bucket.date
                  );

                  const label =
                    period === 'daily'
                      ? `${String(
                          date.getUTCHours()
                        ).padStart(2, '0')}:00`
                      : date.toLocaleDateString(
                          'en-GB',
                          {
                            day: 'numeric',
                            month: 'short',
                            timeZone: 'UTC',
                          }
                        );

                  return (
                    <div
                      key={bucket.date}
                      role="listitem"
                      aria-label={`${label}: ${sle(
                        bucket.revenueMinor
                      )}`}
                      title={`${label}: ${sle(
                        bucket.revenueMinor
                      )}`}
                      className="flex h-full w-14 flex-col justify-end text-center"
                    >
                      <span className="mb-1 text-[10px] font-bold">
                        {(
                          bucket.revenueMinor / 100
                        ).toFixed(2)}
                      </span>

                      <div
                        className="min-h-[2px] rounded-t-lg bg-gradient-to-t from-teal-600 to-emerald-400"
                        style={{
                          height: `${
                            (bucket.revenueMinor /
                              maximum) *
                            150
                          }px`,
                        }}
                      />

                      <span className="mt-2 text-[10px] text-slate-500">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border bg-white p-5">
            <h2 className="text-xl font-bold">
              Best-selling products
            </h2>

            {!data.products.length ? (
              <p className="mt-3 text-slate-500">
                No confirmed paid product sales in
                this period.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">
                        Product
                      </th>
                      <th className="p-2">
                        Units sold
                      </th>
                      <th className="p-2">
                        Paid sales
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.products
                      .slice(0, 10)
                      .map((product, index) => (
                        <tr
                          key={index}
                          className="border-t"
                        >
                          <td className="p-2">
                            {product.name}
                          </td>
                          <td className="p-2">
                            {product.units}
                          </td>
                          <td className="p-2 font-bold">
                            {sle(
                              product.revenueMinor
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="border-t pt-4">
            <p className="rounded-xl bg-slate-100 p-4 text-sm">
              Order items: {data.pendingItems}{' '}
              awaiting fulfilment ·{' '}
              {data.completedItems} completed ·{' '}
              {data.cancelledItems}{' '}
              cancelled/refunded.
              {' '}{data.unpaidOrders} active items
              have no confirmed in-app payment.
            </p>
          </div>

          <p className="text-xs text-slate-500">
            {updated
              ? `Updated ${updated}. `
              : ''}
            Orders paid outside MatMove are excluded
            until their payment is verified. Delivery
            completion and payment confirmation are
            tracked separately.
          </p>
        </>
      )}
    </section>
  );
}