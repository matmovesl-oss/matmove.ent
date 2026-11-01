import {
  HttpError,
  monime,
  protectedWallet,
  toMinorUnits,
} from './wallet-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^fac-[A-Za-z0-9_-]+$/;

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
      .select('id,user_id,status,is_paid,passengers_count,fare_amount,passenger_name,passenger_phone,departure_date')
      .eq('id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) fail('Travel booking could not be verified.');
    if (!booking) fail('Travel booking not found.', 404);
    if (booking.is_paid) fail('This travel booking is already paid.', 409);
    if (booking.status !== 'approved') fail('Dispatch must approve this travel booking before payment.', 409);

    const unitMinor = Math.round((Number(booking.fare_amount) / (booking.passengers_count || 1)) * 100);
    return {
      target,
      bookingId: booking.id,
      eventId: null,
      quantity: booking.passengers_count || 1,
      userPhone: booking.passenger_phone || '',
      amountMinor: Math.round(Number(booking.fare_amount) * 100),
      unitAmountMinor: unitMinor,
      description: `MatMove Travel: Freetown - Accra Direct (${booking.passengers_count || 1} seats)`,
    };
  }

  if (target === 'event') {
    const eventId = String(body.eventId || '');
    const quantity = Number(body.quantity) || 1;
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

    const { data: profile } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
    const userPhone = String(body.userPhone || profile?.phone || profile?.phone_number || '').trim();

    const unitMinor = Math.round(Number(event.ticket_price) * 100);
    return {
      target,
      bookingId: null,
      eventId: event.id,
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
  if (byKey.error) fail('MatMove purchase payment storage is not ready.');

  if (byKey.data) return byKey.data;

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
    fail('MatMove could not record payment request: ' + insert.error.message);
  }
  return insert.data;
}

async function processPurchase(req, res) {
  const { db, user, accountId, idempotencyKey, account } = req.matmove;
  const details = await getPurchaseDetails(db, user.id, req.body || {});
  
  if (account?.currency !== 'SLE') fail('Select your SLE wallet to pay for travel or events.', 409);

  const destinationAccountId = destinationFor(details.target);
  if (destinationAccountId === accountId) fail('The collection account cannot be the customer source wallet.', 409);

  const payment = await getPaymentRow(db, idempotencyKey, user.id, details, accountId, destinationAccountId);
  
  if (payment.state === 'completed' && payment.fulfilled_at) {
    const { data: existingTicket } = await db.from('event_tickets').select('*').eq('payment_id', payment.id).maybeSingle();
    return res.status(200).json({
      success: true,
      ticketCode: existingTicket?.ticket_code || payment.provider_transfer_id,
      paymentId: payment.id,
      fulfilled: true
    });
  }

  let transfer;
  try {
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
  } catch (err) {
    await db.from('matmove_purchase_payments').update({
      state: 'failed',
      failure_detail: err.message,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return res.status(400).json({ success: false, error: err.message || 'Monime gateway rejected the transfer.' });
  }

  const transferResult = transfer?.result || transfer;
  const providerStatus = String(transferResult?.status || 'completed').toLowerCase();

  if (providerStatus === 'failed') {
    await db.from('matmove_purchase_payments').update({
      state: 'failed',
      provider_status: 'failed',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return res.status(400).json({ success: false, error: 'Payment transfer failed on gateway.' });
  }

  // Generate unique Ticket Code
  let generatedTicketCode = `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  if (details.target === 'event') {
    const { data: ticketRecord, error: tktErr } = await db.from('event_tickets').insert({
      event_id: details.eventId,
      user_id: user.id,
      user_phone: details.userPhone || 'Customer',
      ticket_code: generatedTicketCode,
      tickets_count: details.quantity,
      amount_paid: Number(payment.amount_minor) / 100,
      status: 'confirmed',
      payment_id: payment.id
    }).select('*').single();

    if (!tktErr && ticketRecord) {
      generatedTicketCode = ticketRecord.ticket_code;
    }
  } else if (details.target === 'travel') {
    await db.from('travel_bookings').update({
      is_paid: true,
      payment_id: payment.id,
      status: 'approved'
    }).eq('id', details.bookingId);
  }

  await db.from('matmove_purchase_payments').update({
    provider_transfer_id: transferResult.id || `tr-${Date.now()}`,
    provider_status: 'completed',
    state: 'completed',
    fulfilled_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', payment.id);

  return res.status(200).json({
    success: true,
    ticketCode: generatedTicketCode,
    paymentId: payment.id,
    fulfilled: true,
    data: transferResult
  });
}

export const purchaseTransfer = protectedWallet('transfer', processPurchase);