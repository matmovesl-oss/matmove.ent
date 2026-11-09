import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMatMovePayments } from '../server/payment-reconciliation.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function env(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('unified payment reconciliation rejects missing, weak and incorrect cron credentials before running workers', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  let calls = 0;
  const workers = {
    rides: async () => { calls++; },
    payouts: async () => { calls++; },
    monime: async () => { calls++; }
  };

  try {
    delete process.env.CRON_SECRET;
    let res = response();
    await reconcileMatMovePayments({ headers: {} }, res, workers);
    assert.equal(res.statusCode, 401);

    process.env.CRON_SECRET = 'short';
    res = response();
    await reconcileMatMovePayments({ headers: { authorization: 'Bearer short' } }, res, workers);
    assert.equal(res.statusCode, 401);

    process.env.CRON_SECRET = secret;
    res = response();
    await reconcileMatMovePayments({ headers: { authorization: 'Bearer wrong-secret' } }, res, workers);
    assert.equal(res.statusCode, 401);
    assert.equal(calls, 0);
  } finally {
    env('CRON_SECRET', previous);
  }
});

test('unified payment reconciliation runs ride, withdrawal and verified Monime inbox workers', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;
  const calls = [];

  try {
    const rides = async (req, res) => {
      calls.push(['rides', req.headers.authorization]);
      return res.status(200).json({ checked: 3, failed: 0 });
    };
    const payouts = async (req, res) => {
      calls.push(['payouts', req.headers.authorization]);
      return res.status(200).json({ checked: 2, failed: 0 });
    };
    const monime = async ({ limit }) => {
      calls.push(['monime', limit]);
      return { checked: 4, processed: 3, retrying: 1, failed: 0 };
    };

    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      { rides, payouts, monime }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.ridePayments, { checked: 3, failed: 0 });
    assert.deepEqual(res.body.withdrawals, { checked: 2, failed: 0 });
    assert.deepEqual(res.body.monimePurchaseEvents, {
      checked: 4, processed: 3, retrying: 1, failed: 0
    });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.filter(x => x[0] !== 'monime').map(x => x[1]), [
      `Bearer ${secret}`,
      `Bearer ${secret}`
    ]);
  } finally {
    env('CRON_SECRET', previous);
  }
});

test('unified reconciliation returns 503 if any money reconciliation worker is unavailable', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;

  try {
    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      {
        rides: async (_req, response) => response.status(503).json({ error: 'Ride reconciliation unavailable.' }),
        payouts: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        monime: async () => ({ checked: 0, processed: 0, retrying: 0, failed: 0 })
      }
    );

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.ridePayments, { error: 'Ride reconciliation unavailable.' });
  } finally {
    env('CRON_SECRET', previous);
  }
});

test('durably quarantined Monime events are reported for review without treating the queue worker as unavailable', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;

  try {
    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      {
        rides: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        payouts: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        monime: async () => ({ checked: 2, processed: 0, retrying: 0, failed: 2 })
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.monimePurchaseEvents.failed, 2);
  } finally {
    env('CRON_SECRET', previous);
  }
});


test('unified reconciliation fails closed when a money worker returns no structured result', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;

  try {
    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      {
        rides: async () => undefined,
        payouts: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        monime: async () => ({ checked: 0, processed: 0, retrying: 0, failed: 0 })
      }
    );

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.ridePayments, { unavailable: true });
  } finally {
    env('CRON_SECRET', previous);
  }
});

test('unified reconciliation fails closed when the Monime worker returns malformed counters', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;

  try {
    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      {
        rides: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        payouts: async (_req, response) => response.status(200).json({ checked: 0, failed: 0 }),
        monime: async () => ({ checked: 'none', processed: 0, retrying: 0, failed: 0 })
      }
    );

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.monimePurchaseEvents, { unavailable: true });
  } finally {
    env('CRON_SECRET', previous);
  }
});
