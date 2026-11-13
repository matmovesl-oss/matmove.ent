import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/monime-return.js';

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    redirect(...args) { this.redirectArgs = args; return this; }
  };
}

test('Monime success return is navigation only and never claims payment was verified', () => {
  const res = response();
  handler({ query: { role: 'rider', status: 'success' } }, res);

  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.redirectArgs, [303, '/customer/rider?payment=returned']);
  assert.equal(res.body, undefined);
});

test('Monime return ignores arbitrary roles and never trusts the status query string', () => {
  for (const role of ['admin', '../admin', 'owner', ['rider']]) {
    const res = response();
    handler({ query: { role, status: 'success' } }, res);
    assert.deepEqual(res.redirectArgs, [303, '/customer?payment=returned']);
  }
});
