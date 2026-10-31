import test from 'node:test';
import assert from 'node:assert/strict';

import {
  transactionAmount,
  transactionDirection,
  transactionTitle,
  transactionReceipt,
} from '../shared/transaction-display.js';

import {
  merchantAnalytics,
  analyticsWindow,
} from '../shared/merchant-analytics.js';

import {
  liveWallet,
} from '../server/live-wallet.js';

import {
  enrichTransactions,
} from '../server/transaction-context.js';

test(
  'Monime credit type takes precedence and shows an incoming plus amount',
  () => {
    const tx = {
      type: 'credit',
      balanceImpact: 'DEBIT',
      amount: {
        currency: 'SLE',
        value: 15500,
      },
      timestamp: '2026-10-13T15:00:00Z',
    };

    assert.equal(
      transactionDirection(tx),
      'credit'
    );

    assert.equal(
      transactionAmount(tx),
      '+ SLE 155.00'
    );

    assert.match(
      transactionReceipt(tx),
      /Direction: Received/
    );
  }
);

test(
  'debit, USD, unknown direction and invalid amounts are honest',
  () => {
    assert.equal(
      transactionAmount({
        type: 'debit',
        amount: {
          currency: 'USD',
          value: 101,
        },
      }),
      '− USD 1.01'
    );

    assert.equal(
      transactionAmount({
        amount: {
          currency: 'SLE',
          value: 100,
        },
      }),
      'SLE 1.00'
    );

    assert.equal(
      transactionAmount({
        type: 'credit',
        amount: {
          currency: 'SLE',
          value: undefined,
        },
      }),
      'Amount unavailable'
    );
  }
);

test(
  'fee and reversal rows preserve their meaning',
  () => {
    assert.equal(
      transactionTitle({
        originatingFee: {
          code: 'payout_fee',
        },
        type: 'debit',
      }),
      'Provider processing fee'
    );

    assert.equal(
      transactionTitle({
        originatingReversal: {
          originTxnId: 'x',
        },
        type: 'credit',
      }),
      'Payment reversal'
    );

    assert.equal(
      transactionTitle({
        businessTitle: 'Sale: Chips × 2',
        type: 'credit',
      }),
      'Sale: Chips × 2'
    );
  }
);

const now = new Date(
  '2026-10-13T16:00:00Z'
);

const row = (id, price, extra = {}) => ({
  id,
  price,
  quantity: 1,
  product_name: 'Chips',
  wallet_product_id: 'chips',
  rider_id: 'rider',
  wallet_payment_id: 'payment-1',
  wallet_payment_status: 'paid',
  status: 'pending',
  created_at: '2026-10-13T10:00:00Z',
  ...extra,
});

test(
  'paid pending-fulfilment sales count; unpaid completed orders do not',
  () => {
    const data = merchantAnalytics(
      [
        row('a', 100),
        row('b', 200, {
          wallet_payment_status: 'unpaid',
          status: 'completed',
          wallet_payment_id: null,
        }),
      ],
      'daily',
      now
    );

    assert.equal(data.revenueMinor, 10000);
    assert.equal(data.paidOrders, 1);
    assert.equal(data.pendingItems, 1);
    assert.equal(data.completedItems, 1);
  }
);

test(
  'checkout line items count as one checkout without losing product value',
  () => {
    const data = merchantAnalytics(
      [
        row('a', 100),
        row('b', 50),
        row('a', 100),
      ],
      'daily',
      now
    );

    assert.equal(data.revenueMinor, 15000);
    assert.equal(data.paidOrders, 1);
    assert.equal(data.averageOrderMinor, 15000);
    assert.equal(data.products[0].units, 2);
  }
);

test(
  'period comparisons use real previous receipts and handle zero baseline',
  () => {
    const data = merchantAnalytics(
      [
        row('a', 100),
        row('b', 50, {
          wallet_payment_id: 'old',
          created_at: '2026-10-12T10:00:00Z',
        }),
      ],
      'daily',
      now
    );

    assert.equal(data.growthPercent, 100);
    assert.equal(
      data.previousRevenueMinor,
      5000
    );

    assert.equal(
      merchantAnalytics(
        [],
        'weekly',
        now
      ).growthPercent,
      null
    );

    assert.equal(
      analyticsWindow(
        'daily',
        now
      ).start.toISOString(),
      '2026-10-13T00:00:00.000Z'
    );
  }
);

test(
  'refund and future rows do not inflate paid sales; per-time bars reconcile',
  () => {
    const data = merchantAnalytics(
      [
        row('a', 100),
        row('b', 50, {
          status: 'refunded',
        }),
        row('c', 60, {
          created_at: '2026-10-14T10:00:00Z',
        }),
      ],
      'daily',
      now
    );

    assert.equal(data.revenueMinor, 10000);

    assert.equal(
      data.buckets.reduce(
        (total, bucket) =>
          total + bucket.revenueMinor,
        0
      ),
      10000
    );
  }
);

test(
  'live history excludes another account and preserves provider timestamp and direction',
  async () => {
    const db = {
      from() {
        throw new Error('No context tables');
      },
    };

    const result = await liveWallet(
      {
        db,
        user: {
          id: 'rider',
        },
        wallets: [
          {
            id: 'w',
            user_id: 'rider',
            currency: 'SLE',
          },
        ],
      },
      {
        verify: async () => ({
          id: 'fac-rider',
          balance: {
            available: {
              currency: 'SLE',
              value: 10000,
            },
          },
        }),

        provider: async () => [
          {
            id: 'wrong',
            type: 'debit',
            financialAccount: {
              id: 'fac-escrow',
            },
            amount: {
              currency: 'SLE',
              value: 100,
            },
          },
          {
            id: 'old',
            type: 'debit',
            timestamp: '2026-10-12T10:00:00Z',
            amount: {
              currency: 'SLE',
              value: 50,
            },
          },
          {
            id: 'new',
            type: 'credit',
            timestamp: '2026-10-13T10:00:00Z',
            amount: {
              currency: 'SLE',
              value: 100,
            },
          },
        ],
      }
    );

    assert.equal(
      result.sleWallet.balance,
      100
    );

    assert.deepEqual(
      result.transactions.map(tx => tx.id),
      ['new', 'old']
    );

    assert.equal(
      result.transactions[0].balanceImpact,
      'CREDIT'
    );
  }
);

test(
  'business descriptions use owned transfer receipts and preserve separate fee entries',
  async () => {
    const values = {
      matmove_merchant_payments: [
        {
          id: 'shop',
          rider_id: 'rider',
          merchant_id: 'merchant',
          items: [
            {
              name: 'Chips',
              quantity: 2,
            },
          ],
          product_minor: 10000,
          delivery_minor: 5000,
          fee_minor: 150,
        },
      ],

      matmove_merchant_payment_legs: [
        {
          payment_id: 'shop',
          provider_id: 'trn-sale',
          kind: 'merchant',
        },
      ],

      bookings: [],
      ride_payment_transfers: [],
      matmove_withdrawals: [],
      matmove_withdrawal_legs: [],
    };

    const db = {
      from(table) {
        const chain = {
          select: () => chain,
          or: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          in: () => chain,

          then: (resolve, reject) =>
            Promise.resolve({
              data: values[table] || [],
            }).then(resolve, reject),
        };

        return chain;
      },
    };

    const warnings = [];

    const result = await enrichTransactions(
      db,
      'merchant',
      [
        {
          id: 'credit',
          type: 'credit',
          ownershipGraph: {
            owner: {
              id: 'trn-sale',
              type: 'internal_transfer',
            },
          },
          amount: {
            currency: 'SLE',
            value: 10000,
          },
        },
        {
          id: 'fee',
          type: 'debit',
          originatingFee: {
            code: 'fee',
          },
          ownershipGraph: {
            owner: {
              id: 'trn-sale',
              type: 'internal_transfer',
            },
          },
          amount: {
            currency: 'SLE',
            value: 100,
          },
        },
      ],
      warnings
    );

    assert.equal(
      result[0].businessTitle,
      'Sale: Chips × 2'
    );

    assert.equal(
      result[1].businessTitle,
      'Provider processing fee'
    );

    assert.equal(warnings.length, 0);
  }
);