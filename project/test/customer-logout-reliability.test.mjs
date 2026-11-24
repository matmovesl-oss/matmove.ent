import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer logout failure stays in the app and preserves recovery state', async () => {
  const [app, packageJson] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const start = app.indexOf('const handleLogout = async () =>');
  const end = app.indexOf('const fetchUserData =', start);
  assert.ok(start >= 0 && end > start, 'logout handler should be present');

  const handler = app.slice(start, end);
  assert.match(handler, /setLogoutError\(''\)/, 'a new attempt clears the previous error');
  assert.match(handler, /setLogoutError\(message\.trim\(\) \|\|/, 'a failure is retained in React state');
  assert.doesNotMatch(handler, /\balert\s*\(/, 'logout must not open a blocking browser alert');
  assert.ok(
    handler.indexOf('if (error) throw error;') < handler.indexOf("localStorage.removeItem('matmove_last_active')"),
    'saved customer state is cleared only after Supabase confirms sign-out',
  );
  assert.match(app, /logoutError && <p role="alert"/, 'the error is announced accessibly in the app');

  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts.build, /test\/customer-logout-reliability\.test\.mjs/);
  assert.match(scripts['test:release'], /test\/customer-logout-reliability\.test\.mjs/);
});
