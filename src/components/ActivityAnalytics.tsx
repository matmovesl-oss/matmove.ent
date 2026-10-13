import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  walletFetch,
} from '@/lib/apiFetch';

import type {
  ActivityAnalytics as Analytics,
} from '../../shared/activity-analytics.js';

const sle = (amount: number) =>
  `SLE ${(amount / 100).toFixed(2)}`;

type Props = {
  role: 'rider' | 'driver';
  onBack: () => void;
};

export default function ActivityAnalytics({
  role,
  onBack,
}: Props) {
  const [period, setPeriod] = useState('weekly');

  const [data, setData] =
    useState<Analytics | null>(null);

  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');

  const busy = useRef(false);
  const version = useRef(0);

  async function refresh() {
    if (busy.current) return;

    busy.current = true;
    const currentVersion = version.current;

    try {
      const result = await walletFetch(
        '/api/get-live-wallet',
        {
          action: 'activity_analytics',
          period,
        }
      );

      if (!result.response.ok) {
        throw new Error(
          result.data.error ||
          'Analytics unavailable.'
        );
      }

      if (
        !result.data.analytics ||
        result.data.analytics.role !== role
      ) {
        throw new Error(
          'Analytics role did not match this account.'
        );
      }

      if (
        version.current === currentVersion
      ) {
        setData(result.data.analytics);
        setError('');
        setUpdated(result.data.updatedAt);
      }
    } catch (error: any) {
      if (
        version.current === currentVersion
      ) {
        setError(error.message);
      }
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    version.current++;

    setData(null);
    setError('');
    setUpdated('');

    void refresh();

    const timer = window.setInterval(() => {
      if (
        document.visibilityState === 'visible'
      ) {
        void refresh();
      }
    }, 10000);

    return () => {
      version.current++;
      window.clearInterval(timer);
    };
  }, [period, role]);

  const driver = role === 'driver';

  const maximum = Math.max(
    1,
    ...(data?.buckets || []).map(
      bucket => Math.abs(bucket.amountMinor)
    )
  );

  const cards = data
    ? driver
      ? [
          [
            'Wallet earnings received',
            sle(data.primaryMinor),
          ],
          [
            'Trips with confirmed driver payment',
            String(data.paidTrips),
          ],
          [
            'Average paid trip',
            sle(data.averageTripMinor),
          ],
          [
            'Withdrawn to mobile money',
            sle(data.withdrawalsMinor),
          ],
        ]
      : [
          [
            'Recorded service spending',
            sle(data.primaryMinor),
          ],
          [
            'Ride payments',
            String(data.paidTrips),
          ],
          [
            'Shopping payments',
            String(data.shoppingCount),
          ],
          [
            'Active trip requests',
            String(data.activeRequests),
          ],
        ]
    : [];

  const colours = [
    'from-emerald-600 to-teal-700',
    'from-blue-600 to-indigo-700',
    'from-violet-600 to-purple-700',
    'from-orange-500 to-rose-600',
  ];

  const breakdown: [string, number][] = data
    ? driver
      ? [
          [
            'Mobile money withdrawals',
            data.withdrawalsMinor,
          ],
          [
            'MatMove withdrawal fees paid',
            data.withdrawalFeesMinor,
          ],
          [
            'Recorded Monime withdrawal fees',
            data.providerFeesMinor,
          ],
          [
            'Withdrawal fee refunds',
            data.feeRefundsMinor,
          ],
        ]
      : [
          [
            'Ride payments to escrow',
            data.ridePaymentsMinor,
          ],
          [
            'Ride refunds received',
            data.rideRefundsMinor,
          ],
          [
            'Products paid for',
            data.productsMinor,
          ],
          [
            'Delivery funded in escrow',
            data.deliveryMinor,
          ],
          [
            'Shopping payment fees',
            data.shoppingFeeMinor,
          ],
          [
            'MatMove withdrawal fees',
            data.withdrawalFeesMinor,
          ],
          [
            'Recorded Monime withdrawal fees',
            data.providerFeesMinor,
          ],
          [
            'Withdrawal fee refunds',
            data.feeRefundsMinor,
          ],
        ]
    : [];

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
            {driver
              ? 'Driver earnings analytics'
              : 'Rider spending analytics'}
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Confirmed SLE payment receipts ·
            Freetown time
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
          {data
            ? 'Previously loaded data is shown.'
            : ''}
        </p>
      )}

      {!data ? (
        <p>
          {error
            ? 'Analytics unavailable. Resolve the error and refresh.'
            : 'Loading your analytics...'}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(
              ([label, value], index) => (
                <article
                  key={label}
                  className={`rounded-3xl bg-gradient-to-br p-5 text-white shadow-sm ${colours[index]}`}
                >
                  <p className="text-sm font-medium">
                    {label}
                  </p>

                  <p className="mt-3 text-3xl font-black">
                    {value}
                  </p>
                </article>
              )
            )}
          </div>

          <p className="rounded-xl bg-blue-50 p-4 font-semibold text-blue-900">
            {data.growthPercent === null
              ? `No positive ${
                  driver
                    ? 'earnings'
                    : 'spending'
                } baseline in the previous matching period.`
              : `${
                  data.growthPercent >= 0
                    ? '+'
                    : ''
                }${data.growthPercent.toFixed(1)}% ${
                  driver
                    ? 'earnings'
                    : 'spending'
                } compared with the previous matching period.`}
          </p>

          <section className="rounded-3xl border bg-white p-5">
            <h2 className="text-xl font-bold">
              {driver
                ? 'Earnings over time'
                : 'Service spending over time'}
            </h2>

            <div className="mt-5 overflow-x-auto">
              <div
                role="list"
                aria-label="Payment amounts by time"
                className="flex h-52 min-w-max items-end gap-3"
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
                        bucket.amountMinor
                      )}`}
                      className="flex h-full w-14 flex-col justify-end text-center"
                    >
                      <span className="mb-1 text-[10px] font-bold">
                        {(
                          bucket.amountMinor / 100
                        ).toFixed(2)}
                      </span>

                      <div
                        className={`min-h-[2px] rounded-t-lg ${
                          bucket.amountMinor < 0
                            ? 'bg-rose-400'
                            : 'bg-teal-500'
                        }`}
                        style={{
                          height: `${
                            (Math.abs(
                              bucket.amountMinor
                            ) /
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
              {driver
                ? 'Paid trips by service'
                : 'Ride payments by service'}
            </h2>

            {!data.services.length ? (
              <p className="mt-3 text-slate-500">
                No confirmed trip payments in
                this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">
                        Service
                      </th>
                      <th className="p-2">
                        Payments
                      </th>
                      <th className="p-2">
                        Amount
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.services.map(service => (
                      <tr
                        key={service.name}
                        className="border-t"
                      >
                        <td className="p-2 capitalize">
                          {service.name}
                        </td>

                        <td className="p-2">
                          {service.count}
                        </td>

                        <td className="p-2 font-bold">
                          {sle(
                            service.amountMinor
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-3xl border bg-white p-5">
            <h2 className="text-xl font-bold">
              {driver
                ? 'Withdrawals and fees'
                : 'Spending breakdown'}
            </h2>

            <dl className="mt-4 space-y-3">
              {breakdown.map(
                ([label, amount]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-3 border-b pb-2"
                  >
                    <dt className="text-sm text-slate-600">
                      {label}
                    </dt>

                    <dd className="font-bold">
                      {sle(amount)}
                    </dd>
                  </div>
                )
              )}
            </dl>
          </section>

          <div className="border-t pt-4">
            <p className="rounded-xl bg-slate-100 p-4 text-sm">
              Trip requests in this period:{' '}
              {data.requestedTrips} total ·{' '}
              {data.completedRequests} completed ·{' '}
              {data.activeRequests} active ·{' '}
              {data.cancelledRequests} cancelled.
              Request counts use booking creation
              time; money charts use confirmed
              receipt time.
            </p>
          </div>

          {(
            data.unconfirmedProviderFees > 0 ||
            data.missingDates > 0
          ) && (
            <p
              role="status"
              className="rounded-xl bg-amber-50 p-3 text-sm"
            >
              {data.unconfirmedProviderFees > 0
                ? `${data.unconfirmedProviderFees} provider fee receipts are unconfirmed and excluded from totals. `
                : ''}

              {data.missingDates > 0
                ? `${data.missingDates} payment receipts have no recorded date and are excluded from period totals.`
                : ''}
            </p>
          )}

          <p className="text-xs text-slate-500">
            {updated
              ? `Updated ${new Date(
                  updated
                ).toLocaleTimeString()}. `
              : ''}

            {driver
              ? 'Earnings require a completed driver transfer receipt; quoted fares are not counted as received earnings.'
              : 'Withdrawn principal and wallet top-ups are not counted as service spending. Refunds reduce recorded spending. Shopping funds in escrow do not imply delivery completion.'}
          </p>
        </>
      )}
    </section>
  );
}