import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import handler, { createRidePaymentsHandler } from '../server/ride-api.js';

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const aliases = {
  '/api/cancel-ride': 'cancel',
  '/api/reconcile-ride-payments': 'reconcile',
};

test('new cancellation and recovery URLs rewrite to the existing API before filesystem and SPA fallback', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const filesystemIndex = config.routes.findIndex(route => route.handle === 'filesystem');
  for (const [path, action] of Object.entries(aliases)) {
    for (const suffix of ['', '/']) {
      const index = config.routes.findIndex(route => route.src && new RegExp(`^${route.src}`, 'i').test(path + suffix));
      assert.ok(index >= 0 && index < filesystemIndex);
      assert.equal(config.routes[index].dest, `/api/accept-ride-escrow?action=${action}`);
    }
  }
  assert.equal(config.routes[filesystemIndex + 1].status, 404);
  assert.equal(config.routes.at(-1).dest, '/index.html');
});

test('exactly the twelve original API filenames remain, with no new API entry', async () => {
  const files = await readdir(new URL('../api/', import.meta.url));
  assert.deepEqual(files.sort(), [
    'accept-ride-escrow.ts', 'start-ride.ts', 'complete-ride-payout.ts',
    'create-monime-checkout.js', 'create-monime-payout.js', 'create-monime-transfer.js',
    'create-monime-wallet.js', 'create-usd-wallet.js', 'create-wallet-payment-code.js',
    'get-live-wallet.js', 'monime-return.js', 'monime-webhook.js',
  ].sort());

  const entry = await readFile(new URL('../api/accept-ride-escrow.ts', import.meta.url), 'utf8');
  assert.match(entry, /import handler from '\.\.\/server\/ride-api\.js'/);
  assert.match(entry, /export default handler/);

  for (const [file, action] of [
    ['start-ride.ts', 'start'],
    ['complete-ride-payout.ts', 'complete']
  ]) {
    const source = await readFile(new URL(`../api/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`rideAction(req, res, '${action}')`));
    assert.ok(source.includes("protectedWallet('read'"));
  }
});

test('router dispatches each action once, preserving booking body, authentication and pending responses', async () => {
  const seen = [];
  const rideHandlers = Object.fromEntries(
    ['accept', 'start', 'complete', 'cancel'].map(action => [
      action,
      async (req, res) => {
        seen.push(action);
        assert.equal(req.body.bookingId, 'booking-123');
        assert.equal(req.headers.authorization, 'Bearer customer-token');
        return res.status(202).json({ pending: true, action });
      },
    ])
  );

  const router = createRidePaymentsHandler({ rideHandlers });

  for (const action of Object.keys(rideHandlers)) {
    const res = response();
    await router({
      method: 'POST',
      query: { action },
      body: { bookingId: 'booking-123' },
      headers: { authorization: 'Bearer customer-token' }
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.action, action);
    assert.equal(res.body.pending, true);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }

  assert.deepEqual(seen, ['accept', 'start', 'complete', 'cancel']);
});

test('router keeps reconciliation separate from customer operations', async () => {
  let calls = 0;
  const router = createRidePaymentsHandler({
    reconciliation: async (req, res) => {
      calls++;
      assert.equal(req.headers.authorization, 'Bearer scheduler-secret');
      return res.status(200).json({ checked: 0, failed: 0 });
    }
  });

  const res = response();
  await router({
    method: 'GET',
    query: { action: 'reconcile' },
    headers: { authorization: 'Bearer scheduler-secret' }
  }, res);

  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
});

test('duplicate, inherited and unknown actions never enter a payment handler', async () => {
  for (const action of [
    '',
    ['accept', 'reconcile'],
    'toString',
    '__proto__',
    'payout'
  ]) {
    const res = response();

    await handler({
      method: 'POST',
      query: { action },
      headers: {},
      body: { action: 'accept' }
    }, res);

    assert.equal(res.statusCode, 400);
  }
});

test('customer operations require POST and reconciliation requires GET', async () => {
  for (const action of [
    'accept', 'start', 'complete', 'cancel', 'status', 'reconcile'
  ]) {
    const expected = action === 'reconcile' ? 'GET' : 'POST';

    for (const method of [
      'PUT', 'DELETE', 'OPTIONS',
      expected === 'GET' ? 'POST' : 'GET'
    ]) {
      const res = response();
      await handler({ method, query: { action }, headers: {} }, res);
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.Allow, expected);
    }
  }
});

test('reconciliation rejects missing secrets, browser tokens and wrong same-length secrets', async () => {
  const original = process.env.CRON_SECRET;

  try {
    for (const [secret, authorization] of [
      [undefined, 'Bearer'],
      ['scheduler-secret', undefined],
      ['scheduler-secret', 'Bearer customer-token'],
      ['scheduler-secret', 'Bearer incorrect-secret'],
    ]) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;

      const res = response();

      await handler({
        method: 'GET',
        query: { action: 'reconcile' },
        headers: { authorization }
      }, res);

      assert.equal(res.statusCode, 401);
    }
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
});

test('existing acceptance URL defaults to accept without an action query', async () => {
  let calls = 0;

  const router = createRidePaymentsHandler({
    rideHandlers: {
      accept: async (req, res) => {
        calls++;
        assert.equal(req.body.bookingId, 'booking-123');
        return res.status(200).json({ success: true });
      }
    }
  });

  const res = response();

  await router({
    method: 'POST',
    body: { bookingId: 'booking-123' },
    headers: {}
  }, res);

  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
});