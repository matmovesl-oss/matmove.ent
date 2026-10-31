import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { rideAction, rpc, runLeg, reconcileRide } from '../server/ride-payments.js';
import { authorize } from '../server/wallet-security.js';

let pg;

const rider = '00000000-0000-4000-8000-000000000001';
const driver = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const bookingId = '00000000-0000-4000-8000-000000000010';
const columns = /^[a-z_]+$/;

class Query {
  constructor(table) {
    assert.match(table, columns);
    this.table = table;
    this.filters = [];
  }

  select() { return this; }

  eq(key, value) {
    assert.match(key, columns);
    this.filters.push([key, value]);
    return this;
  }

  async execute(single) {
    try {
      const where = this.filters
        .map(([key], i) => `${key}=$${i + 1}`)
        .join(' and ');

      const result = await pg.query(
        `select * from public.${this.table}${where ? ` where ${where}` : ''}`,
        this.filters.map(([, v]) => v)
      );

      return {
        data: single ? result.rows[0] || null : result.rows,
        error: null
      };
    } catch (error) {
      return { data: null, error };
    }
  }

  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true); }
  then(a, b) { return this.execute(false).then(a, b); }
}

const db = {
  from: table => new Query(table),

  async rpc(name, args) {
    assert.match(name, columns);
    const keys = Object.keys(args);

    for (const key of keys) assert.match(key, columns);

    try {
      const result = await pg.query(
        `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`,
        Object.values(args)
      );

      return { data: result.rows[0].result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};

let posts, remote, desired, provider, balances, applied;

const verifyAccount = async (_db, wallet) => ({
  id: wallet.monime_account_id,
  currency: 'SLE'
});

const call = async (action, actor = rider, extra = {}) => {
  const result = {};

  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return result;
    }
  };

  const req = {
    body: { bookingId, ...extra },
    matmove: {
      db,
      user: { id: actor },
      profile: {
        role: actor === rider ? 'rider' : 'driver'
      }
    }
  };

  await rideAction(req, res, action, { provider, verifyAccount });
  return result;
};

const row = async table => (
  await pg.query(
    `select * from public.${table} where ${table === 'bookings' ? 'id' : 'booking_id'}=$1`,
    [bookingId]
  )
).rows[0];

const prepare = actor => rpc(db, 'prepare_ride_payment', {
  p_booking_id: bookingId,
  p_actor_id: actor,
  p_action: 'accept',
  p_payer_account: 'fac-payer',
  p_driver_account: 'fac-driver',
  p_escrow_account: 'fac-escrow',
  p_fee_account: 'fac-revenue',
});

before(async () => {
  pg = new PGlite();

  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_admin;
    create schema auth;

    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;

    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table profiles(
      id uuid primary key,
      role text,
      full_name text,
      kyc_status text,
      is_wallet_frozen boolean default false
    );

    create table wallets(
      id uuid primary key default gen_random_uuid(),
      user_id uuid,
      currency text,
      balance numeric default 0,
      monime_account_id text,
      metadata jsonb default '{}',
      is_frozen boolean default false
    );

    create table pricing_settings(
      vehicle_type text,
      min_fare numeric
    );

    insert into pricing_settings values('car',30),('bike',0.01);

    create table bookings(
      id uuid primary key,
      rider_id uuid references profiles(id),
      driver_id uuid references profiles(id),
      status text not null check(
        status in (
          'pending',
          'pending_admin',
          'accepted',
          'in_progress',
          'completed',
          'cancelled'
        )
      ),
      fare_amount numeric,
      service_type text default 'ride',
      vehicle_type text default 'car',
      pickup_location text,
      destination_location text,
      scheduled_time timestamptz,
      created_at timestamptz default now()
    );

    grant select,insert,update,delete on bookings to authenticated;
    grant select on profiles,wallets,pricing_settings to authenticated;
  `);

  await pg.exec(await readFile(
    new URL('../supabase/migrations/20261012120000_wallet_account_links.sql', import.meta.url),
    'utf8'
  ));

  await pg.exec(await readFile(
    new URL('../supabase/migrations/20261011130000_backend_ride_payments.sql', import.meta.url),
    'utf8'
  ));

  process.env.MONIME_ESCROW_ACCOUNT_ID = 'fac-escrow';
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-revenue';
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    'reset role; truncate profiles,wallets,bookings,ride_payments,ride_payment_transfers cascade;'
  );

  await pg.query(
    `insert into profiles(id,role,kyc_status)
     values($1,'rider','not_started'),($2,'driver','approved'),($3,'driver','approved')`,
    [rider, driver, other]
  );

  await pg.query(
    `insert into wallets(user_id,currency,monime_account_id)
     values($1,'SLE','fac-payer'),($2,'SLE','fac-driver'),($3,'SLE','fac-other')`,
    [rider, driver, other]
  );

  await pg.query(
    `insert into bookings(id,rider_id,status,fare_amount)
     values($1,$2,'pending',100)`,
    [bookingId, rider]
  );

  process.env.MONIME_ESCROW_ACCOUNT_ID = 'fac-escrow';
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-revenue';

  posts = [];
  remote = new Map();
  desired = {};

  balances = new Map([
    ['fac-payer', 10000],
    ['fac-driver', 0],
    ['fac-escrow', 0],
    ['fac-revenue', 0],
    ['fac-other', 0]
  ]);

  applied = new Set();

  const apply = transfer => {
    if (
      transfer.status !== 'completed' ||
      applied.has(transfer.id)
    ) return;

    const source = transfer.sourceFinancialAccount.id;
    const destination = transfer.destinationFinancialAccount.id;

    if (balances.get(source) < transfer.amount.value) {
      transfer.status = 'failed';
      return;
    }

    balances.set(source, balances.get(source) - transfer.amount.value);

    balances.set(
      destination,
      (balances.get(destination) || 0) + transfer.amount.value
    );

    applied.add(transfer.id);
  };

  provider = async (path, options) => {
    if (path.startsWith('financial-accounts/')) {
      return {
        id: path.split('/')[1].split('?')[0],
        currency: 'SLE'
      };
    }

    if (options?.method === 'POST') {
      const body = JSON.parse(options.body);

      posts.push({
        ...body,
        key: options.headers['Idempotency-Key']
      });

      const transfer = {
        ...body,
        id: `itr-${posts.length}`,
        status: desired[body.metadata.leg] || 'completed'
      };

      apply(transfer);
      remote.set(transfer.id, transfer);
      return structuredClone(transfer);
    }

    const transfer = remote.get(path.split('/')[1]);
    apply(transfer);
    return structuredClone(transfer);
  };
});

test('backend ignores browser amounts/IDs; debits escrow once and releases 85/15', async () => {
  const accepted = await call('accept', driver, {
    amount: 999999,
    riderId: other,
    driverId: other,
    recipientAccountId: 'fac-attacker'
  });

  assert.equal(accepted.status, 200);
  assert.equal(posts[0].amount.value, 10000);
  assert.equal(posts[0].sourceFinancialAccount.id, 'fac-payer');
  assert.equal(posts[0].destinationFinancialAccount.id, 'fac-escrow');

  await call('accept', driver);
  assert.equal(posts.length, 1);

  await call('start', driver);
  await call('complete', rider, { amount: 1, driverId: other });

  assert.deepEqual(posts.map(p => p.amount.value), [10000, 8500, 1500]);

  assert.deepEqual(
    posts.map(p => p.destinationFinancialAccount.id),
    ['fac-escrow', 'fac-driver', 'fac-revenue']
  );

  await call('complete');

  assert.equal(posts.length, 3);
  assert.equal((await row('ride_payments')).state, 'released');
  assert.equal((await row('bookings')).status, 'completed');
  assert.equal(new Set(posts.map(p => p.key)).size, 3);
});

test('merchant booking debits merchant wallet and releases through the same ledger', async () => {
  await pg.query(
    "update profiles set role='merchant',kyc_status='approved' where id=$1",
    [rider]
  );

  await call('accept', driver);
  await call('start', driver);
  await call('complete');

  assert.equal(posts[0].sourceFinancialAccount.id, 'fac-payer');
  assert.equal((await row('bookings')).status, 'completed');
});

test('only one driver can claim a booking; concurrent holds create one provider transfer', async () => {
  await prepare(driver);
  await assert.rejects(prepare(other), /Another driver/);

  await Promise.all([
    runLeg(db, bookingId, 'hold', provider),
    runLeg(db, bookingId, 'hold', provider)
  ]);

  assert.equal(posts.length, 1);
});

test('pending hold does not accept or start; retry polls the recorded transfer ID', async () => {
  desired.hold = 'pending';

  assert.equal((await call('accept', driver)).status, 202);
  assert.equal((await row('bookings')).status, 'pending');

  await assert.rejects(call('start', driver), /funded/);

  remote.get('itr-1').status = 'completed';

  assert.equal((await call('accept', driver)).status, 200);
  assert.equal(posts.length, 1);
});

test('partial release resumes fee polling without paying the driver again', async () => {
  await call('accept', driver);
  await call('start', driver);

  desired.fee = 'pending';

  assert.equal((await call('complete')).status, 202);
  assert.equal((await row('bookings')).status, 'in_progress');

  remote.get('itr-3').status = 'completed';

  assert.equal((await call('complete')).status, 200);
  assert.equal(posts.length, 3);
});

test('cancel accepted trip returns the entire held fare to its original payer', async () => {
  await call('accept', driver);
  await call('cancel');
  await call('cancel');

  assert.equal(posts.length, 2);
  assert.equal(posts[1].amount.value, 10000);
  assert.equal(posts[1].destinationFinancialAccount.id, 'fac-payer');
  assert.equal((await row('ride_payments')).state, 'refunded');
  assert.equal((await row('bookings')).status, 'cancelled');
});

test('pending refund keeps booking until provider completes; cron finishes with browser closed', async () => {
  await call('accept', driver);
  desired.refund = 'pending';

  assert.equal((await call('cancel')).status, 202);
  assert.equal((await row('bookings')).status, 'accepted');

  remote.get('itr-2').status = 'completed';

  await reconcileRide(db, bookingId, provider);

  assert.equal((await row('bookings')).status, 'cancelled');
  assert.equal(posts.length, 2);
});

test('a failed hold never accepts a ride, and can be cancelled without refunding unreceived funds', async () => {
  desired.hold = 'failed';

  await assert.rejects(call('accept', driver), /support review/);
  assert.equal((await row('bookings')).status, 'pending');

  await call('cancel');
  assert.equal(posts.length, 1);
});

test('a failed fee never completes the ride or duplicates the successful driver transfer', async () => {
  await call('accept', driver);
  await call('start', driver);

  desired.fee = 'failed';

  await assert.rejects(call('complete'), /support review/);
  await assert.rejects(call('complete'), /support review/);

  assert.equal(posts.length, 3);
  assert.equal((await row('bookings')).status, 'in_progress');
});

test('unknown provider outcome is quarantined and never retried as another POST', async () => {
  await prepare(driver);
  let count = 0;

  await assert.rejects(
    runLeg(db, bookingId, 'hold', async () => {
      count++;
      throw new Error('timeout');
    }),
    /timeout/
  );

  await runLeg(db, bookingId, 'hold', async () => {
    count++;
  });

  assert.equal(count, 1);

  assert.equal(
    (await pg.query('select status from ride_payment_transfers')).rows[0].status,
    'review_required'
  );
});

test('mismatched provider receipt cannot mark the ride as escrow funded', async () => {
  await prepare(driver);

  await assert.rejects(
    runLeg(db, bookingId, 'hold', async () => ({
      id: 'itr-wrong',
      status: 'completed',
      amount: { currency: 'SLE', value: 1 }
    })),
    /verification/
  );

  assert.equal((await row('bookings')).status, 'pending');
});

test('unauthorized start, release, cancel and driver impersonation are rejected', async () => {
  await call('accept', driver);

  await assert.rejects(call('start', other), /assigned driver/);
  await assert.rejects(call('complete', other), /customer/);
  await assert.rejects(call('cancel', other), /customer/);
  await assert.rejects(call('complete'), /started/);

  await call('start', driver);
  await assert.rejects(call('cancel'), /unstarted/);
});

test('frozen customer and unapproved merchant cannot be debited', async () => {
  await pg.query(
    'update profiles set is_wallet_frozen=true where id=$1',
    [rider]
  );

  await assert.rejects(call('accept', driver), /frozen/);

  await pg.query(
    "update profiles set is_wallet_frozen=false,role='merchant',kyc_status='submitted' where id=$1",
    [rider]
  );

  await assert.rejects(call('accept', driver), /approval/);
  assert.equal(posts.length, 0);
});

test('penny rounding conserves the held fare and safely skips a zero fee', async () => {
  await pg.query(
    "update bookings set fare_amount=0.01,vehicle_type='bike' where id=$1",
    [bookingId]
  );

  await call('accept', driver);
  await call('start', driver);
  await call('complete');

  assert.deepEqual(posts.map(p => p.amount.value), [1, 1]);
  assert.equal((await row('bookings')).status, 'completed');
});

test('legacy accepted rides without a ledger cannot be re-debited or paid blindly', async () => {
  await pg.query(
    "update bookings set status='accepted',driver_id=$1 where id=$2",
    [driver, bookingId]
  );

  await assert.rejects(call('accept', driver), /existing ride/);
  await assert.rejects(call('complete'), /ledger is missing/);
  assert.equal(posts.length, 0);
});

test('browser cannot directly update statuses, fares, driver IDs or payment journal', async () => {
  await pg.exec('set role authenticated;');

  try {
    await pg.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [rider]
    );

    for (const update of [
      "status='completed'",
      'fare_amount=1',
      `driver_id='${other}'`
    ]) {
      await assert.rejects(
        pg.query(`update bookings set ${update} where id=$1`, [bookingId]),
        /authenticated backend/
      );
    }

    await assert.rejects(
      pg.query('select * from ride_payment_transfers'),
      /permission denied/
    );

    await assert.rejects(
      pg.query(
        'select prepare_ride_payment($1,$2,$3)',
        [bookingId, driver, 'accept']
      ),
      /permission denied/
    );

    await assert.rejects(
      pg.query(
        'insert into bookings(id,rider_id,status,fare_amount) values(gen_random_uuid(),$1,$2,100)',
        [other, 'pending']
      ),
      /own pending/
    );

    await assert.rejects(
      pg.query(
        'insert into bookings(id,rider_id,status,fare_amount) values(gen_random_uuid(),$1,$2,1)',
        [rider, 'pending']
      ),
      /minimum/
    );
  } finally {
    await pg.exec('reset role;');
  }
});

test('payment APIs require POST and a valid authenticated session', async () => {
  await assert.rejects(
    authorize({ method: 'GET', headers: {} }, 'read', { db }),
    /Method not allowed/
  );

  await assert.rejects(
    authorize({ method: 'POST', headers: {} }, 'read', { db }),
    /Sign in/
  );

  await assert.rejects(
    authorize({
      method: 'POST',
      headers: { authorization: 'Bearer invalid' }
    }, 'read', {
      db: {
        auth: {
          getUser: async () => ({
            error: new Error('invalid'),
            data: null
          })
        }
      },
    }),
    /session expired/
  );
});

test('wallet frozen between intent creation and the hold prevents the debit', async () => {
  await prepare(driver);

  await pg.query(
    'update wallets set is_frozen=true where user_id=$1',
    [rider]
  );

  await assert.rejects(
    runLeg(db, bookingId, 'hold', provider),
    /unfrozen/
  );

  assert.equal(posts.length, 0);
});

test('out-of-order transfer observations never regress completed status', async () => {
  await prepare(driver);

  const settled = await runLeg(db, bookingId, 'hold', provider);

  const later = await rpc(db, 'record_ride_transfer', {
    p_booking_id: bookingId,
    p_kind: 'hold',
    p_provider_id: settled.provider_id,
    p_status: 'pending',
    p_error: null
  });

  assert.equal(later.status, 'completed');
});

test('pending escrow cannot be cancelled or released before its outcome is known', async () => {
  desired.hold = 'processing';
  await call('accept', driver);

  await assert.rejects(call('cancel'), /funding is processing/);
  await assert.rejects(call('complete'), /started/);

  assert.equal(posts.length, 1);
});

test('unattempted escrow intent can be safely cancelled without a debit', async () => {
  await prepare(driver);
  await call('cancel');
  await reconcileRide(db, bookingId, provider);

  assert.equal(posts.length, 0);
  assert.equal((await row('bookings')).status, 'cancelled');
});

test('booking update failure after successful hold never creates a second debit', async () => {
  await prepare(driver);
  let fail = true;

  const unreliableDb = {
    ...db,
    async rpc(name, args) {
      if (name === 'finalize_ride_payment' && fail) {
        fail = false;
        return { error: new Error('database disconnected') };
      }

      return db.rpc(name, args);
    }
  };

  await assert.rejects(
    reconcileRide(unreliableDb, bookingId, provider),
    /storage is unavailable/
  );

  assert.equal((await row('bookings')).status, 'pending');

  await reconcileRide(unreliableDb, bookingId, provider);

  assert.equal((await row('bookings')).status, 'accepted');
  assert.equal(posts.length, 1);
});

test('revoked driver approval blocks trip start after escrow is funded', async () => {
  await call('accept', driver);

  await pg.query(
    "update profiles set kyc_status='rejected' where id=$1",
    [driver]
  );

  await assert.rejects(call('start', driver), /Driver approval/);

  await call('cancel');
  assert.equal((await row('bookings')).status, 'cancelled');
});

test('shared escrow and fee account retains 15% without attempting a self-transfer', async () => {
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-escrow';

  await call('accept', driver);
  await call('start', driver);

  const completed = await call('complete');
  await call('complete');

  assert.equal(completed.status, 200);
  assert.equal(completed.body.payment.platformFeeMode, 'retained');
  assert.equal(completed.body.payment.platformFee, 15);

  assert.deepEqual(posts.map(p => p.amount.value), [10000, 8500]);
  assert.equal(posts.length, 2);

  assert.ok(
    posts.every(
      p => p.sourceFinancialAccount.id !== p.destinationFinancialAccount.id
    )
  );

  assert.equal((await row('ride_payments')).state, 'released');

  assert.equal(
    (await pg.query(
      "select count(*) as n from ride_payment_transfers where kind='fee'"
    )).rows[0].n,
    0
  );
});

test('shared platform account refunds the full held fare before the trip starts', async () => {
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-escrow';

  await call('accept', driver);
  await call('cancel');

  assert.deepEqual(posts.map(p => p.amount.value), [10000, 10000]);
  assert.equal(posts[1].sourceFinancialAccount.id, 'fac-escrow');
  assert.equal(posts[1].destinationFinancialAccount.id, 'fac-payer');
  assert.equal((await row('ride_payments')).state, 'refunded');
});

test('shared platform account completes pending driver payment through reconciliation', async () => {
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-escrow';

  await call('accept', driver);
  await call('start', driver);

  desired.driver = 'pending';

  assert.equal((await call('complete')).status, 202);

  remote.get('itr-2').status = 'completed';

  await reconcileRide(db, bookingId, provider);

  assert.equal((await row('bookings')).status, 'completed');
  assert.equal(posts.length, 2);
});

test('updated SQL safely upgrades an already-installed separate-account constraint', async () => {
  await pg.exec(
    'alter table ride_payments add constraint old_platform_accounts_distinct check (escrow_account <> fee_account)'
  );

  await pg.exec(await readFile(
    new URL('../supabase/migrations/20261011130000_backend_ride_payments.sql', import.meta.url),
    'utf8'
  ));

  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-escrow';

  await call('accept', driver);

  assert.equal(
    (await row('ride_payments')).escrow_account,
    (await row('ride_payments')).fee_account
  );
});

test('confirmed receipts move simulated balances: customer debit, driver credit and retained fee', async () => {
  process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID = 'fac-escrow';

  await call('accept', driver);

  assert.equal(balances.get('fac-payer'), 0);
  assert.equal(balances.get('fac-escrow'), 10000);
  assert.equal(balances.get('fac-driver'), 0);

  await call('start', driver);

  const result = await call('complete');

  assert.equal(result.body.payment.settled, true);
  assert.equal(result.body.payment.driverAccountId, 'fac-driver');

  assert.equal(
    result.body.payment.transfers.find(t => t.kind === 'driver').transferId,
    'itr-2'
  );

  assert.equal(balances.get('fac-driver'), 8500);
  assert.equal(balances.get('fac-escrow'), 1500);

  await call('complete');

  assert.equal(balances.get('fac-payer'), 0);
  assert.equal(balances.get('fac-driver'), 8500);
});

test('pending driver credit never reports payment success or trip completion', async () => {
  await call('accept', driver);
  await call('start', driver);

  desired.driver = 'processing';

  const result = await call('complete');

  assert.equal(result.status, 202);
  assert.equal(result.body.success, false);
  assert.equal(result.body.payment.settled, false);
  assert.equal(balances.get('fac-driver'), 0);
  assert.equal((await row('bookings')).status, 'in_progress');

  remote.get('itr-2').status = 'completed';

  const finished = await call('complete');

  assert.equal(finished.body.payment.settled, true);
  assert.equal(balances.get('fac-driver'), 8500);
});

test('completed legacy booking is never treated as a paid ride or automatically debited', async () => {
  await pg.query(
    "update bookings set status='completed',driver_id=$1 where id=$2",
    [driver, bookingId]
  );

  await assert.rejects(call('complete'), /Escrow ledger/);

  const result = await call('status');

  assert.equal(result.body.success, false);
  assert.equal(result.body.payment, null);
  assert.equal(posts.length, 0);
});

test('receipt status is available only to booking participants, and browser driver IDs are ignored', async () => {
  await call('accept', driver);

  await assert.rejects(call('status', other), /another customer/);

  const result = await call('status', rider, {
    driverId: other,
    driverAccountId: 'fac-other'
  });

  assert.equal(result.body.payment.driverAccountId, 'fac-driver');
  assert.equal(result.body.payment.holdConfirmed, true);
});

test('insufficient provider funds cannot accept a trip or create a driver credit', async () => {
  balances.set('fac-payer', 0);

  await assert.rejects(call('accept', driver), /support review/);

  assert.equal((await row('bookings')).status, 'pending');
  assert.equal(balances.get('fac-driver'), 0);
});

test('wallet account link SQL supports verified metadata links and rejects reassignment by a browser', async () => {
  await pg.exec('grant update on wallets to authenticated;');

  await pg.exec(
    `set role authenticated; set request.jwt.claim.sub='${rider}';`
  );

  await assert.rejects(
    pg.query(
      'update wallets set monime_account_id=$1 where user_id=$2',
      ['fac-other', rider]
    ),
    /require the backend/
  );

  await assert.rejects(
    pg.query("select link_matmove_wallet($1,'SLE','fac-other')", [rider]),
    /permission denied/
  );

  await pg.exec('reset role;');

  await pg.query(
    "select link_matmove_wallet($1,'SLE','fac-linked')",
    [rider]
  );

  const result = (
    await pg.query('select * from wallets where user_id=$1', [rider])
  ).rows[0];

  assert.equal(result.monime_account_id, 'fac-linked');
  assert.equal(result.metadata.monime_account_id, 'fac-linked');
});

test('wallet account changes are blocked while escrow obligations exist', async () => {
  await call('accept', driver);

  await assert.rejects(
    pg.query(
      "select link_matmove_wallet($1,'SLE','fac-replacement')",
      [driver]
    ),
    /Reconcile active ride/
  );
});

test('wallet-link migration safely backfills a legacy metadata-only account', async () => {
  await pg.query(
    "update wallets set monime_account_id=null,metadata=jsonb_build_object('monime_account_id','fac-payer') where user_id=$1",
    [rider]
  );

  await pg.exec(await readFile(
    new URL('../supabase/migrations/20261012120000_wallet_account_links.sql', import.meta.url),
    'utf8'
  ));

  const wallet = (
    await pg.query(
      'select monime_account_id from wallets where user_id=$1',
      [rider]
    )
  ).rows[0];

  assert.equal(wallet.monime_account_id, 'fac-payer');
});

test('the supplied combined SQL setup and diagnostics execute successfully on the matching schema', async () => {
  await pg.exec(await readFile(
    new URL('../docs/PAYMENT_DATABASE_SETUP.sql', import.meta.url),
    'utf8'
  ));

  await call('accept', driver);
  await call('start', driver);

  const result = await call('complete');

  assert.equal(result.body.payment.settled, true);
});