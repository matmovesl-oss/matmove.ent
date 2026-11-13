import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the only visible recovery link is Forgot passcode on the customer passcode screen', async () => {
  const [auth, app, lock] = await Promise.all([
    readFile('src/pages/AuthPages.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/components/CustomerPasscode.tsx', 'utf8')
  ]);
  const login = auth.slice(auth.indexOf('export function LoginPage'), auth.indexOf('export function SignupPage'));
  const signup = auth.slice(auth.indexOf('export function SignupPage'), auth.indexOf('function GoogleButton'));

  assert.ok(!login.includes('Forgot password?'));
  assert.ok(!login.includes('Forgot passcode?'));
  assert.ok(!signup.includes('Forgot password?'));
  assert.ok(!signup.includes('Forgot passcode?'));
  assert.ok(lock.includes('Forgot passcode?'));
  assert.ok(!lock.includes('Forgot password?'));
  assert.ok(lock.includes('requestPasscodeReset(resetEmail)'));
  assert.ok(!app.includes('path="/forgot-password"'));
  assert.ok(!app.includes('path="/forgot-passcode"'));
  assert.ok(app.includes('path="/reset-password"'));
});
