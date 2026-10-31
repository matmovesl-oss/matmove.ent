import {
  HttpError,
} from './wallet-security.js';

import {
  activityAnalytics,
} from '../shared/activity-analytics.js';

async function readAll(makeQuery) {
  const rows = [];

  for (let page = 0; page < 100; page++) {
    const { data, error } = await makeQuery()
      .range(
        page * 500,
        page * 500 + 499
      );

    if (error) {
      console.error(
        'MatMove analytics query failed',
        {
          code: error.code,
          message: error.message,
        }
      );

      throw new HttpError(
        503,
        'Analytics receipts could not be loaded. Check the installed payment migrations.'
      );
    }

    rows.push(...(data || []));

    if ((data || []).length < 500) {
      return rows;
    }
  }

  throw new HttpError(
    503,
    'Activity volume exceeds this report limit. Contact support for an expanded report.'
  );
}

async function legs(
  db,
  table,
  column,
  ids,
  from,
  to
) {
  const rows = [];

  for (
    let index = 0;
    index < ids.length;
    index += 200
  ) {
    const batch = ids.slice(
      index,
      index + 200
    );

    const result = await readAll(() =>
      db
        .from(table)
        .select('*')
        .in(column, batch)
        .eq('status', 'completed')
        .gte('updated_at', from)
        .lt('updated_at', to)
        .order(column, {
          ascending: true,
        })
        .order('kind', {
          ascending: true,
        })
    );

    rows.push(...result);
  }

  return rows;
}

export async function activityAnalyticsAction(
  req,
  res
) {
  const {
    db,
    user,
    profile,
  } = req.matmove;

  if (
    !['rider', 'driver'].includes(
      profile.role
    )
  ) {
    throw new HttpError(
      403,
      'Rider or driver analytics required.'
    );
  }

  const period =
    req.body.period || 'weekly';

  if (
    ![
      'daily',
      'weekly',
      'monthly',
    ].includes(period)
  ) {
    throw new HttpError(
      400,
      'Choose today, last 7 days or last 30 days.'
    );
  }

  const {
    analyticsWindow,
  } = await import(
    '../shared/merchant-analytics.js'
  );

  const now = new Date();
  const window = analyticsWindow(
    period,
    now
  );

  const [
    bookings,
    withdrawals,
    shopPayments,
  ] = await Promise.all([
    readAll(() =>
      db
        .from('bookings')
        .select('*')
        .eq(
          profile.role === 'driver'
            ? 'driver_id'
            : 'rider_id',
          user.id
        )
        .order('id', {
          ascending: true,
        })
    ),

    readAll(() =>
      db
        .from('matmove_withdrawals')
        .select('*')
        .eq('user_id', user.id)
        .order('id', {
          ascending: true,
        })
    ),

    profile.role === 'rider'
      ? readAll(() =>
          db
            .from('matmove_merchant_payments')
            .select('*')
            .eq('rider_id', user.id)
            .order('id', {
              ascending: true,
            })
        )
      : Promise.resolve([]),
  ]);

  const from =
    window.previousStart.toISOString();

  const to =
    window.end.toISOString();

  const [
    rideLegs,
    withdrawalLegs,
    shopLegs,
  ] = await Promise.all([
    legs(
      db,
      'ride_payment_transfers',
      'booking_id',
      bookings.map(booking => booking.id),
      from,
      to
    ),

    legs(
      db,
      'matmove_withdrawal_legs',
      'withdrawal_id',
      withdrawals.map(
        withdrawal => withdrawal.id
      ),
      from,
      to
    ),

    legs(
      db,
      'matmove_merchant_payment_legs',
      'payment_id',
      shopPayments.map(
        payment => payment.id
      ),
      from,
      to
    ),
  ]);

  const analytics = activityAnalytics(
    {
      bookings,
      withdrawals,
      shopPayments,
      rideLegs,
      withdrawalLegs,
      shopLegs,
    },
    profile.role,
    user.id,
    period,
    now
  );

  return res.status(200).json({
    analytics,
    updatedAt: now.toISOString(),
  });
}