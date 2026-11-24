import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('customer preview does not crash or connect to production when Supabase env is missing', async () => {
  const supabase = await read('../src/lib/supabase.ts');
  const entry = await read('../src/main.tsx');
  const packageJson = JSON.parse(await read('../package.json'));

  assert.match(supabase, /export const isSupabaseConfigured = Boolean\(supabaseUrl && supabaseAnonKey\)/);
  assert.match(supabase, /https:\/\/not-configured\.invalid/);
  assert.match(supabase, /supabaseAnonKey \|\| 'not-configured'/);
  assert.doesNotMatch(supabase, /throw new Error\(\s*['"]Missing Supabase environment variables/);
  assert.match(supabase, /if \(isSupabaseConfigured\)\s*\{/);

  assert.match(entry, /isSupabaseConfigured \? \(/);
  assert.match(entry, /<AuthProvider>/, 'AuthProvider is mounted only in the configured branch');
  assert.match(entry, /<SecurePreviewDisconnected \/>/);
  assert.match(entry, /Preview is not connected to a test database/);
  assert.match(entry, /intentionally disconnected from live MatMove accounts, wallets and payment services/);
  assert.match(entry, /isSupabaseConfigured && 'serviceWorker' in navigator/);

  assert.match(packageJson.scripts.build, /test\/customer-preview-no-supabase\.test\.mjs/);
});

test('configured production continues to mount the normal customer application', async () => {
  const entry = await read('../src/main.tsx');
  assert.match(entry, /<BrowserRouter>\s*<AuthProvider>\s*<App \/>/);
  assert.match(entry, /if \(import\.meta\.env\.PROD && isSupabaseConfigured/);
});
