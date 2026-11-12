import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all routes receive baseline browser security headers before filesystem routing', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(config.routes), 'vercel.json must preserve explicit route handling');
  const route = config.routes.find(item => item.src === '/(.*)');
  assert.ok(route, 'security header rule must apply to every path');
  assert.equal(route.continue, true, 'security header rule must not shadow later API or SPA routes');
  assert.equal(route.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(route.headers['X-Frame-Options'], 'DENY');
  assert.equal(route.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(route.headers['Strict-Transport-Security'], /^max-age=31536000/);
  assert.match(route.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(route.headers['Content-Security-Policy'], /object-src 'none'/);
  assert.equal(route.headers['Permissions-Policy'], 'geolocation=(self), camera=(self), microphone=()');

  const apiRoute = config.routes.find(item => item.src === '/api/(.*)');
  assert.ok(apiRoute, 'API responses must have an explicit no-store rule');
  assert.equal(apiRoute.continue, true, 'API no-store rule must not shadow function routing');
  assert.equal(apiRoute.headers['Cache-Control'], 'no-store');
  assert.equal(apiRoute.headers['Pragma'], 'no-cache');
  assert.equal(apiRoute.headers['Vary'], 'Authorization');
  const apiIndex = config.routes.indexOf(apiRoute);
  const filesystemIndex = config.routes.findIndex(item => item.handle === 'filesystem');
  assert.ok(filesystemIndex >= 0 && apiIndex < filesystemIndex, 'API cache policy must run before filesystem routing');
});
