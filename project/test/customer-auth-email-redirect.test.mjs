import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const redirect = await read('../src/services/authRedirect.ts');
const authService = await read('../src/services/authService.ts');
const authPages = await read('../src/pages/AuthPages.tsx');

test('customer production auth redirects use the MatMove branded domain', () => {
  assert.ok(redirect.includes("const PRODUCTION_APP_ORIGIN = 'https://matmove.space';"));
  assert.ok(redirect.includes("'matmove.space'"));
  assert.ok(redirect.includes("'www.matmove.space'"));
  assert.ok(redirect.includes("'matmoveent.vercel.app'"));
  assert.ok(!redirect.includes("const PRODUCTION_APP_ORIGIN = 'https://matmoveent.vercel.app';"));
});

test('preview and local auth redirects retain their own origin unless an explicit app URL is configured', () => {
  assert.ok(redirect.includes('resolveCustomerAuthOrigin'));
  assert.ok(redirect.includes('configuredOrigin?: string | null'));
  assert.ok(redirect.includes('if (!configured) return currentOrigin'));
  assert.ok(redirect.includes('return candidate.origin'));
  assert.ok(redirect.includes('return new URL(normalized, origin).toString()'));
});

test('signup confirmation, password reset and passcode recovery all use the shared redirect resolver', () => {
  assert.ok(authService.includes("emailRedirectTo: customerAuthRedirect('/auth/callback')"));
  assert.ok(authService.includes("customerAuthRedirect('/auth/callback?type=recovery&next=%2Freset-password')"));
  assert.ok(authService.includes("customerAuthRedirect('/auth/callback?type=recovery&next=%2Freset-passcode')"));
});

test('the callback keeps recovery actions separate from normal signup confirmation', () => {
  assert.ok(authPages.includes("params.get('type') === 'recovery'"));
  assert.ok(authPages.includes("requestedNext === '/reset-passcode'"));
  assert.ok(authPages.includes("requestedNext === '/reset-password'"));
  assert.ok(authPages.includes('if (recovery) {'));
  assert.ok(authPages.includes('supabase.auth.getSession()'));
  assert.ok(authPages.includes("event !== 'PASSWORD_RECOVERY'"));
  assert.ok(authPages.includes('navigate(destination, { replace: true })'));
});
