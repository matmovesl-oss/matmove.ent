import {
  HttpError,
  assertAllowed,
  verifiedAccount,
  monime,
  monimeEnvironment
} from './wallet-security.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const accountId = /^fac-[A-Za-z0-9_-]+$/;

const safeErrors = {
  CASH_NOT_CONFIGURED: [503, 'Cash collection is not enabled. The restricted Monime holding account has not been configured.'],
  CASH_FEE_NOT_RESERVED: [409, 'The MatMove cash fee reserve is not verified. This ride cannot be accepted.'],
  CASH_COLLECTION_NOT_CONFIRMED: [409, 'Both rider and driver must confirm the physical cash handover before MatMove captures its fee.'],
  CASH_CAPTURE_NOT_VERIFIED: [409, 'The MatMove fee capture has not been verified. This ride is not complete.'],
  CASH_REFUND_NOT_VERIFIED: [409, 'The cash-ride fee refund has not been verified.'],
  CASH_REVIEW_STATE_INVALID: [409, 'This cash booking is held for manual review. No further transfer will be attempted.'],
  WALLET_FROZEN: [423, 'The rider SLE wallet is frozen. Contact MatMove support.'],
  WALLET_NOT_READY: [409, 'The rider SLE Monime wallet is not ready.'],
  ACCOUNT_LINK_CONFLICT: [409, 'The rider Monime account is linked to another wallet. Contact MatMove support.'],
  FORBIDDEN: [403, 'Your account is not authorized to perform this cash-ride action.'],
  INVALID_STATE: [409, 'This cash ride has changed. Refresh the booking before continuing.'],
  NOT_FOUND: [404, 'Cash ride booking or transfer was not found.']
};

function rpcErrorCode(error) {
  const message = String(error?.message || '');
  return /^(CASH_[A-Z0-9_]+|WALLET_[A-Z0-9_]+|ACCOUNT_[A-Z0-9_]+|FORBIDDEN|INVALID_STATE|NOT_FOUND):/.exec(message)?.[1] || null;
}

async function cashRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (!error) return data;

  const code = rpcErrorCode(error);
  console.error('MatMove cash ride RPC failed', {
    function: name,
    providerCode: typeof error.code === 'string' ? error.code : null,
    reasonCode: code
  });

  const [status, message] = safeErrors[code] || [503, 'Cash ride service is unavailable. Contact MatMove support; do not repeat a payment request.'];
  throw new HttpError(status, message, code || 'CASH_SERVICE_UNAVAILABLE');
}

function validAccountId(value) {
  return typeof value === 'string' && accountId.test(value);
}

async function readBooking(db, bookingId) {
  const { data, error } = await db
    .from('bookings')
    .select('id,rider_id,driver_id,service_type,status,payment_method,fare_amount,started_at,completed_at')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) throw new HttpError(503, 'Unable to verify the cash ride booking.');
  if (!data) throw new HttpError(404, 'Cash ride booking not found.');
  return data;
}

async function readPayment(db, bookingId) {
  const { data, error } = await db
    .from('matmove_cash_ride_payments')
    .select([
      'booking_id','rider_id','driver_id','fare_minor',
      'driver_cash_minor','matmove_fee_minor','currency','status',
      'driver_cash_confirmed_at','rider_cash_confirmed_at',
      'manual_resolution_at','version','created_at','updated_at'
    ].join(','))
    .eq('booking_id', bookingId)
    .maybeSingle();

  if (error) throw new HttpError(503, 'Unable to read the private cash payment record.');
  return data;
}

async function readLegs(db, bookingId) {
  const { data, error } = await db
    .from('matmove_cash_ride_legs')
    .select('leg_kind,amount_minor,currency,status,provider_transfer_id,verified_at,error_code,updated_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });

  if (error) throw new HttpError(503, 'Unable to read cash transfer status.');
  return Array.isArray(data) ? data : [];
}

function publicSnapshot(payment, legs) {
  if (!payment) return null;
  const byKind = Object.fromEntries(legs.map(leg => [leg.leg_kind, leg]));
  return {
    status: payment.status,
    currency: payment.currency,
    fare: Number(payment.fare_minor) / 100,
    driverCash: Number(payment.driver_cash_minor) / 100,
    matmoveFee: Number(payment.matmove_fee_minor) / 100,
    driverCashConfirmed: Boolean(payment.driver_cash_confirmed_at),
    riderCashConfirmed: Boolean(payment.rider_cash_confirmed_at),
    driverCashConfirmedAt: payment.driver_cash_confirmed_at,
    riderCashConfirmedAt: payment.rider_cash_confirmed_at,
    reserve: byKind.reserve ? {
      status: byKind.reserve.status,
      transferId: byKind.reserve.provider_transfer_id,
      verifiedAt: byKind.reserve.verified_at
    } : null,
    capture: byKind.capture ? {
      status: byKind.capture.status,
      transferId: byKind.capture.provider_transfer_id,
      verifiedAt: byKind.capture.verified_at
    } : null,
    refund: byKind.refund ? {
      status: byKind.refund.status,
      transferId: byKind.refund.provider_transfer_id,
      verifiedAt: byKind.refund.verified_at
    } : null,
    needsReview: payment.status === 'review_required' || legs.some(leg => leg.status === 'review_required')
  };
}

async function readSettings(db) {
  const { data, error } = await db
    .from('matmove_cash_ride_settings')
    .select('enabled,fee_hold_account_id,fee_revenue_account_id,provider_environment')
    .eq('singleton', true)
    .maybeSingle();

  if (error) throw new HttpError(503, 'Cash collection configuration is unavailable.');
  if (!data?.enabled ||
      !validAccountId(data.fee_hold_account_id) ||
      !validAccountId(data.fee_revenue_account_id) ||
      data.fee_hold_account_id === data.fee_revenue_account_id) {
    throw new HttpError(503, 'Cash collection is disabled until Monime confirms the dedicated restricted holding and fee accounts.', 'CASH_NOT_CONFIGURED');
  }

  const environment = monimeEnvironment();
  if (environment === 'unknown' || environment !== data.provider_environment) {
    throw new HttpError(503, 'The configured cash accounts do not match this deployment’s Monime Test/Live environment.', 'CASH_PROVIDER_ENVIRONMENT_MISMATCH');
  }

  return data;
}

function providerAccountBalance(account, accountIdExpected) {
  if (!account || account.id !== accountIdExpected || account.currency !== 'SLE') {
    throw new HttpError(409, 'Monime returned an account that does not match the configured SLE account.', 'CASH_ACCOUNT_MISMATCH');
  }
  const available = account.balance?.available;
  if (available && (available.currency !== 'SLE' || !Number.isSafeInteger(available.value) || available.value < 0)) {
    throw new HttpError(409, 'Monime returned an invalid available SLE balance.', 'CASH_BALANCE_INVALID');
  }
  return available?.value ?? null;
}

async function preflightAccounts(provider, leg, amountMinor) {
  const [source, destination] = await Promise.all([
    provider(`financial-accounts/${encodeURIComponent(leg.source_account_ref)}?withBalance=true`),
    provider(`financial-accounts/${encodeURIComponent(leg.destination_account_ref)}?withBalance=true`)
  ]);
  const available = providerAccountBalance(source, leg.source_account_ref);
  providerAccountBalance(destination, leg.destination_account_ref);

  if (available === null || available < amountMinor) {
    throw new HttpError(409, 'The SLE source account does not have enough available funds to reserve this fee.', 'CASH_INSUFFICIENT_AVAILABLE_BALANCE');
  }
}

function transferMatches(transfer, leg) {
  const metadata = transfer?.metadata;
  return typeof transfer?.id === 'string'
    && transfer.id.length > 0
    && (!leg.provider_transfer_id || transfer.id === leg.provider_transfer_id)
    && transfer.amount?.currency === 'SLE'
    && transfer.amount?.value === Number(leg.amount_minor)
    && transfer.sourceFinancialAccount?.id === leg.source_account_ref
    && transfer.destinationFinancialAccount?.id === leg.destination_account_ref
    && metadata?.bookingId === leg.booking_id
    && metadata?.leg === leg.leg_kind
    && metadata?.requestKey === leg.request_key
    && ['pending','processing','completed','failed'].includes(transfer.status);
}

async function recordLeg(db, bookingId, kind, transfer, status, errorCode = null) {
  const { data, error } = await db.rpc('matmove_cash_ride_record_leg', {
    p_booking_id: bookingId,
    p_leg_kind: kind,
    p_provider_transfer_id: transfer?.id || null,
    p_provider_status: status,
    p_verified_amount_minor: status === 'completed' ? transfer.amount.value : null,
    p_verified_currency: status === 'completed' ? transfer.amount.currency : null,
    p_verified_source_account: status === 'completed' ? transfer.sourceFinancialAccount.id : null,
    p_verified_destination_account: status === 'completed' ? transfer.destinationFinancialAccount.id : null,
    p_verified_reference: status === 'completed' ? transfer.metadata.requestKey : null,
    p_error_code: errorCode
  });

  if (error) {
    const code = rpcErrorCode(error);
    console.error('MatMove cash leg receipt could not be recorded', {
      function: 'matmove_cash_ride_record_leg',
      providerCode: typeof error.code === 'string' ? error.code : null,
      reasonCode: code
    });
    throw new HttpError(503, 'Cash transfer receipt could not be recorded. The operation is quarantined; do not retry a provider debit.', 'CASH_RECEIPT_NOT_RECORDED');
  }
  return data;
}

async function runCashLeg(db, bookingId, kind, provider = monime) {
  const { data: storedLeg, error: readError } = await db
    .from('matmove_cash_ride_legs')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('leg_kind', kind)
    .maybeSingle();

  if (readError || !storedLeg) {
    throw new HttpError(503, 'Cash transfer leg could not be loaded.');
  }

  if (['completed','failed','review_required'].includes(storedLeg.status)) return storedLeg;

  // Do all read-only account and balance checks before claiming the one-time POST.
  // Once claimed, no other request can obtain permission to create a provider debit.
  if (storedLeg.status === 'ready' && storedLeg.attempted_at === null) {
    await preflightAccounts(provider, storedLeg, Number(storedLeg.amount_minor));
  }

  const claim = await cashRpc(db, 'matmove_cash_ride_claim_leg', {
    p_booking_id: bookingId,
    p_leg_kind: kind
  });
  const leg = claim?.leg;

  if (!leg) throw new HttpError(503, 'Cash transfer claim could not be confirmed.');
  if (['completed','failed','review_required'].includes(leg.status)) return leg;
  if (!claim.canCreate && !claim.canLookup) return leg;

  let transfer;
  if (claim.canCreate) {
    try {
      transfer = await provider('internal-transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': leg.request_key },
        body: JSON.stringify({
          amount: { currency: 'SLE', value: Number(leg.amount_minor) },
          sourceFinancialAccount: { id: leg.source_account_ref },
          destinationFinancialAccount: { id: leg.destination_account_ref },
          description: `MatMove cash ride ${kind} ${bookingId}`,
          metadata: {
            bookingId,
            leg: kind,
            requestKey: leg.request_key
          }
        })
      });
    } catch {
      // An unknown POST outcome must never be posted a second time.
      await recordLeg(db, bookingId, kind, null, 'review_required', 'uncertain_post');
      return { status: 'review_required', error_code: 'uncertain_post' };
    }
  } else {
    try {
      transfer = await provider(`internal-transfers/${encodeURIComponent(leg.provider_transfer_id)}`);
    } catch (error) {
      // A failed GET does not authorize a second POST. Keep a known transfer pending.
      if (error?.status === 404) {
        await recordLeg(db, bookingId, kind, null, 'review_required', 'provider_transfer_missing');
        return { status: 'review_required', error_code: 'provider_transfer_missing' };
      }
      return leg;
    }
  }

  if (!transferMatches(transfer, leg)) {
    await recordLeg(db, bookingId, kind, transfer?.id ? { id: transfer.id } : null, 'review_required', 'provider_receipt_mismatch');
    return { status: 'review_required', error_code: 'provider_receipt_mismatch' };
  }

  return recordLeg(db, bookingId, kind, transfer, transfer.status, transfer.status === 'failed' ? 'provider_failed' : null);
}

async function prepareLeg(db, bookingId, kind, actorId) {
  return cashRpc(db, 'matmove_cash_ride_prepare_leg', {
    p_booking_id: bookingId,
    p_leg_kind: kind,
    p_actor_id: actorId
  });
}

async function cashStatus(db, bookingId) {
  const [payment, legs] = await Promise.all([
    readPayment(db, bookingId),
    readLegs(db, bookingId)
  ]);
  return publicSnapshot(payment, legs);
}

async function finishCashLeg(db, bookingId, kind, actorId, provider) {
  await readSettings(db);
  await prepareLeg(db, bookingId, kind, actorId);
  await runCashLeg(db, bookingId, kind, provider);
  const snapshot = await cashStatus(db, bookingId);
  return snapshot;
}

export async function cashRideAction(
  req,
  res,
  action,
  { provider = monime } = {}
) {
  const { db, user, profile, wallets } = req.matmove;
  const bookingId = req.body?.bookingId;

  if (!uuid.test(String(bookingId || ''))) {
    throw new HttpError(400, 'A valid booking ID is required.');
  }

  const booking = await readBooking(db, bookingId);
  if (booking.payment_method !== 'cash' || booking.service_type !== 'ride') {
    throw new HttpError(409, 'This booking is not a physical-cash ride.');
  }

  const payment = await readPayment(db, bookingId);
  if (!payment) throw new HttpError(409, 'Cash ride payment record is missing.');

  const isRider = booking.rider_id === user.id;
  const isDriver = booking.driver_id === user.id;

  if (action === 'status') {
    if (!isRider && !isDriver) throw new HttpError(403, 'This is another customer’s cash booking.');
    const snapshot = await cashStatus(db, bookingId);
    return res.status(200).json({
      success: true, pending: false, booking, payment: snapshot
    });
  }

  if (action === 'cash_reserve') {
    if (profile.role !== 'rider' || !isRider) {
      throw new HttpError(403, 'Only the booking rider can reserve the cash-ride MatMove fee.');
    }
    assertAllowed(profile, wallets, 'purchase');
    const sleWallets = wallets.filter(wallet => wallet.currency === 'SLE');
    if (sleWallets.length !== 1 || sleWallets[0].is_frozen || profile.is_wallet_frozen) {
      throw new HttpError(409, 'A unique unfrozen SLE wallet is required before reserving the cash-ride fee.');
    }
    // Verify that the provider account still belongs to this rider before
    // the database records a one-time reserve leg.
    await verifiedAccount(db, sleWallets[0]);
    const snapshot = await finishCashLeg(db, bookingId, 'reserve', user.id, provider);
    const updatedBooking = await readBooking(db, bookingId);
    const reserved = snapshot?.status === 'fee_reserved';
    return res.status(reserved ? 200 : 202).json({
      success: reserved,
      pending: !reserved,
      booking: updatedBooking,
      payment: snapshot,
      message: reserved
        ? 'The 15 percent MatMove fee reserve is verified. The ride is now visible to eligible drivers.'
        : 'The MatMove fee reserve is being verified. The booking remains hidden from drivers until confirmation.'
    });
  }

  if (action === 'accept') {
    if (profile.role !== 'driver' || isRider) {
      throw new HttpError(403, 'Only an approved driver can accept a cash ride.');
    }
    const result = await cashRpc(db, 'matmove_cash_ride_assign_driver', {
      p_booking_id: bookingId,
      p_driver_id: user.id
    });
    const snapshot = await cashStatus(db, bookingId);
    return res.status(200).json({
      success: true, pending: false, booking: result.booking, payment: snapshot,
      message: 'The fee reserve is verified. The cash ride is assigned to you.'
    });
  }

  if (action === 'start') {
    if (profile.role !== 'driver' || !isDriver) {
      throw new HttpError(403, 'Only the assigned driver can start this cash ride.');
    }
    const result = await cashRpc(db, 'matmove_cash_ride_start', {
      p_booking_id: bookingId,
      p_driver_id: user.id
    });
    const snapshot = await cashStatus(db, bookingId);
    return res.status(200).json({
      success: true, pending: false, booking: result.booking, payment: snapshot,
      message: 'The cash ride has started. Both parties must confirm the physical cash handover.'
    });
  }

  if (action === 'complete' || action === 'cash_confirm') {
    const actorType = action === 'complete' ? 'rider' : profile.role;
    if (actorType === 'rider' && (!isRider || profile.role !== 'rider')) {
      throw new HttpError(403, 'Only the booking rider can confirm cash handed to the driver.');
    }
    if (actorType === 'driver' && (!isDriver || profile.role !== 'driver')) {
      throw new HttpError(403, 'Only the assigned driver can confirm cash received.');
    }
    if (!['rider','driver'].includes(actorType)) {
      throw new HttpError(403, 'Rider or assigned driver confirmation is required.');
    }

    const confirmation = await cashRpc(db, 'matmove_cash_ride_confirm_collection', {
      p_booking_id: bookingId,
      p_actor_id: user.id,
      p_actor_type: actorType
    });

    let snapshot = await cashStatus(db, bookingId);
    if (confirmation.captureReady) {
      snapshot = await finishCashLeg(db, bookingId, 'capture', user.id, provider);
      const updatedBooking = await readBooking(db, bookingId);
      const settled = snapshot?.status === 'settled';
      return res.status(settled ? 200 : 202).json({
        success: settled,
        pending: !settled,
        booking: updatedBooking,
        payment: snapshot,
        message: settled
          ? 'Both cash confirmations and the MatMove fee capture are verified.'
          : 'Cash confirmations are recorded. MatMove fee capture is still being verified; do not repeat the cash payment.'
      });
    }

    return res.status(200).json({
      success: true,
      pending: false,
      booking,
      payment: snapshot,
      message: actorType === 'driver'
        ? 'Your cash-received confirmation is recorded. The rider must also confirm.'
        : 'Your cash-handover confirmation is recorded. The driver must also confirm.'
    });
  }

  if (action === 'cancel') {
    const actorType = profile.role === 'driver' ? 'driver' : profile.role === 'rider' ? 'rider' : null;
    if (!actorType || (actorType === 'rider' && !isRider) || (actorType === 'driver' && !isDriver)) {
      throw new HttpError(403, 'Only the rider or assigned driver can cancel this cash ride.');
    }

    const result = await cashRpc(db, 'matmove_cash_ride_cancel', {
      p_booking_id: bookingId,
      p_actor_id: user.id,
      p_actor_type: actorType
    });

    if (result.refundRequired) {
      const snapshot = await finishCashLeg(db, bookingId, 'refund', user.id, provider);
      const updatedBooking = await readBooking(db, bookingId);
      const refunded = snapshot?.status === 'refunded';
      return res.status(refunded ? 200 : 202).json({
        success: refunded,
        pending: !refunded,
        booking: updatedBooking,
        payment: snapshot,
        message: refunded ? 'The reserved fee has been returned to the rider.' : 'Fee refund is being verified. Do not request another transfer.'
      });
    }

    const updatedBooking = await readBooking(db, bookingId);
    return res.status(result.reviewRequired ? 202 : 200).json({
      success: result.cancelled === true,
      pending: result.reviewRequired === true,
      booking: updatedBooking,
      payment: await cashStatus(db, bookingId),
      message: result.reviewRequired
        ? 'The cash payment needs manual review. No further provider transfer will be attempted.'
        : 'Cash ride cancellation is recorded.'
    });
  }

  throw new HttpError(400, 'Choose a valid cash-ride action.');
}
