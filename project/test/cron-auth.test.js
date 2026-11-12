import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSpins } from '../server/spin-payments.js';
import { reconcileArcades } from '../server/arcade-payments.js';
import { createReferralApi } from '../server/referral-api.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('spin and arcade reconciliation reject absent, weak and overlong cron secrets before any database work', async () => {
  const previous = process.env.CRON_SECRET;
  const values = [undefined, '', 'short', 'x'.repeat(31), 'x'.repeat(257)];
  try {
    for (const secret of values) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      const authorization = secret === undefined ? 'Bearer undefined' : `Bearer ${secret}`;
      for (const reconcile of [reconcileSpins, reconcileArcades]) {
        const res = response();
        await reconcile({ method: 'GET', headers: { authorization } }, res);
        assert.equal(res.statusCode, 401, 'weak or missing scheduler secret must not authorize a worker');
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('referral reconciliation rejects absent, weak and overlong cron secrets before calling its worker', async () => {
  let workerCalls = 0;
  const cases = [
    { env: {}, authorization: 'Bearer undefined' },
    { env: { CRON_SECRET: '' }, authorization: 'Bearer ' },
    { env: { CRON_SECRET: 'short' }, authorization: 'Bearer short' },
    { env: { CRON_SECRET: 'x'.repeat(31) }, authorization: `Bearer ${'x'.repeat(31)}` },
    { env: { CRON_SECRET: 'x'.repeat(257) }, authorization: `Bearer ${'x'.repeat(257)}` },
    { env: { CRON_SECRET: 'x'.repeat(32) }, authorization: 'Bearer wrong' }
  ];

  for (const item of cases) {
    const api = createReferralApi({
      env: item.env,
      database: () => { throw new Error('database must not be accessed before cron authentication'); },
      reconcile: async () => { workerCalls++; return { checked: 0, failed: 0 }; }
    });
    const res = response();
    await api.reconcile({
      method: 'GET',
      query: { action: 'referral_reconcile' },
      headers: { authorization: item.authorization }
    }, res);
    assert.equal(res.statusCode, 401);
  }

  assert.equal(workerCalls, 0);
});
