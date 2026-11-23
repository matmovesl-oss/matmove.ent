import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const redirect = await read('../src/services/authRedirect.ts');
const authService = await read('../src/services/authService.ts');
const authPages = await read('../src/pages/AuthPages.tsx');

test('customer production auth redirects use the MatMove branded domain', () => {
  assert.match(redirect, /PRODUCTION_APP_ORIGIN = 'https:\\/\\/matmove\\.space'/);
  assert.match(redirect, /'matmove\\.space'/);
  assert.match(redirect, /'www\\.matmove\\.space'/);
  assert.match(redirect, /'matmoveent\\.vercel\\.app'/);
  assert.doesNotMatch(redirect, /PRODUCTION_APP_ORIGIN = 'https:\\/\\/matmoveent\\.vercel\\.app'/);
});

test('preview and local auth redirects retain their own origin unless an explicit app URL is configured', () => {
  assert.match(redirect, /resolveCustomerAuthOrigin/);
  assert.match(redirect, /configuredOrigin\?: string \| null/);
  assert.match(redirect, /if \(!configured\) return currentOrigin/);
  assert.match(redirect, /return candidate\.origin/);
  assert.match(redirect, /return new URL\(normalized, origin\)\.toString\(\)/);
});

test('signup confirmation, password reset and passcode recovery all use the shared redirect resolver', () => {
  assert.match(authService, /emailRedirectTo: customerAuthRedirect\('\/auth\/callback'\)/);
  assert.match(authService, /customerAuthRedirect\('\/auth\/callback\?type=recovery&next=%2Freset-password'\)/);
  assert.match(authService, /customerAuthRedirect\('\/auth\/callback\?type=recovery&next=%2Freset-passcode'\)/);
});

test('the callback keeps recovery actions separate from normal signup confirmation', () => {
  assert.match(authPages, /params\.get\('type'\) === 'recovery'/);
  assert.match(authPages, /requestedNext === '\/reset-passcode'/);
  assert.match(authPages, /requestedNext === '\/reset-password'/);
  assert.match(authPages, /navigate\(recovery \?/);
});
