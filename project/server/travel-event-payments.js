import {
  HttpError,
  monime,
  protectedWallet,
  toMinorUnits,
} from './wallet-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^fac-[A-Za-z0-9_-]+$/;
const ACTIVE_STATES = ['initiating', 'pending', 'processing', 'review_required'];

function fail(message, status = 503) {
  throw new HttpError(status, message);
}

async function getPurchaseDetails(db, userId, body) {
  const target = String(body.target || '').toLowerCase();
  if (target === 'travel') {
    const bookingId = String(body.bookingId || '');
    if (!UUID.test(bookingId)) fail('A valid travel booking is required.', 400);
    const { data: booking, error } = await db
      .from('travel_bookings')
      .select('id,user_id,status,is_paid,passengers_count,fare_amount,passenger_name,departure_date')
      .eq('id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) fail('Travel booking could not be verified.');
    if (!booking) fail('Travel booking not found.', 404);
    if (booking.is_paid) fail('This travel booking is already paid.', 409);
    if (booking.status !== 'approved') fail('Dispatch must approve this travel booking before payment.', 409);
    const ftnToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Freetown', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    if (!booking.departure_date || String(booking.departure_date) < ftnToday) fail('This departure date has passed. Contact MatMove support before paying.', 409);
    const quantity = Math.max(1, Number(booking.passengers_count) || 1);
    const amountMinor = toMinorUnits(String(booking.fare_amount));
    return {
      target,
      bookingId,
      eventId: null,
      quantity,
      userPhone: null,
      amountMinor,
      unitAmountMinor: Math.round(amountMinor / quantity),
      description: `MatMove Freetown-Accra travel booking ${booking.id}`,
    };
  }

  if (target === 'event') {
    const eventId = String(body.eventId || '');
    const quantity = Number(body.quantity);
    if (!UUID.test(eventId)) fail('A valid event is required.', 400);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) fail('Choose between 1 and 3 tickets.', 400);
    const { data: event, error } = await db
      .from('platform_events')
      .select('id,title,ticket_price,is_active')
      .eq('id', eventId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) fail('Event details could not be verified.');
    if (!event) fail('This event is no longer available.', 404);
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) fail('Your contact number could not be verified.');
    const unitMinor = toMinorUnits(String(event.ticket_price));
    const { data: authUser, error: authUserError } = await db.auth.admin.getUserById(userId);
    if (authUserError) fail('Your account contact number could not be verified.');
    const userPhone = String(profile?.phone || profile?.phone_number || authUser?.user?.phone || authUser?.user?.user_metadata?.phone || '').trim();
    if (!userPhone) fail('Add a valid phone number to your MatMove profile before purchasing event tickets.', 409);
    return {
      target,
      bookingId: null,
      eventId,
      quantity,
      userPhone,
      amountMinor: unitMinor * quantity,
      unitAmountMinor: unitMinor,
      description: `MatMove event tickets: ${String(event.title || 'Event').slice(0, 80)} x${quantity}`,
    };
  }

  fail('Choose a supported MatMove purchase.', 400);
}

function destinationFor(target) {
  const key = target === 'travel' ? 'MONIME_TRAVEL_ACCOUNT_ID' : 'MONIME_EVENT_ACCOUNT_ID';
  const value = String(process.env[key] || '').trim();
  if (!ACCOUNT_ID.test(value)) fail(`Configure ${key} with the correct Monime financial account ID.`);
  return value;
}

async function getPaymentRow(db, requestKey, userId, details, sourceAccountId, destinationAccountId) {
  const byKey = await db.from('matmove_purchase_payments').select('*').eq('request_key', requestKey).maybeSingle();
  if (byKey.error) fail('MatMove purchase payment storage is not ready. Apply MATMOVE_TRAVEL_EVENTS_PAYMENT_REPAIR_02.sql.');

  let payment = byKey.data;
  if (!payment) {
    let activeQuery = db.from('matmove_purchase_payments')
      .select('*')
      .eq('user_id', userId)
      .eq('purchase_type', details.target)
      .in('state', ACTIVE_STATES)
      .order('created_at', { ascending: false })
      .limit(1);
    activeQuery = details.target === 'travel'
      ? activeQuery.eq('booking_id', details.bookingId)
      : activeQuery.eq('event_id', details.eventId);
    const active = await activeQuery.maybeSingle();
    if (active.error) fail('MatMove payment status could not be loaded.');
    payment = active.data;
  }

  if (payment) {
    const matches = payment.user_id === userId
      && payment.purchase_type === details.target
      && payment.booking_id === details.bookingId
      && payment.event_id === details.eventId
      && Number(payment.quantity) === details.quantity
      && Number(payment.amount_minor) === details.amountMinor
      && Number(payment.unit_amount_minor) === details.unitAmountMinor
      && payment.currency === 'SLE'
      && payment.source_account_id === sourceAccountId
      && payment.destination_account_id === destinationAccountId;
    if (!matches) fail('A different payment is already pending for this booking or event. Check its status before starting another payment.', 409);
    return payment;
  }

  const insert = await db.from('matmove_purchase_payments').insert({
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
  }).select('*').single();

  if (insert.error) {
    if (insert.error.code === '23505') {
      // A simultaneous tab/request already created the unique pending payment.
      return getPaymentRow(db, requestKey, userId, details, sourceAccountId, destinationAccountId);
    }
    fail('MatMove could not safely record this payment request. No new transfer was started.');
  }
  return insert.data;
}

function verifyTransfer(transfer, payment) {
  const amount = transfer?.amount || {};
  return transfer?.id
    && transfer.amount?.currency === 'SLE'
    && Number(amount.value) === Number(payment.amount_minor)
    && transfer.sourceFinancialAccount?.id === payment.source_account_id
    && transfer.destinationFinancialAccount?.id === payment.destination_account_id;
}

async function processPurchase(req, res) {
  const { db, user, accountId, idempotencyKey, account } = req.matmove;
  const details = await getPurchaseDetails(db, user.id, req.body || {});
  if (String(req.body.currency || 'SLE').toUpperCase() !== 'SLE') {
    fail('Travel and event checkout currently accepts SLE wallet payments only.', 400);
  }
  if (Number(req.matmove.minor) !== Number(details.amountMinor)) {
    fail('The amount changed. Refresh the booking or event price before trying again.', 409);
  }
  if (account?.currency !== 'SLE') fail('Select your SLE wallet to pay for travel or events.', 409);

  const destinationAccountId = destinationFor(details.target);
  if (destinationAccountId === accountId) fail('The collection account cannot be the customer source wallet.', 409);

  // Verify that the configured collection account exists and is denominated in SLE.
  const destination = await monime(`financial-accounts/${encodeURIComponent(destinationAccountId)}?withBalance=true`);
  if (destination?.id !== destinationAccountId || destination.currency !== 'SLE') {
    fail('The configured MatMove collection account is unavailable or is not an SLE account.');
  }

  const payment = await getPaymentRow(db, idempotencyKey, user.id, details, accountId, destinationAccountId);
  if (payment.state === 'completed' && payment.fulfilled_at) {
    return res.status(200).json({ success: true, data: { id: payment.provider_transfer_id, status: 'completed' }, paymentId: payment.id, fulfilled: true });
  }
  if (payment.state === 'review_required') {
    return res.status(200).json({ success: false, error: 'This payment needs MatMove support review. Do not pay again.', data: { id: payment.provider_transfer_id, status: 'review_required' }, paymentId: payment.id, fulfilled: false });
  }

  let transfer;
  if (payment.provider_transfer_id) {
    transfer = await monime(`internal-transfers/${encodeURIComponent(payment.provider_transfer_id)}`);
  } else {
    transfer = await monime('internal-transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': payment.request_key },
      body: JSON.stringify({
        amount: { currency: 'SLE', value: Number(payment.amount_minor) },
        sourceFinancialAccount: { id: payment.source_account_id },
        destinationFinancialAccount: { id: payment.destination_account_id },
        description: details.description,
        metadata: {
          matmovePurchasePaymentId: payment.id,
          matmoveUserId: user.id,
          matmovePurchaseType: details.target,
          matmoveBookingId: details.bookingId,
          matmoveEventId: details.eventId,
        },
      }),
    });
  }

  if (!verifyTransfer(transfer, payment)) {
    await db.from('matmove_purchase_payments').update({
      provider_transfer_id: transfer?.id || payment.provider_transfer_id,
      provider_status: String(transfer?.status || 'unverified').toLowerCase(),
      state: 'review_required',
      failure_detail: 'Provider transfer details did not match the stored MatMove payment request.',
      updated_at: new Date().toISOString(),
    }).eq('id', payment.id);
    return res.status(200).json({ success: false, error: 'Payment details need MatMove support review. Do not pay again.', data: { id: transfer?.id, status: 'review_required' }, paymentId: payment.id, fulfilled: false });
  }

  const providerStatus = String(transfer.status || '').toLowerCase();
  if (!['pending', 'processing', 'completed', 'failed'].includes(providerStatus)) {
    await db.from('matmove_purchase_payments').update({
      provider_transfer_id: transfer.id,
      provider_status: providerStatus || 'unknown',
      state: 'review_required',
      failure_detail: 'Monime returned an unknown transfer status.',
      updated_at: new Date().toISOString(),
    }).eq('id', payment.id);
    return res.status(200).json({ success: false, error: 'Payment status needs MatMove support review. Do not pay again.', data: { id: transfer.id, status: 'review_required' }, paymentId: payment.id, fulfilled: false });
  }

  const nextState = providerStatus === 'completed' ? 'processing' : providerStatus;
  const saved = await db.from('matmove_purchase_payments').update({
    provider_transfer_id: transfer.id,
    provider_status: providerStatus,
    state: nextState,
    failure_detail: providerStatus === 'failed' ? String(transfer.failureDetail?.message || 'Monime transfer failed.') : null,
    updated_at: new Date().toISOString(),
  }).eq('id', payment.id).select('id').single();
  if (saved.error) fail('Monime returned a transfer status, but MatMove could not save it. Do not start another payment; retry status checking.');

  if (providerStatus === 'completed') {
    const fulfilled = await db.rpc('matmove_fulfill_purchase_payment', { p_payment_id: payment.id });
    if (fulfilled.error || fulfilled.data?.fulfilled !== true) {
      await db.from('matmove_purchase_payments').update({
        state: 'review_required',
        failure_detail: 'Monime completed the transfer, but MatMove could not confirm the booking or ticket record.',
        updated_at: new Date().toISOString(),
      }).eq('id', payment.id);
      return res.status(200).json({ success: false, error: 'Monime completed payment, but MatMove needs to reconcile your booking or ticket. Do not pay again.', data: { id: transfer.id, status: 'review_required' }, paymentId: payment.id, fulfilled: false });
    }
    return res.status(200).json({ success: true, data: transfer, paymentId: payment.id, fulfilled: true });
  }

  return res.status(200).json({ success: providerStatus !== 'failed', error: providerStatus === 'failed' ? 'Monime reports that this transfer failed. No booking or ticket was fulfilled.' : undefined, data: transfer, paymentId: payment.id, fulfilled: false });
}

export const purchaseTransfer = protectedWallet('transfer', processPurchase);
