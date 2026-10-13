import {
  transactionDirection,
  transactionTitle,
} from '../shared/transaction-display.js';

function owners(tx) {
  const ids = [];
  let owner = tx.ownershipGraph?.owner;

  for (
    let i = 0;
    owner && i < 10;
    i++, owner = owner.owner
  ) {
    if (owner.id) {
      ids.push(owner.id);
    }
  }

  return ids;
}

export async function enrichTransactions(
  db,
  userId,
  transactions,
  warnings
) {
  if (!transactions.length) {
    return [];
  }

  const contexts = new Map();

  try {
    const [
      shops,
      bookings,
      withdrawals,
    ] = await Promise.all([
      db
        .from('matmove_merchant_payments')
        .select('*')
        .or(
          `rider_id.eq.${userId},merchant_id.eq.${userId}`
        )
        .order('created_at', {
          ascending: false,
        })
        .limit(200),

      db
        .from('bookings')
        .select('*')
        .or(
          `rider_id.eq.${userId},driver_id.eq.${userId}`
        )
        .order('created_at', {
          ascending: false,
        })
        .limit(200),

      db
        .from('matmove_withdrawals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', {
          ascending: false,
        })
        .limit(200),
    ]);

    const readLegs = async (
      table,
      column,
      rows
    ) => {
      if (!rows?.length) {
        return {
          data: [],
        };
      }

      return db
        .from(table)
        .select('*')
        .in(
          column,
          rows.map(row => row.id)
        );
    };

    const [
      shopLegs,
      rideLegs,
      payoutLegs,
    ] = await Promise.all([
      readLegs(
        'matmove_merchant_payment_legs',
        'payment_id',
        shops.data
      ),

      readLegs(
        'ride_payment_transfers',
        'booking_id',
        bookings.data
      ),

      readLegs(
        'matmove_withdrawal_legs',
        'withdrawal_id',
        withdrawals.data
      ),
    ]);

    const results = [
      shops,
      bookings,
      withdrawals,
      shopLegs,
      rideLegs,
      payoutLegs,
    ];

    if (results.some(result => result.error)) {
      warnings.push(
        'Some older transaction descriptions are unavailable; ledger amounts remain unchanged.'
      );
    }

    for (const leg of shopLegs.data || []) {
      const payment = shops.data?.find(
        item => item.id === leg.payment_id
      );

      if (!payment || !leg.provider_id) {
        continue;
      }

      const products = (payment.items || [])
        .map(
          item =>
            `${item.name} × ${item.quantity}`
        )
        .join(', ');

      const title =
        payment.merchant_id === userId
          ? 'Sale'
          : 'Shop payment';

      const productAmount = (
        Number(payment.product_minor) / 100
      ).toFixed(2);

      const deliveryAmount = (
        Number(payment.delivery_minor) / 100
      ).toFixed(2);

      const feeAmount = (
        Number(payment.fee_minor) / 100
      ).toFixed(2);

      contexts.set(leg.provider_id, {
        businessTitle: `${title}: ${products}`,

        businessDetails:
          `Products: SLE ${productAmount}; ` +
          `delivery to escrow: SLE ${deliveryAmount}; ` +
          `payment fee: SLE ${feeAmount}. ` +
          `Payment reference: ${payment.id}`,
      });
    }

    for (const leg of rideLegs.data || []) {
      const booking = bookings.data?.find(
        item => item.id === leg.booking_id
      );

      if (!booking || !leg.provider_id) {
        continue;
      }

      const service =
        booking.service_type === 'ride'
          ? 'Ride'
          : booking.service_type === 'scheduled'
          ? 'Scheduled trip'
          : 'Delivery';

      const title =
        leg.kind === 'driver'
          ? `${service} earnings`
          : leg.kind === 'refund'
          ? `${service} refund`
          : leg.kind === 'platform'
          ? `${service} platform fee`
          : `${service} payment`;

      contexts.set(leg.provider_id, {
        businessTitle: title,

        businessDetails:
          `${booking.pickup_location || ''} → ` +
          `${booking.destination_location || ''}. ` +
          `Trip reference: ${booking.id}`,
      });
    }

    for (const leg of payoutLegs.data || []) {
      if (!leg.provider_id) {
        continue;
      }

      const title =
        leg.kind === 'fee'
          ? 'MatMove withdrawal fee'
          : leg.kind === 'refund'
          ? 'Withdrawal fee refund'
          : 'Mobile money withdrawal';

      contexts.set(leg.provider_id, {
        businessTitle: title,
      });
    }
  } catch {
    warnings.push(
      'Detailed transaction descriptions are temporarily unavailable.'
    );
  }

  return transactions.map(tx => {
    const match = owners(tx)
      .map(id => contexts.get(id))
      .find(Boolean);

    const next = {
      ...tx,
      ...(match || {}),
      balanceImpact:
        transactionDirection(tx).toUpperCase(),
    };

    // Provider fees remain separate from the payment.
    if (tx.originatingFee?.code) {
      next.businessTitle =
        'Provider processing fee';
    }

    // Reversals retain their own description.
    if (tx.originatingReversal?.originTxnId) {
      next.businessTitle = 'Payment reversal';
    }

    next.businessTitle = transactionTitle(next);

    return next;
  });
}