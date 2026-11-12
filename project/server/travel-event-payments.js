import {
  HttpError,
  monime,
  protectedWallet,
  toMinorUnits,
  dbClient,
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

  if (byKey.data) {
    const existing = byKey.data;
    if (
      existing.user_id !== userId ||
      existing.purchase_type !== details.target ||
      existing.booking_id !== details.bookingId ||
      existing.event_id !== details.eventId ||
      Number(existing.quantity) !== details.quantity ||
      Number(existing.amount_minor) !== details.amountMinor ||
      Number(existing.unit_amount_minor) !== details.unitAmountMinor ||
      existing.source_account_id !== sourceAccountId ||
      existing.destination_account_id !== destinationAccountId
    ) fail('This payment request key is already tied to different purchase details.', 409);
    return existing;
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
    fail('MatMove could not record payment request: ' + insert.error.message);
  }
  return insert.data;
}

export async function requestPurchaseTransfer(payment, details, user, provider = monime) {
  if (payment.provider_transfer_id !== null && payment.provider_transfer_id !== undefined) {
    if (typeof payment.provider_transfer_id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(payment.provider_transfer_id)) {
      throw new HttpError(409, 'The stored provider transfer ID is invalid. Contact support before retrying.');
    }
    // A recorded provider ID is authoritative: reconcile it with GET.
    // Never create another transfer for a payment that already has a provider ID.
    return provider(`internal-transfers/${encodeURIComponent(payment.provider_transfer_id)}`);
  }

  return provider('internal-transfers', {
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

export function matchesPurchaseTransfer(payment, transfer) {
  return typeof transfer?.id === 'string' &&
    transfer.id.length > 0 &&
    (!payment.provider_transfer_id || transfer.id === payment.provider_transfer_id) &&
    transfer.amount?.currency === 'SLE' &&
    transfer.amount?.value === Number(payment.amount_minor) &&
    transfer.sourceFinancialAccount?.id === payment.source_account_id &&
    transfer.destinationFinancialAccount?.id === payment.destination_account_id;
}

export async function reconcilePurchasePayments({
  db = dbClient(),
  provider = monime,
  limit = 5,
} = {}) {
  const batchSize = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const query = await db
    .from('matmove_purchase_payments')
    .select('*')
    .in('state', ['processing', 'completed'])
    .not('provider_transfer_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(batchSize);

  if (query.error) {
    throw new Error('Purchase payment reconciliation query failed.');
  }

  const rows = (query.data || []).filter(payment =>
    typeof payment.provider_transfer_id === 'string' &&
    payment.provider_transfer_id.length > 0 &&
    (payment.state === 'processing' || (payment.state === 'completed' && !payment.fulfilled_at))
  );

  const result = { checked: 0, processed: 0, retrying: 0, failed: 0 };

  for (const payment of rows) {
    result.checked += 1;

    try {
      // This worker is GET-only. It never creates or retries a provider transfer.
      const raw = await provider(
        `internal-transfers/${encodeURIComponent(payment.provider_transfer_id)}`
      );
      const transfer = raw?.result || raw;

      if (!matchesPurchaseTransfer(payment, transfer)) {
        const update = await db
          .from('matmove_purchase_payments')
          .update({
            state: 'review_required',
            provider_status: 'review_required',
            failure_detail: 'Provider transfer did not match the stored purchase. Manual review required.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);
        if (update.error) result.retrying += 1;
        else result.failed += 1;
        continue;
      }

      const status = String(transfer.status || '').toLowerCase();

      if (status === 'pending' || status === 'processing') {
        const update = await db
          .from('matmove_purchase_payments')
          .update({
            state: 'processing',
            provider_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);
        result.retrying += 1;
        if (update.error) {
          console.error('MatMove purchase status update failed', { paymentId: payment.id });
        }
        continue;
      }

      if (status === 'failed') {
        const update = await db
          .from('matmove_purchase_payments')
          .update({
            state: 'failed',
            provider_status: 'failed',
            failure_detail: 'Monime confirmed that the existing purchase transfer failed.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);
        if (update.error) result.retrying += 1;
        else result.failed += 1;
        continue;
      }

      if (status !== 'completed') {
        const update = await db
          .from('matmove_purchase_payments')
          .update({
            state: 'review_required',
            provider_status: status || 'unknown',
            failure_detail: 'Monime returned an unrecognized transfer status. Manual review required.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', payment.id);
        if (update.error) result.retrying += 1;
        else result.failed += 1;
        continue;
      }

      const recorded = await db
        .from('matmove_purchase_payments')
        .update({
          state: 'completed',
          provider_status: 'completed',
          failure_detail: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id);

      if (recorded.error) {
        result.retrying += 1;
        continue;
      }

      const fulfillment = await db.rpc('matmove_fulfill_purchase_payment', {
        p_payment_id: payment.id,
      });

      if (fulfillment.error || fulfillment.data?.success !== true) {
        result.retrying += 1;
        continue;
      }

      const confirmation = await db
        .from('matmove_purchase_payments')
        .select('fulfilled_at')
        .eq('id', payment.id)
        .single();

      if (confirmation.error || !confirmation.data?.fulfilled_at) {
        result.retrying += 1;
        continue;
      }

      result.processed += 1;
    } catch {
      // A provider GET failure is not evidence that the transfer failed.
      // Keep the row pending for a later read-only reconciliation attempt.
      console.error('MatMove purchase reconciliation failed', { paymentId: payment.id });
      result.retrying += 1;
    }
  }

  return result;
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

  if (payment.state === 'failed') {
    return res.status(400).json({ success: false, error: 'This payment was recorded as failed. Contact support before trying again.', paymentId: payment.id });
  }

  if (payment.state === 'review_required' && !payment.provider_transfer_id) {
    return res.status(202).json({ success: false, pending: true, status: 'review_required', paymentId: payment.id, error: 'The original provider outcome is uncertain. Do not pay again; support must reconcile it.' });
  }

  let transfer;
  try {
    transfer = await requestPurchaseTransfer(payment, details, user, monime);
  } catch (err) {
    if (payment.provider_transfer_id) {
      // A GET failure cannot prove that the already-created transfer failed.
      // Preserve the provider ID and processing state; never POST a replacement.
      console.error('MatMove purchase transfer lookup failed', { paymentId: payment.id });
      return res.status(202).json({ success: false, pending: true, status: 'processing', paymentId: payment.id, error: 'The existing provider transfer could not be checked. Do not pay again.' });
    }

    await db.from('matmove_purchase_payments').update({
      state: 'review_required',
      provider_status: 'review_required',
      failure_detail: 'Provider response uncertain. Reconcile the original request before retrying.',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return res.status(202).json({ success: false, pending: true, status: 'review_required', paymentId: payment.id, error: 'The payment outcome is uncertain. Do not pay again.' });
  }

  const transferResult = transfer?.result || transfer;
  const providerStatus = String(transferResult?.status || '').toLowerCase();
  const receiptMatches = matchesPurchaseTransfer(payment, transferResult);

  if (!receiptMatches) {
    await db.from('matmove_purchase_payments').update({
      state: 'review_required',
      provider_status: 'review_required',
      failure_detail: 'Monime response did not match the recorded purchase. Manual reconciliation required.',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return res.status(202).json({ success: false, pending: true, error: 'Payment receipt requires verification. Do not pay again.', paymentId: payment.id });
  }

  if (providerStatus === 'failed') {
    const { error } = await db.from('matmove_purchase_payments').update({
      state: 'failed',
      provider_status: 'failed',
      provider_transfer_id: transferResult.id,
      failure_detail: transferResult.failureDetail?.message || 'Monime reported that the transfer failed.',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    if (error) fail('Payment status could not be safely recorded.');
    return res.status(400).json({ success: false, error: 'Payment transfer failed on gateway.' });
  }

  if (providerStatus === 'pending' || providerStatus === 'processing') {
    const { error } = await db.from('matmove_purchase_payments').update({
      state: 'processing',
      provider_status: providerStatus,
      provider_transfer_id: transferResult.id,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    if (error) fail('Pending payment status could not be safely recorded.');
    return res.status(202).json({ success: false, pending: true, paymentId: payment.id, status: providerStatus });
  }

  if (providerStatus !== 'completed') {
    await db.from('matmove_purchase_payments').update({
      state: 'review_required',
      provider_status: providerStatus || 'unknown',
      provider_transfer_id: transferResult.id,
      failure_detail: 'Monime returned an unrecognized transfer status.',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    return res.status(202).json({ success: false, pending: true, error: 'Payment status requires reconciliation. Do not pay again.', paymentId: payment.id });
  }

  const { error: recordedError } = await db.from('matmove_purchase_payments').update({
    provider_transfer_id: transferResult.id,
    provider_status: 'completed',
    state: 'completed',
    updated_at: new Date().toISOString()
  }).eq('id', payment.id);
  if (recordedError) fail('Confirmed payment could not be recorded for fulfilment.');

  // The database function is the sole ticket/booking fulfilment path.
  const { data: fulfillment, error: fulfillmentError } = await db.rpc('matmove_fulfill_purchase_payment', {
    p_payment_id: payment.id
  });
  if (fulfillmentError || fulfillment?.success !== true) {
    console.error('MatMove purchase fulfilment requires retry', {
      paymentId: payment.id,
      code: fulfillmentError?.code
    });
    return res.status(503).json({ success: false, pending: true, paymentId: payment.id, error: 'Payment was confirmed, but fulfilment is pending. Do not pay again.' });
  }

  const { data: fulfilledPayment, error: readError } = await db
    .from('matmove_purchase_payments')
    .select('fulfilled_at')
    .eq('id', payment.id)
    .single();
  if (readError || !fulfilledPayment?.fulfilled_at) {
    return res.status(503).json({ success: false, pending: true, paymentId: payment.id, error: 'Payment fulfilment is awaiting confirmation. Do not pay again.' });
  }

  const { data: existingTicket } = details.target === 'event'
    ? await db.from('event_tickets').select('ticket_code').eq('payment_id', payment.id).maybeSingle()
    : { data: null };

  return res.status(200).json({
    success: true,
    ticketCode: existingTicket?.ticket_code || transferResult.id,
    paymentId: payment.id,
    fulfilled: true,
    data: transferResult
  });
}

export const purchaseTransfer = protectedWallet('transfer', processPurchase);