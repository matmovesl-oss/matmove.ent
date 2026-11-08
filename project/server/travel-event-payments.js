import { randomBytes } from 'node:crypto';
import {
  HttpError,
  monime,
  protectedWallet,
  toMinorUnits,
} from './wallet-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^fac-[A-Za-z0-9_-]+$/;
const TRANSFER_ID = /^trn-[A-Za-z0-9_-]+$/;
const TRANSFER_STATUSES = new Set(['pending', 'processing', 'failed', 'completed']);
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

function fail(message, status = 503, code) {
  throw new HttpError(status, message, code);
}

function parseTarget(body = {}) {
  const target = String(body.target || '').trim().toLowerCase();
  if (!['travel', 'event'].includes(target)) fail('Choose a supported MatMove purchase.', 400);
  return target;
}

function destinationFor(target, env = process.env) {
  const key = target === 'travel' ? 'MONIME_TRAVEL_ACCOUNT_ID' : 'MONIME_EVENT_ACCOUNT_ID';
  const value = String(env[key] || '').trim();
  if (!ACCOUNT_ID.test(value)) fail(`Configure ${key} with the correct Monime financial account ID.`);
  return value;
}

async function getPurchaseDetails(db, userId, body, target) {
  if (target === 'travel') {
    const bookingId = String(body.bookingId || '');
    if (!UUID.test(bookingId)) fail('A valid travel booking is required.', 400);

    const { data: booking, error } = await db
      .from('travel_bookings')
      .select('id,user_id,status,is_paid,passengers_count,fare_amount,passenger_phone')
      .eq('id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) fail('Travel booking could not be verified.');
    if (!booking) fail('Travel booking not found.', 404);
    if (booking.is_paid) fail('This travel booking is already paid.', 409);
    if (booking.status !== 'approved') fail('Dispatch must approve this travel booking before payment.', 409);

    const quantity = Number(booking.passengers_count || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
      fail('The saved passenger count is invalid. Contact MatMove support.', 409);
    }

    const amountMinor = toMinorUnits(booking.fare_amount);
    if (amountMinor % quantity !== 0) {
      fail('The saved travel fare cannot be reconciled per seat. Contact MatMove support.', 409);
    }

    return {
      target,
      bookingId: booking.id,
      eventId: null,
      quantity,
      userPhone: String(booking.passenger_phone || ''),
      amountMinor,
      unitAmountMinor: amountMinor / quantity,
    };
  }

  const eventId = String(body.eventId || '');
  const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!UUID.test(eventId)) fail('A valid event is required.', 400);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
    fail('Choose between 1 and 3 tickets.', 400);
  }

  const { data: event, error } = await db
    .from('platform_events')
    .select('id,ticket_price,is_active')
    .eq('id', eventId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) fail('Event details could not be verified.');
  if (!event) fail('This event is no longer available.', 404);

  const profileResult = await db
    .from('profiles')
    .select('phone,phone_number')
    .eq('id', userId)
    .maybeSingle();

  if (profileResult.error) fail('Your contact details could not be verified.');
  const userPhone = String(body.userPhone || profileResult.data?.phone || profileResult.data?.phone_number || '').trim();
  const unitAmountMinor = toMinorUnits(event.ticket_price);

  return {
    target,
    bookingId: null,
    eventId: event.id,
    quantity,
    userPhone,
    amountMinor: unitAmountMinor * quantity,
    unitAmountMinor,
  };
}

function assertSameRequest(payment, userId, target, body) {
  if (
    !payment ||
    payment.user_id !== userId ||
    payment.purchase_type !== target ||
    payment.currency !== 'SLE'
  ) {
    fail('This payment request key is already linked to a different purchase. Start a fresh request.', 409, 'IDEMPOTENCY_KEY_REUSE');
  }

  if (target === 'travel') {
    if (String(body.bookingId || '') !== String(payment.booking_id || '')) {
      fail('This payment request key is already linked to a different booking. Start a fresh request.', 409, 'IDEMPOTENCY_KEY_REUSE');
    }
  } else {
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (
      String(body.eventId || '') !== String(payment.event_id || '') ||
      quantity !== Number(payment.quantity)
    ) {
      fail('This payment request key is already linked to different tickets. Start a fresh request.', 409, 'IDEMPOTENCY_KEY_REUSE');
    }
  }

  if (
    !ACCOUNT_ID.test(String(payment.source_account_id || '')) ||
    !ACCOUNT_ID.test(String(payment.destination_account_id || '')) ||
    !Number.isSafeInteger(Number(payment.amount_minor)) ||
    Number(payment.amount_minor) <= 0 ||
    !Number.isSafeInteger(Number(payment.unit_amount_minor)) ||
    Number(payment.unit_amount_minor) <= 0
  ) {
    fail('The saved payment request is incomplete and requires MatMove review.', 503, 'PAYMENT_REVIEW_REQUIRED');
  }
}

async function readPaymentByKey(db, requestKey) {
  const { data, error } = await db
    .from('matmove_purchase_payments')
    .select('*')
    .eq('request_key', requestKey)
    .maybeSingle();

  if (error) fail('MatMove purchase payment storage is not ready.');
  return data;
}

async function createPaymentRow(db, requestKey, userId, details, sourceAccountId, destinationAccountId) {
  const insert = await db
    .from('matmove_purchase_payments')
    .insert({
      request_key: requestKey,
      user_id: userId,
      purchase_type: details.target,
      booking_id: details.bookingId,
      event_id: details.eventId,
      quantity: details.quantity,
      user_phone: details.userPhone,
      amount_minor: details.amountMinor,
      unit_amount_minor: details.unitAmountMinor,
      currency: 'SLE',
      source_account_id: sourceAccountId,
      destination_account_id: destinationAccountId,
      state: 'initiating',
      provider_status: 'initiating',
    })
    .select('*')
    .single();

  if (!insert.error && insert.data) return insert.data;

  if (insert.error?.code === '23505') {
    const existing = await readPaymentByKey(db, requestKey);
    if (existing) return existing;
  }

  fail('MatMove could not record the payment request. Do not submit a different payment.', 503);
}

async function updatePayment(db, payment, patch) {
  const { data, error } = await db
    .from('matmove_purchase_payments')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)
    .eq('user_id', payment.user_id)
    .select('id,state,provider_status,provider_transfer_id,fulfilled_at,failure_detail')
    .maybeSingle();

  if (error || !data) {
    fail('The payment result could not be safely saved. Do not submit a new payment; retry this same request or contact MatMove support.', 503, 'PAYMENT_STATE_UNCONFIRMED');
  }

  return { ...payment, ...data, ...patch };
}

function pendingResponse(res, payment, message, providerStatus) {
  return res.status(202).json({
    success: false,
    pending: true,
    status: providerStatus || payment?.provider_status || 'review_required',
    paymentId: payment?.id || null,
    error: message || 'Payment status is still being verified. Do not pay again. Retry this same request to check the original transfer.',
  });
}

function stableTransferBody(payment) {
  const travel = payment.purchase_type === 'travel';
  const reference = travel ? payment.booking_id : payment.event_id;
  const metadata = {
    matmovePurchasePaymentId: String(payment.id),
    matmoveUserId: String(payment.user_id),
    matmovePurchaseType: String(payment.purchase_type),
    ...(travel ? { matmoveBookingId: String(reference) } : { matmoveEventId: String(reference) }),
  };

  return {
    amount: { currency: 'SLE', value: Number(payment.amount_minor) },
    sourceFinancialAccount: { id: payment.source_account_id },
    destinationFinancialAccount: { id: payment.destination_account_id },
    description: `MatMove ${travel ? 'travel' : 'event'} payment ${reference}`,
    metadata,
  };
}

function transferMatchesPayment(transfer, payment) {
  const amount = transfer?.amount;
  const id = String(transfer?.id || '');
  return (
    TRANSFER_ID.test(id) &&
    (!payment.provider_transfer_id || id === payment.provider_transfer_id) &&
    amount?.currency === 'SLE' &&
    Number(amount?.value) === Number(payment.amount_minor) &&
    transfer?.sourceFinancialAccount?.id === payment.source_account_id &&
    transfer?.destinationFinancialAccount?.id === payment.destination_account_id
  );
}

async function getTravelEntitlement(db, payment) {
  const update = await db
    .from('travel_bookings')
    .update({
      is_paid: true,
      payment_id: payment.id,
      status: 'approved',
    })
    .eq('id', payment.booking_id)
    .eq('user_id', payment.user_id)
    .eq('status', 'approved')
    .eq('is_paid', false)
    .is('payment_id', null)
    .select('id,user_id,status,is_paid,payment_id')
    .maybeSingle();

  if (update.error) return { fulfilled: false, reason: 'Travel booking payment confirmation could not be saved.' };
  if (
    update.data?.id === payment.booking_id &&
    update.data.user_id === payment.user_id &&
    update.data.is_paid === true &&
    update.data.payment_id === payment.id
  ) {
    return { fulfilled: true, ticketCode: null };
  }

  const existing = await db
    .from('travel_bookings')
    .select('id,user_id,status,is_paid,payment_id')
    .eq('id', payment.booking_id)
    .eq('user_id', payment.user_id)
    .maybeSingle();

  if (existing.error) return { fulfilled: false, reason: 'Travel booking payment state could not be verified.' };
  if (
    existing.data?.id === payment.booking_id &&
    existing.data.user_id === payment.user_id &&
    existing.data.is_paid === true &&
    existing.data.payment_id === payment.id
  ) {
    return { fulfilled: true, ticketCode: null };
  }

  return { fulfilled: false, reason: 'Monime completed the transfer, but the booking is not yet confirmed as paid.' };
}

async function getEventEntitlement(db, payment) {
  if (!payment.event_id) {
    return { fulfilled: false, reason: 'The event record for this completed payment is unavailable.' };
  }

  const verifyExisting = async () => {
    const found = await db
      .from('event_tickets')
      .select('id,event_id,user_id,ticket_code,tickets_count,amount_paid,payment_id')
      .eq('payment_id', payment.id)
      .maybeSingle();

    if (found.error) return { error: true };
    if (!found.data) return { ticket: null };

    const valid =
      found.data.event_id === payment.event_id &&
      found.data.user_id === payment.user_id &&
      found.data.payment_id === payment.id &&
      Number(found.data.tickets_count) === Number(payment.quantity) &&
      Math.round(Number(found.data.amount_paid) * 100) === Number(payment.amount_minor);

    return valid ? { ticket: found.data } : { error: true };
  };

  const before = await verifyExisting();
  if (before.error) return { fulfilled: false, reason: 'The existing event ticket could not be verified.' };
  if (before.ticket) return { fulfilled: true, ticketCode: before.ticket.ticket_code };

  const ticketCode = `TKT-${randomBytes(6).toString('hex').toUpperCase()}`;
  const insert = await db
    .from('event_tickets')
    .insert({
      event_id: payment.event_id,
      user_id: payment.user_id,
      user_phone: payment.user_phone || 'Customer',
      ticket_code: ticketCode,
      tickets_count: payment.quantity,
      amount_paid: Number(payment.amount_minor) / 100,
      status: 'confirmed',
      payment_id: payment.id,
    })
    .select('id,event_id,user_id,ticket_code,tickets_count,amount_paid,payment_id')
    .single();

  if (!insert.error && insert.data) {
    return { fulfilled: true, ticketCode: insert.data.ticket_code };
  }

  const after = await verifyExisting();
  if (after.ticket) return { fulfilled: true, ticketCode: after.ticket.ticket_code };

  return {
    fulfilled: false,
    reason: after.error
      ? 'The event ticket could not be verified after payment.'
      : 'Monime completed the transfer, but ticket creation is still pending.',
  };
}

async function fulfillPurchase(db, payment) {
  return payment.purchase_type === 'travel'
    ? getTravelEntitlement(db, payment)
    : getEventEntitlement(db, payment);
}

async function markReview(db, payment, reason, providerStatus = 'unknown', transferId = null) {
  const patch = {
    state: 'review_required',
    provider_status: providerStatus,
    failure_detail: String(reason || 'Transfer or fulfillment requires reconciliation.').slice(0, 500),
    ...(transferId ? { provider_transfer_id: transferId } : {}),
  };

  try {
    return await updatePayment(db, payment, patch);
  } catch {
    return { ...payment, ...patch };
  }
}

async function completePurchase(res, db, payment, transfer) {
  const verifiedTransfer = transfer?.result || transfer;
  if (!transferMatchesPayment(verifiedTransfer, payment)) {
    const reviewed = await markReview(
      db,
      payment,
      'Monime transfer receipt does not match the saved amount or account references.',
      String(verifiedTransfer?.status || 'unknown'),
      TRANSFER_ID.test(String(verifiedTransfer?.id || '')) ? verifiedTransfer.id : null
    );
    return pendingResponse(res, reviewed, 'The provider receipt is being checked by MatMove. Do not pay again.', reviewed.provider_status);
  }

  const providerStatus = String(verifiedTransfer.status || '').toLowerCase();
  if (!TRANSFER_STATUSES.has(providerStatus)) {
    const reviewed = await markReview(db, payment, 'Monime returned an unknown transfer status.', 'unknown', verifiedTransfer.id);
    return pendingResponse(res, reviewed, 'The transfer status is not yet confirmed. Do not pay again; retry this same request to check the original transfer.', 'unknown');
  }

  if (providerStatus === 'failed') {
    const failed = await updatePayment(db, payment, {
      provider_transfer_id: verifiedTransfer.id,
      provider_status: 'failed',
      state: 'failed',
      failure_detail: String(verifiedTransfer.failureDetail?.message || 'Monime reported that the transfer failed.').slice(0, 500),
      fulfilled_at: null,
    });
    return res.status(400).json({
      success: false,
      status: 'failed',
      paymentId: failed.id,
      error: 'Monime reported that this transfer failed. Refresh your wallet balance before starting a new payment request.',
    });
  }

  if (providerStatus === 'pending' || providerStatus === 'processing') {
    const waiting = await updatePayment(db, payment, {
      provider_transfer_id: verifiedTransfer.id,
      provider_status: providerStatus,
      state: providerStatus,
      failure_detail: null,
      fulfilled_at: null,
    });
    return pendingResponse(
      res,
      waiting,
      'Monime is still processing this transfer. Do not pay again. Select the payment button again later to check the same transfer.',
      providerStatus
    );
  }

  const recorded = await updatePayment(db, payment, {
    provider_transfer_id: verifiedTransfer.id,
    provider_status: 'completed',
    state: 'processing',
    failure_detail: null,
    fulfilled_at: null,
  });

  let entitlement;
  try {
    entitlement = await fulfillPurchase(db, recorded);
  } catch {
    entitlement = { fulfilled: false, reason: 'Purchase fulfillment could not be verified.' };
  }

  if (!entitlement.fulfilled) {
    const reviewed = await markReview(db, recorded, entitlement.reason, 'completed', verifiedTransfer.id);
    return pendingResponse(
      res,
      reviewed,
      'Monime completed the transfer, but MatMove has not yet confirmed the booking or ticket. Do not pay again; retry this same request or contact support.',
      'completed'
    );
  }

  let completed;
  try {
    completed = await updatePayment(db, recorded, {
      provider_transfer_id: verifiedTransfer.id,
      provider_status: 'completed',
      state: 'completed',
      failure_detail: null,
      fulfilled_at: recorded.fulfilled_at || new Date().toISOString(),
    });
  } catch {
    const reviewed = await markReview(db, recorded, 'Purchase fulfillment succeeded but the payment completion receipt could not be saved.', 'completed', verifiedTransfer.id);
    return pendingResponse(res, reviewed, 'The purchase is being reconciled. Do not pay again; retry this same request.', 'completed');
  }

  return res.status(200).json({
    success: true,
    ticketCode: entitlement.ticketCode || verifiedTransfer.id,
    paymentId: completed.id,
    fulfilled: true,
    data: verifiedTransfer,
  });
}

async function callProviderForPayment(provider, payment) {
  if (payment.provider_transfer_id) {
    if (!TRANSFER_ID.test(String(payment.provider_transfer_id))) {
      fail('The saved Monime transfer reference is invalid and requires review.', 503, 'PAYMENT_REVIEW_REQUIRED');
    }
    return provider(`internal-transfers/${encodeURIComponent(payment.provider_transfer_id)}`);
  }

  const createdAt = Date.parse(payment.created_at || '');
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > IDEMPOTENCY_WINDOW_MS) {
    fail('This payment request is too old to retry safely without a Monime transfer reference. Contact MatMove support before paying again.', 409, 'PAYMENT_REVIEW_REQUIRED');
  }

  return provider('internal-transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': payment.request_key },
    body: JSON.stringify(stableTransferBody(payment)),
  });
}

export async function processPurchase(req, res, { provider = monime, env = process.env } = {}) {
  const { db, user, accountId, idempotencyKey, account } = req.matmove;
  const body = req.body || {};
  const target = parseTarget(body);

  if (account?.currency !== 'SLE') fail('Select your SLE wallet to pay for travel or events.', 409);

  let payment = await readPaymentByKey(db, idempotencyKey);
  if (payment) {
    assertSameRequest(payment, user.id, target, body);
  } else {
    const details = await getPurchaseDetails(db, user.id, body, target);
    const destinationAccountId = destinationFor(details.target, env);
    if (destinationAccountId === accountId) fail('The collection account cannot be the customer source wallet.', 409);

    payment = await createPaymentRow(db, idempotencyKey, user.id, details, accountId, destinationAccountId);
    assertSameRequest(payment, user.id, target, body);
  }

  if (payment.state === 'failed' && String(payment.provider_status).toLowerCase() === 'failed') {
    return res.status(400).json({
      success: false,
      status: 'failed',
      paymentId: payment.id,
      error: 'This payment request has already been confirmed as failed. Refresh your wallet and start a fresh purchase request.',
    });
  }

  let transfer;
  try {
    transfer = await callProviderForPayment(provider, payment);
  } catch (error) {
    const isTransferLookup = Boolean(payment.provider_transfer_id);
    const definitiveClientFailure =
      !isTransferLookup &&
      Number(error?.status) >= 400 &&
      Number(error?.status) < 500 &&
      Number(error?.status) !== 409;

    if (definitiveClientFailure) {
      const failed = await updatePayment(db, payment, {
        state: 'failed',
        provider_status: 'failed',
        failure_detail: String(error.message || 'Monime rejected the transfer.').slice(0, 500),
        fulfilled_at: null,
      });
      return res.status(400).json({
        success: false,
        status: 'failed',
        paymentId: failed.id,
        error: error.message || 'Monime rejected the transfer.',
      });
    }

    const reviewed = await markReview(
      db,
      payment,
      error.message || 'The transfer response was not confirmed.',
      payment.provider_status || 'unknown',
      payment.provider_transfer_id || null
    );
    return pendingResponse(
      res,
      reviewed,
      'MatMove could not confirm the original transfer response. Do not pay again. Retry this same request so MatMove can safely reconcile it.',
      reviewed.provider_status
    );
  }

  return completePurchase(res, db, payment, transfer);
}

export const purchaseTransfer = protectedWallet('transfer', processPurchase);
