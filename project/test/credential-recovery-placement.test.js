import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('account password recovery is on sign-in while passcode recovery stays on the passcode screen', async () => {
  const [auth, app, lock] = await Promise.all([
    readFile('src/pages/AuthPages.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/components/CustomerPasscode.tsx', 'utf8')
  ]);
  const login = auth.slice(auth.indexOf('export function LoginPage'), auth.indexOf('export function SignupPage'));
  const signup = auth.slice(auth.indexOf('export function SignupPage'), auth.indexOf('function GoogleButton'));

  assert.ok(login.includes('Forgot password?'));
  assert.ok(login.includes('resetPassword(email)'));
  assert.ok(login.includes('If an account exists for this email'));
  assert.ok(login.includes('resetBusy || busy || loading'));
  assert.ok(!login.includes('Forgot passcode?'));
  assert.ok(!signup.includes('Forgot password?'));
  assert.ok(!signup.includes('Forgot passcode?'));
  assert.ok(lock.includes('Forgot passcode?'));
  assert.ok(!lock.includes('Forgot password?'));
  assert.ok(lock.includes('requestPasscodeReset(resetEmail)'));
  assert.ok(!app.includes('path="/forgot-password"'));
  assert.ok(!app.includes('path="/forgot-passcode"'));
  assert.ok(app.includes('path="/reset-password"'));
  const recovery = await readFile('src/pages/UpdatePassword.tsx', 'utf8');
  assert.ok(recovery.includes("type RecoveryMode = 'password' | 'passcode'"));
  assert.ok(recovery.includes("supabase.auth.updateUser({ password })"));
  assert.ok(recovery.includes("navigate('/login', { replace: true })"));
  assert.ok(recovery.includes('password.length < 8'));
  assert.ok(recovery.includes('recoveryReady'));
});
