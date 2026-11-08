import test from 'node:test';
import assert from 'node:assert/strict';
import { processPurchase } from '../server/travel-event-payments.js';

const userId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const paymentId = '44444444-4444-4444-8444-444444444444';
const requestKey = '55555555-5555-4555-8555-555555555555';
const sourceId = 'fac-customer';
const travelId = 'fac-travel';
const eventAccountId = 'fac-events';

function transfer(status = 'completed', overrides = {}) {
  return {
    id: 'trn-123456789',
    status,
    amount: { currency: 'SLE', value: 10000 },
    sourceFinancialAccount: { id: sourceId },
    destinationFinancialAccount: { id: travelId },
    ...overrides,
  };
}

function travelBooking(extra = {}) {
  return {
    id: bookingId,
    user_id: userId,
    status: 'approved',
    is_paid: false,
    passengers_count: 2,
    fare_amount: '100.00',
    passenger_phone: '+23276123456',
    payment_id: null,
    ...extra,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function matches(row, filters) {
  return filters.every(([key, expected, kind]) => {
    const actual = row?.[key] ?? null;
    return kind === 'is' ? actual === expected : actual === expected;
  });
}

function makeDb({ existingPayment = null, booking = travelBooking(), event = null, failBookingUpdate = false, failTicketInsert = false } = {}) {
  const db = {
    payments: existingPayment ? [{ ...existingPayment }] : [],
    booking: booking ? { ...booking } : null,
    event: event ? { ...event } : null,
    profile: { phone: '+23276123456', phone_number: null },
    tickets: [],
    calls: [],
    failBookingUpdate,
    failTicketInsert,
    from(table) {
      const query = {
        table,
        action: 'select',
        values: null,
        filters: [],
        columns: '*',
        select(columns = '*') { this.columns = columns; return this; },
        insert(values) { this.action = 'insert'; this.values = values; return this; },
        update(values) { this.action = 'update'; this.values = values; return this; },
        eq(key, value) { this.filters.push([key, value, 'eq']); return this; },
        is(key, value) { this.filters.push([key, value, 'is']); return this; },
        maybeSingle() { return Promise.resolve(this.execute()); },
        single() { return Promise.resolve(this.execute()); },
        execute() {
          db.calls.push({ table: this.table, action: this.action, values: this.values, filters: [...this.filters] });

          if (this.table === 'matmove_purchase_payments' && this.action === 'select') {
            return { data: db.payments.find(row => matches(row, this.filters)) || null, error: null };
          }

          if (this.table === 'matmove_purchase_payments' && this.action === 'insert') {
            if (db.payments.some(row => row.request_key === this.values.request_key)) {
              return { data: null, error: { code: '23505' } };
            }
            const row = {
              id: paymentId,
              created_at: new Date().toISOString(),
              provider_transfer_id: null,
              fulfilled_at: null,
              failure_detail: null,
              ...this.values,
            };
            db.payments.push(row);
            return { data: { ...row }, error: null };
          }

          if (this.table === 'matmove_purchase_payments' && this.action === 'update') {
            const row = db.payments.find(item => matches(item, this.filters));
            if (!row) return { data: null, error: null };
            Object.assign(row, this.values);
            return { data: { ...row }, error: null };
          }

          if (this.table === 'travel_bookings' && this.action === 'select') {
            return { data: db.booking && matches(db.booking, this.filters) ? { ...db.booking } : null, error: null };
          }

          if (this.table === 'travel_bookings' && this.action === 'update') {
            if (db.failBookingUpdate) return { data: null, error: { message: 'travel update failed' } };
            if (!db.booking || !matches(db.booking, this.filters)) return { data: null, error: null };
            Object.assign(db.booking, this.values);
            return { data: { ...db.booking }, error: null };
          }

          if (this.table === 'platform_events' && this.action === 'select') {
            return { data: db.event && matches(db.event, this.filters) ? { ...db.event } : null, error: null };
          }

          if (this.table === 'profiles' && this.action === 'select') {
            return { data: { ...db.profile }, error: null };
          }

          if (this.table === 'event_tickets' && this.action === 'select') {
            return { data: db.tickets.find(row => matches(row, this.filters)) || null, error: null };
          }

          if (this.table === 'event_tickets' && this.action === 'insert') {
            if (db.failTicketInsert || db.tickets.some(row => row.payment_id === this.values.payment_id)) {
              return { data: null, error: { code: '23505', message: 'ticket insert failed' } };
            }
            const row = { id: '66666666-6666-4666-8666-666666666666', ...this.values };
            db.tickets.push(row);
            return { data: { ...row }, error: null };
          }

          throw new Error(`Unexpected DB operation: ${this.table} ${this.action}`);
        },
      };
      return query;
    },
  };
  return db;
}

async function runPurchase({
  target = 'travel',
  db = makeDb(),
  provider = async () => ({ result: transfer('completed') }),
  body = target === 'travel'
    ? { target, bookingId }
    : { target, eventId, quantity: 2 },
  key = requestKey,
} = {}) {
  const res = response();
  const req = {
    body,
    matmove: {
      db,
      user: { id: userId },
      accountId: sourceId,
      account: { id: sourceId, currency: 'SLE' },
      idempotencyKey: key,
    },
  };
  await processPurchase(req, res, {
    provider,
    env: {
      MONIME_TRAVEL_ACCOUNT_ID: travelId,
      MONIME_EVENT_ACCOUNT_ID: eventAccountId,
    },
  });
  return { res, db };
}

test('pending transfer remains pending and never marks travel as paid', async () => {
  const calls = [];
  const { res, db } = await runPurchase({
    provider: async (path, options) => {
      calls.push({ path, options });
      return { result: transfer('processing') };
    },
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, false);
  assert.equal(res.body.pending, true);
  assert.equal(res.body.status, 'processing');
  assert.equal(db.booking.is_paid, false);
  assert.equal(db.booking.payment_id, null);
  assert.equal(db.payments[0].state, 'processing');
  assert.equal(db.payments[0].provider_transfer_id, 'trn-123456789');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'internal-transfers');
  assert.equal(calls[0].options.method, 'POST');
});

test('missing or unknown provider status fails closed and does not fulfill travel', async () => {
  const { res, db } = await runPurchase({
    provider: async () => ({
      result: {
        ...transfer('completed'),
        status: undefined,
      },
    }),
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, false);
  assert.equal(res.body.pending, true);
  assert.equal(db.booking.is_paid, false);
  assert.equal(db.payments[0].state, 'review_required');
});

test('completed transfer does not produce success when travel booking update fails', async () => {
  const db = makeDb({ failBookingUpdate: true });
  const { res } = await runPurchase({
    db,
    provider: async () => ({ result: transfer('completed') }),
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, false);
  assert.equal(res.body.pending, true);
  assert.equal(db.booking.is_paid, false);
  assert.equal(db.payments[0].state, 'review_required');
  assert.equal(db.payments[0].provider_status, 'completed');
});

test('completed travel payment is successful only after the exact booking is confirmed paid', async () => {
  const { res, db } = await runPurchase({
    provider: async () => ({ result: transfer('completed') }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.fulfilled, true);
  assert.equal(db.booking.is_paid, true);
  assert.equal(db.booking.payment_id, paymentId);
  assert.equal(db.payments[0].state, 'completed');
  assert.equal(db.payments[0].provider_status, 'completed');
  assert.ok(db.payments[0].fulfilled_at);
});

test('event payment does not return success if the ticket could not be created', async () => {
  const db = makeDb({
    booking: null,
    event: { id: eventId, is_active: true, ticket_price: '50.00' },
    failTicketInsert: true,
  });
  const { res } = await runPurchase({
    target: 'event',
    db,
    provider: async () => ({
      result: transfer('completed', {
        amount: { currency: 'SLE', value: 10000 },
        destinationFinancialAccount: { id: eventAccountId },
      }),
    }),
  });

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, false);
  assert.equal(res.body.pending, true);
  assert.equal(db.tickets.length, 0);
  assert.equal(db.payments[0].state, 'review_required');
});

test('reusing a payment idempotency key for another user or booking is rejected before provider access', async () => {
  const existing = {
    id: paymentId,
    request_key: requestKey,
    user_id: userId,
    purchase_type: 'travel',
    booking_id: bookingId,
    event_id: null,
    quantity: 2,
    currency: 'SLE',
    source_account_id: sourceId,
    destination_account_id: travelId,
    amount_minor: 10000,
    unit_amount_minor: 5000,
    state: 'processing',
    provider_status: 'processing',
    provider_transfer_id: 'trn-123456789',
    created_at: new Date().toISOString(),
  };
  const db = makeDb({ existingPayment: existing });
  let providerCalls = 0;

  const { res } = await runPurchase({
    db,
    body: { target: 'travel', bookingId: eventId },
    provider: async () => { providerCalls++; return { result: transfer('completed') }; },
  }).catch(error => ({ res: { statusCode: error.status || 500, body: { error: error.message } } }));

  assert.equal(res.statusCode, 409);
  assert.equal(providerCalls, 0);
});

test('known transfer is reconciled by GET and is never debited by a second POST', async () => {
  const existing = {
    id: paymentId,
    request_key: requestKey,
    user_id: userId,
    purchase_type: 'travel',
    booking_id: bookingId,
    event_id: null,
    quantity: 2,
    user_phone: '+23276123456',
    currency: 'SLE',
    source_account_id: sourceId,
    destination_account_id: travelId,
    amount_minor: 10000,
    unit_amount_minor: 5000,
    state: 'processing',
    provider_status: 'processing',
    provider_transfer_id: 'trn-123456789',
    created_at: new Date().toISOString(),
  };
  const db = makeDb({ existingPayment: existing });
  const calls = [];

  const { res } = await runPurchase({
    db,
    provider: async (path, options) => {
      calls.push({ path, options });
      return { result: transfer('completed') };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(db.booking.is_paid, true);
  assert.equal(db.booking.payment_id, paymentId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'internal-transfers/trn-123456789');
  assert.equal(calls[0].options, undefined);
});
