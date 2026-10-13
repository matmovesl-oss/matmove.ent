import {
  analyticsWindow,
} from './merchant-analytics.js';

export function activityAnalytics(
  data,
  role,
  userId,
  period,
  now = new Date()
) {
  const window = analyticsWindow(period, now);

  const money = value => {
    const number = Number(value);

    if (
      !Number.isSafeInteger(number) ||
      number < 0
    ) {
      throw new Error(
        'A payment receipt has an invalid amount.'
      );
    }

    return number;
  };

  const unique = rows => [
    ...new Map(
      (rows || []).map(row => [
        row.id ||
          `${
            row.booking_id ||
            row.payment_id ||
            row.withdrawal_id
          }:${row.kind}`,
        row,
      ])
    ).values(),
  ];

  const bookings = unique(
    data.bookings
  ).filter(
    booking =>
      (
        role === 'driver'
          ? booking.driver_id
          : booking.rider_id
      ) === userId
  );

  const bookingMap = new Map(
    bookings.map(booking => [
      booking.id,
      booking,
    ])
  );

  const shops = new Map(
    unique(data.shopPayments)
      .filter(
        payment =>
          payment.rider_id === userId
      )
      .map(payment => [
        payment.id,
        payment,
      ])
  );

  const withdrawals = new Map(
    unique(data.withdrawals)
      .filter(
        payment =>
          payment.user_id === userId
      )
      .map(payment => [
        payment.id,
        payment,
      ])
  );

  const events = [];

  for (const leg of unique(data.rideLegs)) {
    const booking = bookingMap.get(
      leg.booking_id
    );

    if (
      !booking ||
      leg.status !== 'completed' ||
      !leg.provider_id
    ) {
      continue;
    }

    const kind =
      role === 'driver'
        ? leg.kind === 'driver'
          ? 'earnings'
          : null
        : leg.kind === 'hold'
        ? 'rides'
        : leg.kind === 'refund'
        ? 'rideRefunds'
        : null;

    if (!kind) continue;

    events.push({
      id: leg.provider_id,
      kind,
      amountMinor: money(leg.amount_minor),
      date: leg.updated_at,
      service: booking.service_type || 'ride',
      bookingId: booking.id,
    });
  }

  if (role === 'rider') {
    for (const leg of unique(data.shopLegs)) {
      const payment = shops.get(
        leg.payment_id
      );

      if (
        !payment ||
        leg.kind !== 'hold' ||
        leg.status !== 'completed' ||
        !leg.provider_id
      ) {
        continue;
      }

      events.push({
        id: leg.provider_id,
        kind: 'shopping',
        amountMinor: money(leg.amount_minor),
        date: leg.updated_at,
        productsMinor: money(
          payment.product_minor
        ),
        deliveryMinor: money(
          payment.delivery_minor
        ),
        shoppingFeeMinor: money(
          payment.fee_minor
        ),
      });
    }
  }

  for (
    const leg of unique(data.withdrawalLegs)
  ) {
    const payment = withdrawals.get(
      leg.withdrawal_id
    );

    if (
      !payment ||
      leg.status !== 'completed' ||
      !leg.provider_id
    ) {
      continue;
    }

    if (
      leg.kind === 'fee' ||
      leg.kind === 'refund'
    ) {
      events.push({
        id: leg.provider_id,

        kind:
          leg.kind === 'fee'
            ? 'withdrawalFees'
            : 'feeRefunds',

        amountMinor: money(leg.amount_minor),
        date: leg.updated_at,
      });
    }

    if (leg.kind === 'payout') {
      events.push({
        id: leg.provider_id,
        kind: 'withdrawals',
        amountMinor: money(leg.amount_minor),
        date: leg.updated_at,
      });

      events.push({
        id: `${leg.provider_id}:provider-fee`,
        kind: 'providerFees',

        amountMinor:
          payment.actual_monime_fee_minor == null
            ? 0
            : money(
                payment.actual_monime_fee_minor
              ),

        unconfirmed:
          payment.actual_monime_fee_minor == null,

        date: leg.updated_at,
      });
    }
  }

  const belongs = (value, start, end) => {
    const time = new Date(value).getTime();

    return (
      time >= start.getTime() &&
      time < end.getTime()
    );
  };

  const missingDates = events.filter(
    event =>
      !event.date ||
      Number.isNaN(
        new Date(event.date).getTime()
      )
  ).length;

  const current = events.filter(event =>
    belongs(
      event.date,
      window.start,
      window.end
    )
  );

  const previous = events.filter(event =>
    belongs(
      event.date,
      window.previousStart,
      window.previousEnd
    )
  );

  const sum = (rows, kind) =>
    rows
      .filter(
        event =>
          event.kind === kind &&
          !event.unconfirmed
      )
      .reduce(
        (total, event) =>
          total + event.amountMinor,
        0
      );

  const primary = rows =>
    role === 'driver'
      ? sum(rows, 'earnings')
      : sum(rows, 'rides') +
        sum(rows, 'shopping') +
        sum(rows, 'withdrawalFees') +
        sum(rows, 'providerFees') -
        sum(rows, 'rideRefunds') -
        sum(rows, 'feeRefunds');

  const primaryMinor = primary(current);
  const previousPrimaryMinor =
    primary(previous);

  const requested = bookings.filter(
    booking =>
      belongs(
        booking.created_at,
        window.start,
        window.end
      )
  );

  const earnings = current.filter(
    event => event.kind === 'earnings'
  );

  const services = new Map();

  for (
    const event of current.filter(
      event =>
        ['earnings', 'rides'].includes(
          event.kind
        )
    )
  ) {
    const item = services.get(
      event.service
    ) || {
      name: event.service,
      count: 0,
      amountMinor: 0,
    };

    item.count++;
    item.amountMinor += event.amountMinor;

    services.set(event.service, item);
  }

  const step =
    period === 'daily'
      ? 3600000
      : 86400000;

  const buckets = Array.from(
    {
      length:
        period === 'daily'
          ? 24
          : window.days,
    },
    (_, index) => {
      const start = new Date(
        window.start.getTime() +
          index * step
      );

      const end = new Date(
        start.getTime() + step
      );

      return {
        date: start.toISOString(),

        amountMinor: primary(
          current.filter(event =>
            belongs(event.date, start, end)
          )
        ),
      };
    }
  );

  return {
    role,
    primaryMinor,
    previousPrimaryMinor,

    growthPercent:
      previousPrimaryMinor > 0
        ? (
            (primaryMinor -
              previousPrimaryMinor) /
            previousPrimaryMinor
          ) * 100
        : null,

    paidTrips:
      role === 'driver'
        ? earnings.length
        : current.filter(
            event => event.kind === 'rides'
          ).length,

    averageTripMinor: earnings.length
      ? Math.round(
          sum(current, 'earnings') /
            earnings.length
        )
      : 0,

    requestedTrips: requested.length,

    completedRequests: requested.filter(
      booking => booking.status === 'completed'
    ).length,

    cancelledRequests: requested.filter(
      booking => booking.status === 'cancelled'
    ).length,

    activeRequests: requested.filter(
      booking =>
        [
          'pending',
          'pending_admin',
          'accepted',
          'in_progress',
        ].includes(booking.status)
    ).length,

    ridePaymentsMinor:
      sum(current, 'rides'),

    rideRefundsMinor:
      sum(current, 'rideRefunds'),

    shoppingMinor:
      sum(current, 'shopping'),

    shoppingCount: current.filter(
      event => event.kind === 'shopping'
    ).length,

    productsMinor: current.reduce(
      (total, event) =>
        total + (event.productsMinor || 0),
      0
    ),

    deliveryMinor: current.reduce(
      (total, event) =>
        total + (event.deliveryMinor || 0),
      0
    ),

    shoppingFeeMinor: current.reduce(
      (total, event) =>
        total + (event.shoppingFeeMinor || 0),
      0
    ),

    withdrawalsMinor:
      sum(current, 'withdrawals'),

    withdrawalFeesMinor:
      sum(current, 'withdrawalFees'),

    providerFeesMinor:
      sum(current, 'providerFees'),

    feeRefundsMinor:
      sum(current, 'feeRefunds'),

    unconfirmedProviderFees: current.filter(
      event =>
        event.kind === 'providerFees' &&
        event.unconfirmed
    ).length,

    missingDates,

    services: [
      ...services.values(),
    ].sort(
      (a, b) =>
        b.amountMinor - a.amountMinor
    ),

    buckets,

    from: window.start.toISOString(),
    to: window.end.toISOString(),
  };
}