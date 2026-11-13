import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('password recovery appears only on sign-in and passcode recovery only on the passcode lock', async () => {
  const auth = await readFile('src/pages/AuthPages.tsx', 'utf8');
  const lock = await readFile('src/components/CustomerPasscode.tsx', 'utf8');
  const login = auth.slice(auth.indexOf('export function LoginPage'), auth.indexOf('export function SignupPage'));

  assert.ok(login.includes('Forgot password?'));
  assert.ok(!login.includes('Forgot passcode?'));
  assert.ok(login.includes("navigate('/forgot-password')"));
  assert.ok(!login.includes("navigate('/forgot-passcode')"));
  assert.ok(lock.includes('Forgot passcode?'));
  assert.ok(lock.includes('next=%2Freset-passcode'));
});
