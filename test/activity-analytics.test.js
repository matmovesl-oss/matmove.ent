import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityAnalytics,
} from '../shared/activity-analytics.js';

import {
  activityAnalyticsAction,
} from '../server/activity-analytics.js';

const now = new Date(
  '2026-10-13T16:00:00Z'
);

const booked = {
  id: 'b',
  rider_id: 'rider',
  driver_id: 'driver',
  service_type: 'ride',
  status: 'in_progress',
  created_at: '2026-10-12T10:00:00Z',
};

const leg = (
  kind,
  amount,
  extra = {}
) => ({
  booking_id: 'b',
  kind,
  amount_minor: amount,
  provider_id: `trn-${kind}`,
  status: 'completed',
  updated_at: '2026-10-13T10:00:00Z',
  ...extra,
});

test(
  'driver earnings use actual completed receipt, not quoted 85% or booking status',
  () => {
    const data = activityAnalytics(
      {
        bookings: [booked],
        rideLegs: [
          leg('driver', 8200),
        ],
      },
      'driver',
      'driver',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 8200);
    assert.equal(data.paidTrips, 1);
    assert.equal(data.averageTripMinor, 8200);
    assert.equal(data.requestedTrips, 0);
  }
);

test(
  'pending driver payments and another drivers bookings do not count',
  () => {
    const data = activityAnalytics(
      {
        bookings: [booked],
        rideLegs: [
          leg('driver', 8200, {
            status: 'processing',
          }),
        ],
      },
      'driver',
      'driver',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 0);

    const otherDriver = activityAnalytics(
      {
        bookings: [booked],
        rideLegs: [
          leg('driver', 8200),
        ],
      },
      'driver',
      'other',
      'daily',
      now
    );

    assert.equal(
      otherDriver.primaryMinor,
      0
    );
  }
);

test(
  'rider refunds reduce spending and shopping amounts split without double counting',
  () => {
    const payment = {
      id: 'p',
      rider_id: 'rider',
      product_minor: 10000,
      delivery_minor: 5000,
      fee_minor: 150,
    };

    const data = activityAnalytics(
      {
        bookings: [booked],

        rideLegs: [
          leg('hold', 10000),
          leg('refund', 10000),
        ],

        shopPayments: [payment],

        shopLegs: [
          {
            payment_id: 'p',
            kind: 'hold',
            amount_minor: 15150,
            provider_id: 'trn-shop',
            status: 'completed',
            updated_at:
              '2026-10-13T11:00:00Z',
          },
        ],
      },
      'rider',
      'rider',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 15150);
    assert.equal(data.rideRefundsMinor, 10000);
    assert.equal(data.productsMinor, 10000);
    assert.equal(data.deliveryMinor, 5000);
    assert.equal(data.shoppingFeeMinor, 150);
  }
);

test(
  'withdrawal principal excluded from spending; actual fees and refunds included',
  () => {
    const data = activityAnalytics(
      {
        withdrawals: [
          {
            id: 'w',
            user_id: 'rider',
            actual_monime_fee_minor: 100,
          },
        ],

        withdrawalLegs: [
          {
            withdrawal_id: 'w',
            kind: 'payout',
            amount_minor: 10000,
            provider_id: 'payout',
            status: 'completed',
            updated_at:
              '2026-10-13T10:00:00Z',
          },
          {
            withdrawal_id: 'w',
            kind: 'fee',
            amount_minor: 58,
            provider_id: 'fee',
            status: 'completed',
            updated_at:
              '2026-10-13T10:00:00Z',
          },
        ],
      },
      'rider',
      'rider',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 158);
    assert.equal(data.withdrawalsMinor, 10000);
    assert.equal(data.providerFeesMinor, 100);
  }
);

test(
  'unknown fees and missing timestamps are explicit and excluded',
  () => {
    const data = activityAnalytics(
      {
        bookings: [booked],

        rideLegs: [
          leg('hold', 10000, {
            updated_at: null,
          }),
        ],

        withdrawals: [
          {
            id: 'w',
            user_id: 'rider',
            actual_monime_fee_minor: null,
          },
        ],

        withdrawalLegs: [
          {
            withdrawal_id: 'w',
            kind: 'payout',
            amount_minor: 10000,
            provider_id: 'payout',
            status: 'completed',
            updated_at:
              '2026-10-13T10:00:00Z',
          },
        ],
      },
      'rider',
      'rider',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 0);
    assert.equal(data.missingDates, 1);
    assert.equal(
      data.unconfirmedProviderFees,
      1
    );
  }
);

test(
  'duplicates do not inflate earnings and chart buckets reconcile',
  () => {
    const data = activityAnalytics(
      {
        bookings: [booked],
        rideLegs: [
          leg('driver', 8200),
          leg('driver', 8200),
        ],
      },
      'driver',
      'driver',
      'daily',
      now
    );

    assert.equal(data.primaryMinor, 8200);

    assert.equal(
      data.buckets.reduce(
        (total, bucket) =>
          total + bucket.amountMinor,
        0
      ),
      8200
    );
  }
);

test(
  'analytics API rejects unsupported role and period before reading data',
  async () => {
    await assert.rejects(
      activityAnalyticsAction(
        {
          body: {},
          matmove: {
            profile: {
              role: 'merchant',
            },
          },
        },
        {}
      ),
      error => error.status === 403
    );

    await assert.rejects(
      activityAnalyticsAction(
        {
          body: {
            period: 'all',
          },
          matmove: {
            profile: {
              role: 'rider',
            },
          },
        },
        {}
      ),
      error => error.status === 400
    );
  }
);