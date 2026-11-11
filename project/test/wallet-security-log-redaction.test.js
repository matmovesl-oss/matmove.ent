import test from 'node:test';
import assert from 'node:assert/strict';
import { monime } from '../server/wallet-security.js';

test('Monime failure logs redact response bodies and dynamic account identifiers', async () => {
  const keys = ['MONIME_API_KEY', 'MONIME_SPACE_ID', 'MONIME_ENVIRONMENT', 'VERCEL_ENV'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const logs = [];

  process.env.MONIME_API_KEY = 'mon_test_logging_fixture';
  process.env.MONIME_SPACE_ID = 'spc-test';
  process.env.MONIME_ENVIRONMENT = 'test';
  delete process.env.VERCEL_ENV;

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.monime.io/v1/financial-accounts/fac-sensitive?withBalance=true');
    assert.equal(options.headers.Authorization, 'Bearer mon_test_logging_fixture');
    return {
      ok: false,
      status: 422,
      headers: new Headers({ 'Monime-Request-Id': 'req_test_123' }),
      async json() {
        return {
          success: false,
          error: {
            code: 'invalid_payment',
            reason: 'invalid_state',
            message: 'Provider diagnostic fixture',
            details: {
              financialAccountId: 'fac-sensitive',
              payerPhone: '+23276123456',
              transactionMemo: 'private-payer-marker'
            }
          }
        };
      }
    };
  };
  console.error = (...args) => logs.push(args);

  try {
    await assert.rejects(
      () => monime('financial-accounts/fac-sensitive?withBalance=true'),
      error => error.status === 422 && error.message === 'Provider diagnostic fixture'
    );

    assert.equal(logs.length, 1);
    const serialized = JSON.stringify(logs[0]);
    assert.match(serialized, /req_test_123/);
    assert.match(serialized, /financial-accounts/);
    assert.match(serialized, /invalid_payment/);
    assert.doesNotMatch(serialized, /fac-sensitive|\+23276123456|private-payer-marker|Provider diagnostic fixture|mon_test_logging_fixture/);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    for (const key of keys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
