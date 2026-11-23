import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/lib/apiFetch.ts', import.meta.url), 'utf8');
const driver = readFileSync(new URL('../src/pages/DriverDashboard.tsx', import.meta.url), 'utf8');
const merchant = readFileSync(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');

test('wallet API fetch has a bounded request timeout and aborts the network request', () => {
  assert.match(api, /new AbortController\(\)/);
  assert.match(api, /setTimeout\(\(\) => controller\.abort\(\), 30_000\)/);
  assert.match(api, /signal:\s*controller\.signal/);
  assert.match(api, /window\.clearTimeout\(timeout\)/);
});

test('a timed-out wallet request keeps its idempotency reference for safe retry', () => {
  assert.match(api, /sessionStorage\.setItem\(storageKey, key\)/);
  assert.match(api, /MatMove kept the same request reference/);
  const catchStart = api.indexOf('} catch (requestError) {');
  const finallyStart = api.indexOf('} finally {', catchStart);
  assert.ok(catchStart >= 0 && finallyStart > catchStart);
  assert.doesNotMatch(api.slice(catchStart, finallyStart), /sessionStorage\.removeItem/);
});

for (const [name, source, role] of [
  ['Driver', driver, 'driver'],
  ['Merchant', merchant, 'merchant'],
]) {
  test(name + ' wallet balance uses Realtime and a 30 second visible-tab recovery poll', () => {
    assert.ok(source.includes(".channel('" + role + "-wallet-balance:' + profile.id)"));
    assert.match(source, /table:\s*'wallets'/);
    assert.match(source, /window\.setInterval\(refresh, 30_000\)/);
    assert.doesNotMatch(source, /window\.setInterval\(refresh, 10000\)/);
  });

  test(name + ' wallet balance refreshes on visibility, focus and network reconnect', () => {
    assert.match(source, /document\.addEventListener\('visibilitychange', refresh\)/);
    assert.match(source, /window\.addEventListener\('focus', refresh\)/);
    assert.match(source, /window\.addEventListener\('online', refresh\)/);
    assert.match(source, /window\.removeEventListener\('online', refresh\)/);
    assert.match(source, /supabase\.removeChannel\(channel\)/);
  });
}
