import {
  HttpError,
  assertAllowed,
  verifiedAccount,
  monime
} from './wallet-security.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const accountId = /^fac-[A-Za-z0-9_-]+$/;

export async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);

  if (error) {
    const known =
      /^(FORBIDDEN|NOT_FOUND|INVALID_STATE|PAYMENT_PENDING|LEGACY_PAYMENT|INVALID_FARE|ACCOUNT_CHANGED):/;

    throw new HttpError(
      known.test(error.message) ? 409 : 503,

      known.test(error.message)
        ? error.message.replace(/^[A-Z_]+: /, '')
        : 'Ride payment storage is unavailable. Please try again.'
    );
  }

  return data;
}

async function readBooking(db, id) {
  const { data, error } = await db
    .from('bookings')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new HttpError(
      404,
      'Booking not found.'
    );
  }

  return data;
}

async function readPayment(db, id) {
  const { data, error } = await db
    .from('ride_payments')
    .select('*')
    .eq('booking_id', id)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      503,
      'Ride payment storage is unavailable. Apply the ride payment migration first.'
    );
  }

  return data;
}

async function customerAccount(
  db,
  id,
  roles,
  verifyAccount = verifiedAccount
) {
  const [p, w] = await Promise.all([
    db
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single(),

    db
      .from('wallets')
      .select('*')
      .eq('user_id', id)
  ]);

  if (p.error || w.error || !p.data) {
    throw new HttpError(
      503,
      'Unable to verify ride wallet permissions.'
    );
  }

  if (!roles.includes(p.data.role)) {
    throw new HttpError(
      403,
      'This account cannot perform that ride action.'
    );
  }

  assertAllowed(
    p.data,
    w.data || [],
    'transfer'
  );

  const wallets = (w.data || []).filter(
    wallet => wallet.currency === 'SLE'
  );

  if (wallets.length !== 1) {
    throw new HttpError(
      409,
      'A unique SLE wallet is required for this ride.'
    );
  }

  return verifyAccount(db, wallets[0]);
}

async function platformAccounts(provider) {
  const escrow =
    process.env.MONIME_ESCROW_ACCOUNT_ID;

  const revenue =
    process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID;

  if (
    !accountId.test(escrow || '') ||
    !accountId.test(revenue || '')
  ) {
    throw new HttpError(
      503,
      'Configure the SLE escrow and platform fee financial accounts.'
    );
  }

  const ids = [escrow, revenue];

  const results = await Promise.all(
    ids.map(id =>
      provider(
        `financial-accounts/${encodeURIComponent(id)}?withBalance=true`
      )
    )
  );

  if (
    results.some(
      (result, index) =>
        result.id !== ids[index] ||
        result.currency !== 'SLE'
    )
  ) {
    throw new HttpError(
      409,
      'Both platform financial accounts must use SLE.'
    );
  }

  return { escrow, revenue };
}

// A database claim permits only one POST per transfer leg.
// Transfers with known IDs are checked using GET.
// Uncertain outcomes require review rather than another debit.
export async function runLeg(
  db,
  bookingId,
  kind,
  provider = monime
) {
  const leg = await rpc(
    db,
    'claim_ride_transfer',
    {
      p_booking_id: bookingId,
      p_kind: kind
    }
  );

  if (
    !leg ||
    ['completed', 'failed', 'review_required']
      .includes(leg.status)
  ) {
    return leg;
  }

  if (!leg.can_create && !leg.provider_id) {
    return leg;
  }

  let transfer;

  try {
    transfer = leg.provider_id
      ? await provider(
          `internal-transfers/${encodeURIComponent(leg.provider_id)}`
        )
      : await provider(
          'internal-transfers',
          {
            method: 'POST',

            headers: {
              'Idempotency-Key': leg.request_key
            },

            body: JSON.stringify({
              amount: {
                currency: 'SLE',
                value: Number(leg.amount_minor)
              },

              sourceFinancialAccount: {
                id: leg.source_account
              },

              destinationFinancialAccount: {
                id: leg.destination_account
              },

              description:
                `MatMove ${kind} for booking ${bookingId}`,

              metadata: {
                bookingId,
                leg: kind,
                requestKey: leg.request_key
              }
            })
          }
        );
  } catch (error) {
    if (leg.can_create) {
      await rpc(
        db,
        'record_ride_transfer',
        {
          p_booking_id: bookingId,
          p_kind: kind,
          p_provider_id: null,
          p_status: 'review_required',

          p_error:
            'Provider response uncertain; reconcile before retrying.'
        }
      );
    }

    throw error;
  }

  const matches =
    typeof transfer?.id === 'string' &&
    transfer.id.length > 0 &&
    (
      !leg.provider_id ||
      transfer.id === leg.provider_id
    ) &&
    transfer.amount?.currency === 'SLE' &&
    transfer.amount?.value === Number(leg.amount_minor) &&
    transfer.sourceFinancialAccount?.id === leg.source_account &&
    transfer.destinationFinancialAccount?.id === leg.destination_account &&
    ['pending', 'processing', 'completed', 'failed']
      .includes(transfer.status);

  if (!matches) {
    await rpc(
      db,
      'record_ride_transfer',
      {
        p_booking_id: bookingId,
        p_kind: kind,
        p_provider_id: leg.provider_id || null,
        p_status: 'review_required',

        p_error:
          'Provider response does not match the recorded transfer.'
      }
    );

    throw new HttpError(
      502,
      'Transfer verification needs support review. No further debit will be attempted.'
    );
  }

  return rpc(
    db,
    'record_ride_transfer',
    {
      p_booking_id: bookingId,
      p_kind: kind,
      p_provider_id: transfer.id,
      p_status: transfer.status,
      p_error: transfer.failureDetail?.message || null
    }
  );
}

export async function reconcileRide(
  db,
  bookingId,
  provider = monime
) {
  const payment = await readPayment(db, bookingId);

  if (!payment) return null;

  // Shared escrow/fee account: only pay the driver.
  // The platform fee remains in that shared account.
  const releaseKinds =
    payment.escrow_account === payment.fee_account
      ? ['driver']
      : ['driver', 'fee'];

  const kinds = {
    funding: ['hold'],
    releasing: releaseKinds,
    refunding: ['refund']
  }[payment.state] || [];

  for (const kind of kinds) {
    const leg = await runLeg(
      db,
      bookingId,
      kind,
      provider
    );

    if (leg?.status !== 'completed') break;
  }

  await rpc(
    db,
    'finalize_ride_payment',
    {
      p_booking_id: bookingId
    }
  );

  return readPayment(db, bookingId);
}

export async function rideAction(
  req,
  res,
  action,
  {
    provider = monime,
    verifyAccount = verifiedAccount
  } = {}
) {
  const { db, user, profile } = req.matmove;
  const bookingId = req.body?.bookingId;

  if (!uuid.test(String(bookingId || ''))) {
    throw new HttpError(
      400,
      'A valid booking ID is required.'
    );
  }

  const booking = await readBooking(db, bookingId);
  const payment = await readPayment(db, bookingId);

  if (action === 'status') {
    if (
      booking.rider_id !== user.id &&
      booking.driver_id !== user.id
    ) {
      throw new HttpError(
        403,
        "This is another customer's booking."
      );
    }

    const snapshot = await paymentSnapshot(
      db,
      bookingId,
      payment
    );

    return res.status(200).json({
      booking,
      payment: snapshot,
      success: snapshot?.settled === true,
      pending: false
    });
  }

  if (action === 'accept') {
    if (profile.role !== 'driver') {
      throw new HttpError(
        403,
        'Only an approved driver can accept a ride.'
      );
    }

    if (
      booking.driver_id &&
      booking.driver_id !== user.id
    ) {
      throw new HttpError(
        409,
        'This ride has another driver.'
      );
    }

    if (booking.rider_id === user.id) {
      throw new HttpError(
        403,
        'You cannot drive your own booking.'
      );
    }

    if (!payment) {
      const [payer, driver, platform] =
        await Promise.all([
          customerAccount(
            db,
            booking.rider_id,
            ['rider', 'merchant'],
            verifyAccount
          ),

          customerAccount(
            db,
            user.id,
            ['driver'],
            verifyAccount
          ),

          platformAccounts(provider)
        ]);

      if (
        payer.id === driver.id ||
        [platform.escrow, platform.revenue]
          .includes(payer.id) ||
        [platform.escrow, platform.revenue]
          .includes(driver.id)
      ) {
        throw new HttpError(
          409,
          'Customer and driver wallets must be separate from each other and from platform accounts.'
        );
      }

      await rpc(
        db,
        'prepare_ride_payment',
        {
          p_booking_id: bookingId,
          p_actor_id: user.id,
          p_action: action,
          p_payer_account: payer.id,
          p_driver_account: driver.id,
          p_escrow_account: platform.escrow,
          p_fee_account: platform.revenue
        }
      );
    } else {
      if (payment.driver_id !== user.id) {
        throw new HttpError(
          403,
          'This payment has another driver.'
        );
      }

      await rpc(
        db,
        'prepare_ride_payment',
        {
          p_booking_id: bookingId,
          p_actor_id: user.id,
          p_action: action
        }
      );
    }
  } else {
    if (
      action === 'start' &&
      (
        profile.role !== 'driver' ||
        booking.driver_id !== user.id
      )
    ) {
      throw new HttpError(
        403,
        'Only the assigned driver can start this ride.'
      );
    }

    if (
      ['complete', 'cancel'].includes(action) &&
      booking.rider_id !== user.id
    ) {
      throw new HttpError(
        403,
        'Only the customer who booked this trip can confirm or cancel it.'
      );
    }

    await rpc(
      db,
      'prepare_ride_payment',
      {
        p_booking_id: bookingId,
        p_actor_id: user.id,
        p_action: action
      }
    );
  }

  const result = await reconcileRide(
    db,
    bookingId,
    provider
  );

  const updated = await readBooking(db, bookingId);

  const expected = {
    accept: ['accepted', 'in_progress', 'completed'],
    start: ['in_progress'],
    complete: ['completed'],
    cancel: ['cancelled']
  }[action];

  const snapshot = await paymentSnapshot(
    db,
    bookingId,
    result
  );

  const financiallyReady =
    action === 'complete'
      ? snapshot?.settled === true
      : action === 'cancel'
        ? !result ||
          ['refunded', 'failed'].includes(result.state)
        : snapshot?.holdConfirmed === true &&
          ['funded', 'releasing', 'released']
            .includes(result?.state);

  const done =
    expected.includes(updated.status) &&
    financiallyReady;

  if (
    !done &&
    snapshot &&
    (
      snapshot.needsReview ||
      ['released', 'refunded'].includes(result.state)
    )
  ) {
    throw new HttpError(
      409,
      'Ride payment needs support review. Do not make another payment.'
    );
  }

  return res.status(done ? 200 : 202).json({
    success: done,
    pending: !done,
    booking: updated,
    payment: snapshot,

    message: done
      ? 'Ride payment state verified.'
      : 'Internal transfer is processing. You can safely check again.'
  });
}

export async function paymentSnapshot(
  db,
  bookingId,
  payment
) {
  if (!payment) return null;

  const { data: legs, error } = await db
    .from('ride_payment_transfers')
    .select('*')
    .eq('booking_id', bookingId);

  if (error) {
    throw new HttpError(
      503,
      'Unable to read transfer receipts.'
    );
  }

  const confirmed = kind =>
    legs.some(
      leg =>
        leg.kind === kind &&
        leg.status === 'completed' &&
        leg.provider_id
    );

  const retained =
    payment.escrow_account === payment.fee_account;

  const holdConfirmed = confirmed('hold');

  const settled =
    payment.state === 'released' &&
    holdConfirmed &&
    confirmed('driver') &&
    (
      retained ||
      Number(payment.fee_minor) === 0 ||
      confirmed('fee')
    );

  return {
    state: payment.state,

    fare: Number(payment.fare_minor) / 100,
    driverEarnings: Number(payment.driver_minor) / 100,
    platformFee: Number(payment.fee_minor) / 100,

    platformFeeMode:
      retained ? 'retained' : 'transferred',

    payerAccountId: payment.payer_account,
    driverAccountId: payment.driver_account,
    escrowAccountId: payment.escrow_account,
    feeAccountId: payment.fee_account,

    holdConfirmed,
    settled,

    needsReview: legs.some(
      leg =>
        ['failed', 'review_required']
          .includes(leg.status)
    ),

    transfers: legs.map(leg => ({
      kind: leg.kind,
      status: leg.status,
      transferId: leg.provider_id,
      amount: Number(leg.amount_minor) / 100,
      sourceAccountId: leg.source_account,
      destinationAccountId: leg.destination_account
    }))
  };
}