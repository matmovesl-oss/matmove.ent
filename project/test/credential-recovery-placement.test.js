import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('password recovery appears only on sign-in and passcode recovery only on the passcode lock', async () => {
  const auth = await readFile('src/pages/AuthPages.tsx', 'utf8');
  const lock = await readFile('src/components/CustomerPasscode.tsx', 'utf8');
  const login = auth.slice(auth.indexOf('export function LoginPage'), auth.indexOf('export function SignupPage'));

  assert.match(login, /Forgot password\\?/);
  assert.doesNotMatch(login, /Forgot passcode\\?/);
  assert.match(login, /navigate\\('\\/forgot-password'\\)/);
  assert.doesNotMatch(login, /navigate\\('\\/forgot-passcode'\\)/);
  assert.match(lock, /Forgot passcode\\?/);
  assert.match(lock, /next=%2Freset-passcode/);
});
