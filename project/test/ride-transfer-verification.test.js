import test from 'node:test';
import assert from 'node:assert/strict';
import { runLeg } from '../server/ride-payments.js';

const bookingId = '00000000-0000-4000-8000-000000000010';
const legTemplate = {
  status: 'pending',
  can_create: true,
  provider_id: null,
  request_key: 'matmove-ride-hold-request-key',
  amount_minor: 10000,
  source_account: 'fac-payer',
  destination_account: 'fac-escrow'
};

function makeDb(leg = {}) {
  const calls = [];
  const current = { ...legTemplate, ...leg };
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'claim_ride_transfer') {
        return { data: current, error: null };
      }
      if (name === 'record_ride_transfer') {
        current.status = args.p_status;
        current.provider_id = args.p_provider_id || current.provider_id;
        current.can_create = false;
        return { data: current, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  return { db, calls, leg: current };
}

function receipt(overrides = {}) {
  return {
    id: 'itr-ride-test-1',
    status: 'completed',
    amount: { currency: 'SLE', value: 10000 },
    sourceFinancialAccount: { id: 'fac-payer' },
    destinationFinancialAccount: { id: 'fac-escrow' },
    ...overrides
  };
}

test('ride hold sends one idempotent POST for the server-recorded fare and account pair', async () => {
  const { db, calls } = makeDb();
  const providerCalls = [];
  const provider = async (path, options) => {
    providerCalls.push({ path, options });
    assert.equal(path, 'internal-transfers');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Idempotency-Key'], legTemplate.request_key);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.amount, { currency: 'SLE', value: 10000 });
    assert.deepEqual(body.sourceFinancialAccount, { id: 'fac-payer' });
    assert.deepEqual(body.destinationFinancialAccount, { id: 'fac-escrow' });
    assert.equal(body.metadata.bookingId, bookingId);
    assert.equal(body.metadata.leg, 'hold');
    return receipt();
  };

  await runLeg(db, bookingId, 'hold', provider);

  assert.equal(providerCalls.length, 1);
  assert.deepEqual(calls.at(-1), {
    name: 'record_ride_transfer',
    args: {
      p_booking_id: bookingId,
      p_kind: 'hold',
      p_provider_id: 'itr-ride-test-1',
      p_status: 'completed',
      p_error: null
    }
  });
});

test('ride transfer receipt amount, currency, source and destination must all match', async () => {
  const mismatches = [
    receipt({ amount: { currency: 'SLE', value: 9999 } }),
    receipt({ amount: { currency: 'USD', value: 10000 } }),
    receipt({ sourceFinancialAccount: { id: 'fac-attacker' } }),
    receipt({ destinationFinancialAccount: { id: 'fac-other' } }),
    receipt({ status: 'cancelled' })
  ];

  for (const remote of mismatches) {
    const { db, calls } = makeDb();
    let posts = 0;
    await assert.rejects(
      () => runLeg(db, bookingId, 'hold', async (_path, options) => {
        posts++;
        assert.equal(options.method, 'POST');
        return remote;
      }),
      /verification needs support review/i
    );
    assert.equal(posts, 1);
    assert.equal(calls.at(-1).name, 'record_ride_transfer');
    assert.equal(calls.at(-1).args.p_status, 'review_required');
    assert.equal(calls.at(-1).args.p_provider_id, null);
  }
});

test('a previously recorded Monime transfer ID is retrieved with GET, never created again', async () => {
  const { db, calls } = makeDb({
    can_create: false,
    provider_id: 'itr-existing-ride'
  });
  const providerCalls = [];
  const provider = async (path, options) => {
    providerCalls.push({ path, options });
    assert.equal(options, undefined);
    return receipt({ id: 'itr-existing-ride' });
  };

  await runLeg(db, bookingId, 'hold', provider);

  assert.deepEqual(providerCalls, [{
    path: 'internal-transfers/itr-existing-ride',
    options: undefined
  }]);
  assert.equal(calls.at(-1).args.p_provider_id, 'itr-existing-ride');
  assert.equal(calls.at(-1).args.p_status, 'completed');
});

test('pending provider status is recorded as pending and does not imply escrow funding', async () => {
  const { db, calls } = makeDb();
  await runLeg(db, bookingId, 'hold', async () =>
    receipt({ status: 'processing' })
  );

  assert.equal(calls.at(-1).args.p_status, 'processing');
  assert.equal(calls.at(-1).args.p_provider_id, 'itr-ride-test-1');
});

test('an uncertain provider POST is marked review-required and is never blindly retried', async () => {
  const { db, calls } = makeDb();
  let posts = 0;
  await assert.rejects(
    () => runLeg(db, bookingId, 'hold', async () => {
      posts++;
      throw new Error('Provider timeout after possible acceptance');
    }),
    /Provider timeout/
  );
  assert.equal(posts, 1);
  assert.equal(calls.at(-1).args.p_status, 'review_required');
  assert.equal(calls.at(-1).args.p_provider_id, null);

  const later = await runLeg(db, bookingId, 'hold', async () => {
    posts++;
    throw new Error('Should not create another transfer');
  });
  assert.equal(posts, 1);
  assert.equal(later.status, 'review_required');
});

test('terminal transfer legs are read-only and make no provider request', async () => {
  for (const status of ['completed', 'failed', 'review_required']) {
    const { db, calls } = makeDb({ status });
    let providerCalls = 0;
    const result = await runLeg(db, bookingId, 'hold', async () => {
      providerCalls++;
      throw new Error('Terminal transfer must not call Monime');
    });
      assert.equal(result.status, status);
    assert.equal(providerCalls, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'claim_ride_transfer');
  }
});
