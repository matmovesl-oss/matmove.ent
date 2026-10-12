import { HttpError, assertAllowed, verifiedAccount, monime } from './wallet-security.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const accountId = /^fac-[A-Za-z0-9_-]+$/;

export async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const known = /^(FORBIDDEN|NOT_FOUND|INVALID_STATE|PAYMENT_PENDING|LEGACY_PAYMENT|INVALID_FARE|ACCOUNT_CHANGED):/;
    throw new HttpError(known.test(error.message) ? 409 : 503,
      known.test(error.message) ? error.message.replace(/^[A-Z_]+: /, '') : 'Ride payment storage is unavailable. Please try again.');
  }
  return data;
}

async function readBooking(db, id) {
  const { data, error } = await db.from('bookings').select('*').eq('id', id).single();
  if (error || !data) throw new HttpError(404, 'Booking not found.');
  return data;
}

async function readPayment(db, id) {
  const { data, error } = await db.from('ride_payments').select('*').eq('booking_id', id).maybeSingle();
  if (error) throw new HttpError(503, 'Ride payment storage is unavailable. Apply the ride payment migration first.');
  return data;
}

async function customerAccount(db, id, roles, verifyAccount = verifiedAccount) {
  const [p, w] = await Promise.all([
    db.from('profiles').select('*').eq('id', id).single(),
    db.from('wallets').select('*').eq('user_id', id),
  ]);
  if (p.error || w.error || !p.data) throw new HttpError(503, 'Unable to verify ride wallet permissions.');
  if (!roles.includes(p.data.role)) throw new HttpError(403, 'This account cannot perform that ride action.');
  assertAllowed(p.data, w.data || [], 'transfer');
  const wallets = (w.data || []).filter(wallet => wallet.currency === 'SLE');
  if (wallets.length !== 1) throw new HttpError(409, 'A unique SLE wallet is required for this ride.');
  return verifyAccount(db, wallets[0]);
}

async function platformAccounts(provider) {
  const escrow = process.env.MONIME_ESCROW_ACCOUNT_ID;
  const revenue = process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID;
  if (!accountId.test(escrow || '') || !accountId.test(revenue || '')) {
    throw new HttpError(503, 'Configure the SLE escrow and platform fee financial accounts.');
  }
  const results = await Promise.all([escrow, revenue].map(id => provider(`financial-accounts/${encodeURIComponent(id)}?withBalance=true`)));
  if (results.some((r, i) => r.id !== [escrow, revenue][i] || r.currency !== 'SLE')) {
    throw new HttpError(409, 'Both platform financial accounts must use SLE.');
  }
  return { escrow, revenue };
}

// A database claim permits one POST per leg, even across concurrent requests.
// Known IDs are polled with GET. Ambiguous outcomes require reconciliation,
// never another debit (the provider's key retention is not assumed unlimited).
export async function runLeg(db, bookingId, kind, provider = monime) {
  const leg = await rpc(db, 'claim_ride_transfer', { p_booking_id: bookingId, p_kind: kind });
  if (!leg || ['completed', 'failed', 'review_required'].includes(leg.status)) return leg;
  if (!leg.can_create && !leg.provider_id) return leg;
  let transfer;
  try {
    transfer = leg.provider_id
      ? await provider(`internal-transfers/${encodeURIComponent(leg.provider_id)}`)
      : await provider('internal-transfers', {
          method: 'POST', headers: { 'Idempotency-Key': leg.request_key },
          body: JSON.stringify({
            amount: { currency: 'SLE', value: Number(leg.amount_minor) },
            sourceFinancialAccount: { id: leg.source_account },
            destinationFinancialAccount: { id: leg.destination_account },
            description: `MatMove ${kind} for booking ${bookingId}`,
            metadata: { bookingId, leg: kind, requestKey: leg.request_key },
          }),
        });
  } catch (error) {
    if (leg.can_create) await rpc(db, 'record_ride_transfer', {
      p_booking_id: bookingId, p_kind: kind, p_provider_id: null,
      p_status: 'review_required', p_error: 'Provider response uncertain; reconcile before retrying.',
    });
    throw error;
  }
  const matches = typeof transfer?.id === 'string' && transfer.id.length > 0 && (!leg.provider_id || transfer.id === leg.provider_id) &&
    transfer.amount?.currency === 'SLE' && transfer.amount?.value === Number(leg.amount_minor) &&
    transfer.sourceFinancialAccount?.id === leg.source_account &&
    transfer.destinationFinancialAccount?.id === leg.destination_account &&
    ['pending', 'processing', 'completed', 'failed'].includes(transfer.status);
  if (!matches) {
    await rpc(db, 'record_ride_transfer', {
      p_booking_id: bookingId, p_kind: kind, p_provider_id: leg.provider_id || null,
      p_status: 'review_required', p_error: 'Provider response does not match the recorded transfer.',
    });
    throw new HttpError(502, 'Transfer verification needs support review. No further debit will be attempted.');
  }
  return rpc(db, 'record_ride_transfer', {
    p_booking_id: bookingId, p_kind: kind, p_provider_id: transfer.id,
    p_status: transfer.status, p_error: transfer.failureDetail?.message || null,
  });
}

export async function reconcileRide(db, bookingId, provider = monime) {
  const payment = await readPayment(db, bookingId);
  if (!payment) return null;
  const releaseKinds = payment.escrow_account === payment.fee_account ? ['driver'] : ['driver', 'fee'];
  const kinds = { funding: ['hold'], releasing: releaseKinds, refunding: ['refund'] }[payment.state] || [];
  for (const kind of kinds) {
    const leg = await runLeg(db, bookingId, kind, provider);
    if (leg?.status !== 'completed') break;
  }
  await rpc(db, 'finalize_ride_payment', { p_booking_id: bookingId });
  return readPayment(db, bookingId);
}

export async function rideAction(req, res, action, { provider = monime, verifyAccount = verifiedAccount } = {}) {
  const { db, user, profile } = req.matmove;
  const bookingId = req.body?.bookingId;
  if (!uuid.test(String(bookingId || ''))) throw new HttpError(400, 'A valid booking ID is required.');
  const booking = await readBooking(db, bookingId);
  const payment = await readPayment(db, bookingId);
  if (action === 'accept') {
    if (profile.role !== 'driver') throw new HttpError(403, 'Only an approved driver can accept a ride.');
    if (booking.driver_id && booking.driver_id !== user.id) throw new HttpError(409, 'This ride has another driver.');
    if (booking.rider_id === user.id) throw new HttpError(403, 'You cannot drive your own booking.');
    if (!payment) {
      const [payer, driver, platform] = await Promise.all([
        customerAccount(db, booking.rider_id, ['rider', 'merchant'], verifyAccount),
        customerAccount(db, user.id, ['driver'], verifyAccount), platformAccounts(provider),
      ]);
      if (payer.id === driver.id || [platform.escrow, platform.revenue].includes(payer.id) ||
          [platform.escrow, platform.revenue].includes(driver.id)) {
        throw new HttpError(409, 'Customer and driver wallets must be separate from each other and from platform accounts.');
      }
      await rpc(db, 'prepare_ride_payment', {
        p_booking_id: bookingId, p_actor_id: user.id, p_action: action,
        p_payer_account: payer.id, p_driver_account: driver.id,
        p_escrow_account: platform.escrow, p_fee_account: platform.revenue,
      });
    } else {
      if (payment.driver_id !== user.id) throw new HttpError(403, 'This payment has another driver.');
      await rpc(db, 'prepare_ride_payment', { p_booking_id: bookingId, p_actor_id: user.id, p_action: action });
    }
  } else {
    if (action === 'start' && (profile.role !== 'driver' || booking.driver_id !== user.id)) {
      throw new HttpError(403, 'Only the assigned driver can start this ride.');
    }
    if (['complete', 'cancel'].includes(action) && booking.rider_id !== user.id) {
      throw new HttpError(403, 'Only the customer who booked this trip can confirm or cancel it.');
    }
    await rpc(db, 'prepare_ride_payment', { p_booking_id: bookingId, p_actor_id: user.id, p_action: action });
  }
  const result = await reconcileRide(db, bookingId, provider);
  const updated = await readBooking(db, bookingId);
  const expected = { accept: ['accepted', 'in_progress', 'completed'], start: ['in_progress'], complete: ['completed'], cancel: ['cancelled'] }[action];
  const done = expected.includes(updated.status);
  if (!done && result) {
    const legs = await db.from('ride_payment_transfers').select('status').eq('booking_id', bookingId);
    if (legs.error) throw new HttpError(503, 'Unable to read transfer status.');
    if (legs.data.some(leg => ['failed', 'review_required'].includes(leg.status))) {
      throw new HttpError(409, 'Ride payment needs support review. Do not make another payment.');
    }
  }
  return res.status(done ? 200 : 202).json({
    success: done, pending: !done, booking: updated,
    payment: result ? {
      state: result.state, fare: Number(result.fare_minor) / 100,
      driverEarnings: Number(result.driver_minor) / 100, platformFee: Number(result.fee_minor) / 100,
      platformFeeMode: result.escrow_account === result.fee_account ? 'retained' : 'transferred',
    } : null,
    message: done ? 'Ride updated.' : 'Internal transfer is processing. You can safely check again.',
  });
}