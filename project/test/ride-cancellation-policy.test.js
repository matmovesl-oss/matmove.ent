import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { rideAction } from '../server/ride-payments.js';

const rider = '00000000-0000-4000-8000-000000000001';
const driver = '00000000-0000-4000-8000-000000000002';
const otherDriver = '00000000-0000-4000-8000-000000000003';
const booking = '00000000-0000-4000-8000-000000000010';

async function database() {
  const pg = new PGlite();
  await pg.exec(`
    create table public.profiles (
      id uuid primary key,
      role text,
      kyc_status text,
      is_wallet_frozen boolean not null default false
    );

    create table public.wallets (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      currency text not null,
      monime_account_id text,
      metadata jsonb not null default '{}',
      is_frozen boolean not null default false
    );

    create table public.bookings (
      id uuid primary key,
      rider_id uuid not null,
      driver_id uuid,
      status text not null,
      fare_amount numeric not null,
      service_type text not null default 'ride',
      vehicle_type text not null default 'car',
      pickup_location text,
      destination_location text,
      scheduled_time timestamptz,
      created_at timestamptz not null default now()
    );

    create table public.ride_payments (
      booking_id uuid primary key,
      payer_id uuid not null,
      driver_id uuid not null,
      fare_minor bigint not null,
      driver_minor bigint not null,
      fee_minor bigint not null,
      payer_account text not null,
      driver_account text not null,
      escrow_account text not null,
      fee_account text not null,
      state text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.ride_payment_transfers (
      booking_id uuid not null,
      kind text not null,
      amount_minor bigint not null,
      source_account text not null,
      destination_account text not null,
      request_key text,
      provider_id text,
      status text not null default 'ready',
      attempted_at timestamptz,
      error text,
      updated_at timestamptz not null default now(),
      unique (booking_id, kind)
    );
  `);

  const sql = await readFile(
    new URL('../docs/20261109_ride_cancellation_policy_lockdown.sql', import.meta.url),
    'utf8'
  );
  await pg.exec(sql);
  return pg;
}

async function seedAccepted(pg) {
  await pg.query(
    `insert into public.profiles(id,role,kyc_status)
     values ($1,'rider','not_started'),($2,'driver','approved'),($3,'driver','approved')`,
    [rider, driver, otherDriver]
  );
  await pg.query(
    `insert into public.wallets(user_id,currency,monime_account_id)
     values ($1,'SLE','fac-payer'),($2,'SLE','fac-driver')`,
    [rider, driver]
  );
  await pg.query(
    `insert into public.bookings(id,rider_id,driver_id,status,fare_amount)
     values ($1,$2,$3,'accepted',100)`,
    [booking, rider, driver]
  );
  await pg.query(
    `insert into public.ride_payments(
       booking_id,payer_id,driver_id,fare_minor,driver_minor,fee_minor,
       payer_account,driver_account,escrow_account,fee_account,state
     ) values ($1,$2,$3,10000,8500,1500,'fac-payer','fac-driver','fac-escrow','fac-revenue','funded')`,
    [booking, rider, driver]
  );
}

test('assigned driver cancellation creates one full refund to the original payer', async () => {
  const pg = await database();
  try {
    await seedAccepted(pg);

    const first = await pg.query(
      `select public.prepare_ride_payment($1,$2,'cancel') as result`,
      [booking, driver]
    );
    assert.equal(first.rows[0].result.state, 'refunding');

    const legs = await pg.query(
      `select kind,amount_minor,source_account,destination_account
       from public.ride_payment_transfers where booking_id=$1`,
      [booking]
    );
    assert.deepEqual(legs.rows, [{
      kind: 'refund',
      amount_minor: 10000,
      source_account: 'fac-escrow',
      destination_account: 'fac-payer'
    }]);

    const retry = await pg.query(
      `select public.prepare_ride_payment($1,$2,'cancel') as result`,
      [booking, driver]
    );
    assert.equal(retry.rows[0].result.state, 'refunding');

    const count = await pg.query(
      'select count(*)::integer as count from public.ride_payment_transfers where booking_id=$1',
      [booking]
    );
    assert.equal(count.rows[0].count, 1);
    const currentBooking = await pg.query(
      'select status from public.bookings where id=$1',
      [booking]
    );
    assert.equal(currentBooking.rows[0].status, 'accepted');
  } finally {
    await pg.close();
  }
});

test('accepted rider cancellation fails closed without creating a refund or changing state', async () => {
  const pg = await database();
  try {
    await seedAccepted(pg);

    await assert.rejects(
      pg.query(`select public.prepare_ride_payment($1,$2,'cancel')`, [booking, rider]),
      /CANCEL_FEE_NOT_CONFIGURED/
    );

    const [payment, currentBooking, legs] = await Promise.all([
      pg.query('select state from public.ride_payments where booking_id=$1', [booking]),
      pg.query('select status from public.bookings where id=$1', [booking]),
      pg.query('select count(*)::integer as count from public.ride_payment_transfers where booking_id=$1', [booking])
    ]);
    assert.equal(payment.rows[0].state, 'funded');
    assert.equal(currentBooking.rows[0].status, 'accepted');
    assert.equal(legs.rows[0].count, 0);
  } finally {
    await pg.close();
  }
});

test('another driver cannot cancel a booking assigned to somebody else', async () => {
  const pg = await database();
  try {
    await seedAccepted(pg);
    await assert.rejects(
      pg.query(`select public.prepare_ride_payment($1,$2,'cancel')`, [booking, otherDriver]),
      /FORBIDDEN/
    );
    const legs = await pg.query(
      'select count(*)::integer as count from public.ride_payment_transfers where booking_id=$1',
      [booking]
    );
    assert.equal(legs.rows[0].count, 0);
  } finally {
    await pg.close();
  }
});

test('pending rider cancellation without a payment ledger cancels without a transfer', async () => {
  const pg = await database();
  try {
    await pg.query(
      `insert into public.profiles(id,role,kyc_status) values ($1,'rider','not_started')`,
      [rider]
    );
    await pg.query(
      `insert into public.bookings(id,rider_id,status,fare_amount)
       values ($1,$2,'pending',100)`,
      [booking, rider]
    );
    await pg.query(
      `select public.prepare_ride_payment($1,$2,'cancel')`,
      [booking, rider]
    );
    const currentBooking = await pg.query(
      'select status from public.bookings where id=$1',
      [booking]
    );
    assert.equal(currentBooking.rows[0].status, 'cancelled');
    const payments = await pg.query(
      'select count(*)::integer as count from public.ride_payments where booking_id=$1',
      [booking]
    );
    assert.equal(payments.rows[0].count, 0);
  } finally {
    await pg.close();
  }
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function cancellationDb({ bookingRow, paymentRow }) {
  const calls = [];
  class Query {
    constructor(table) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    async single() { return { data: bookingRow, error: null }; }
    async maybeSingle() { return { data: paymentRow, error: null }; }
    then(resolve, reject) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    }
  }
  return {
    calls,
    from: table => new Query(table),
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: null, error: null };
    }
  };
}

test('API blocks accepted rider cancellation before calling any payment RPC', async () => {
  const bookingRow = {
    id: booking,
    rider_id: rider,
    driver_id: driver,
    status: 'accepted',
    fare_amount: 100
  };
  const paymentRow = { booking_id: booking, state: 'funded' };
  const db = cancellationDb({ bookingRow, paymentRow });
  const req = {
    body: { bookingId: booking },
    matmove: { db, user: { id: rider }, profile: { role: 'rider' } }
  };
  const res = response();

  await assert.rejects(
    rideAction(req, res, 'cancel'),
    /agreed cancellation fee is not configured/i
  );
  assert.equal(db.calls.length, 0);
});

test('API permits the assigned driver to submit the cancellation RPC with the signed-in actor ID', async () => {
  const bookingRow = {
    id: booking,
    rider_id: rider,
    driver_id: driver,
    status: 'accepted',
    fare_amount: 100
  };
  const paymentRow = { booking_id: booking, state: 'funded' };
  const db = cancellationDb({ bookingRow, paymentRow });
  const req = {
    body: { bookingId: booking },
    matmove: { db, user: { id: driver }, profile: { role: 'driver' } }
  };
  const res = response();

  await rideAction(req, res, 'cancel');
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.success, false);
  assert.equal(db.calls[0].name, 'prepare_ride_payment');
  assert.equal(db.calls[0].args.p_actor_id, driver);
  assert.equal(db.calls[0].args.p_action, 'cancel');
});
