import { readFile } from 'node:fs/promises';
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

const okHandler = async (_req, res) => res.status(200).json({ checked: 0, failed: 0 });
const defaultWorkers = () => ({
  rides: okHandler,
  payouts: okHandler,
  merchants: okHandler,
  referrals: okHandler,
  spins: okHandler,
  arcades: okHandler,
  monime: async () => ({ checked: 0, processed: 0, retrying: 0, failed: 0 }),
  purchases: async () => ({ checked: 0, processed: 0, retrying: 0, failed: 0 })
});

test('unified payment reconciliation rejects missing, weak and incorrect cron credentials before running workers', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  let calls = 0;
  const workers = Object.fromEntries(Object.entries(defaultWorkers()).map(([key, fn]) => [
    key, async (...args) => { calls++; return fn(...args); }
  ]));

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

test('unified scheduler runs ride, withdrawal, merchant, referral, game, webhook and purchase reconciliation', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'matmove-reconcile-test-secret-with-at-least-32-characters';
  process.env.CRON_SECRET = secret;
  const calls = [];
  try {
    const handler = name => async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      calls.push([name, req.method, req.headers.authorization, req.query?.action || null]);
      const counts = { rides: 3, payouts: 2, merchants: 6, referrals: 1, spins: 2, arcades: 4 };
      return res.status(200).json({ checked: counts[name], failed: 0 });
    };
    const monime = async ({ limit }) => {
      calls.push(['monime', limit]);
      return { checked: 4, processed: 3, retrying: 1, failed: 0 };
    };
    const purchases = async ({ limit }) => {
      calls.push(['purchases', limit]);
      return { checked: 1, processed: 1, retrying: 0, failed: 0 };
    };
    const res = response();
    await reconcileMatMovePayments(
      { headers: { authorization: `Bearer ${secret}` } },
      res,
      {
        rides: handler('rides'), payouts: handler('payouts'), merchants: handler('merchants'),
        referrals: handler('referrals'), spins: handler('spins'), arcades: handler('arcades'),
        monime, purchases
      }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.ridePayments, { checked: 3, failed: 0 });
    assert.deepEqual(res.body.withdrawals, { checked: 2, failed: 0 });
    assert.deepEqual(res.body.merchantPayments, { checked: 6, failed: 0 });
    assert.deepEqual(res.body.referrals, { checked: 1, failed: 0 });
    assert.deepEqual(res.body.spinPayments, { checked: 2, failed: 0 });
    assert.deepEqual(res.body.arcadePayments, { checked: 4, failed: 0 });
    assert.deepEqual(res.body.monimeEvents, { checked: 4, processed: 3, retrying: 1, failed: 0 });
    assert.deepEqual(res.body.purchasePayments, { checked: 1, processed: 1, retrying: 0, failed: 0 });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(calls.length, 8);
    assert.equal(calls.find(x => x[0] === 'referrals')[3], 'referral_reconcile');
    assert.deepEqual(calls.filter(x => ['rides','payouts','merchants','referrals','spins','arcades'].includes(x[0])).map(x => x[1]), Array(6).fill('GET'));
    assert.deepEqual(calls.filter(x => ['rides','payouts','merchants','referrals','spins','arcades'].includes(x[0])).map(x => x[2]), Array(6).fill(`Bearer ${secret}`));
    assert.equal(calls.find(x => x[0] === 'monime')[1], 3);
    assert.equal(calls.find(x => x[0] === 'purchases')[1], 5);
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
      { ...defaultWorkers(), rides: async (_req, out) => out.status(503).json({ error: 'Ride reconciliation unavailable.' }) }
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.ridePayments, { unavailable: true });
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
      { ...defaultWorkers(), monime: async () => ({ checked: 2, processed: 0, retrying: 0, failed: 2 }) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.monimeEvents.failed, 2);
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
      { ...defaultWorkers(), rides: async () => undefined }
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
      { ...defaultWorkers(), monime: async () => ({ checked: 'none', processed: 0, retrying: 0, failed: 0 }) }
    );
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
    assert.deepEqual(res.body.monimeEvents, { unavailable: true });
  } finally {
    env('CRON_SECRET', previous);
  }
});

test('Hobby-compatible Vercel daily cron targets the unified payment reconciler', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons, [{ path: '/api/reconcile-all-payments', schedule: '0 0 * * *' }]);
});
