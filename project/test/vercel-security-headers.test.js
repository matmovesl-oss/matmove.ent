import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all routes receive baseline browser security headers', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(config.headers), 'vercel.json must define global response headers');
  const route = config.headers.find(item => item.source === '/(.*)');
  assert.ok(route, 'security headers must apply to every path');
  const actual = Object.fromEntries(route.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(actual['x-content-type-options'], 'nosniff');
  assert.equal(actual['x-frame-options'], 'DENY');
  assert.equal(actual['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(actual['strict-transport-security'], /^max-age=31536000/);
  assert.match(actual['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(actual['content-security-policy'], /object-src 'none'/);
  assert.equal(actual['permissions-policy'], 'geolocation=(self), camera=(self), microphone=()');
});
