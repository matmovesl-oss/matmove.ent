export function analyticsWindow(
  period,
  now = new Date()
) {
  const end = new Date(now.getTime() + 1);

  const midnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const days =
    period === 'daily'
      ? 1
      : period === 'weekly'
      ? 7
      : 30;

  const start = new Date(
    midnight.getTime() -
      (days - 1) * 86400000
  );

  return {
    start,
    end,

    previousStart: new Date(
      start.getTime() - days * 86400000
    ),

    previousEnd: new Date(
      end.getTime() - days * 86400000
    ),

    days,
  };
}

export function merchantAnalytics(
  rows,
  period,
  now = new Date()
) {
  const window = analyticsWindow(period, now);

  const unique = [
    ...new Map(
      rows.map(row => [row.id, row])
    ).values(),
  ];

  const belongs = (row, start, end) => {
    const time = new Date(
      row.created_at
    ).getTime();

    return (
      time >= start.getTime() &&
      time < end.getTime()
    );
  };

  const current = unique.filter(row =>
    belongs(row, window.start, window.end)
  );

  const previous = unique.filter(row =>
    belongs(
      row,
      window.previousStart,
      window.previousEnd
    )
  );

  const paid = row =>
    row.wallet_payment_status === 'paid' &&
    row.wallet_payment_id &&
    row.status !== 'refunded';

  const amount = row => {
    const value = Number(row.price);

    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100)
      : 0;
  };

  const receipts = data =>
    new Set(
      data
        .filter(paid)
        .map(row => row.wallet_payment_id)
    );

  const sales = current.filter(paid);

  const revenueMinor = sales.reduce(
    (sum, row) => sum + amount(row),
    0
  );

  const previousRevenueMinor = previous
    .filter(paid)
    .reduce(
      (sum, row) => sum + amount(row),
      0
    );

  const paidOrders = receipts(current).size;

  const products = new Map();

  for (const row of sales) {
    const key =
      row.wallet_product_id ||
      row.product_name;

    const value = products.get(key) || {
      name: row.product_name || 'Product',
      units: 0,
      revenueMinor: 0,
    };

    value.units += Math.max(
      0,
      Number(row.quantity) || 0
    );

    value.revenueMinor += amount(row);

    products.set(key, value);
  }

  const size =
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
    (_, index) => ({
      date: new Date(
        window.start.getTime() +
          index * size
      ).toISOString(),

      revenueMinor: 0,
    })
  );

  for (const row of sales) {
    const index = Math.floor(
      (
        new Date(row.created_at).getTime() -
        window.start.getTime()
      ) / size
    );

    if (buckets[index]) {
      buckets[index].revenueMinor += amount(row);
    }
  }

  return {
    revenueMinor,
    previousRevenueMinor,
    paidOrders,

    previousPaidOrders:
      receipts(previous).size,

    averageOrderMinor: paidOrders
      ? Math.round(revenueMinor / paidOrders)
      : 0,

    customers: new Set(
      sales
        .map(row => row.rider_id)
        .filter(Boolean)
    ).size,

    unpaidOrders: current.filter(
      row =>
        !paid(row) &&
        !['cancelled', 'refunded'].includes(
          row.status
        )
    ).length,

    pendingItems: current.filter(
      row =>
        ![
          'completed',
          'cancelled',
          'refunded',
        ].includes(row.status)
    ).length,

    completedItems: current.filter(
      row => row.status === 'completed'
    ).length,

    cancelledItems: current.filter(
      row =>
        ['cancelled', 'refunded'].includes(
          row.status
        )
    ).length,

    growthPercent: previousRevenueMinor
      ? (
          (revenueMinor - previousRevenueMinor) /
          previousRevenueMinor
        ) * 100
      : null,

    products: [
      ...products.values(),
    ].sort(
      (a, b) =>
        b.revenueMinor - a.revenueMinor
    ),

    buckets,

    from: window.start.toISOString(),
    to: window.end.toISOString(),
  };
}