import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/useWalletAccess.ts', import.meta.url), 'utf8');

test('wallet access keeps a fail-closed default and skips work without a signed-in user', () => {
  assert.match(source, /frozen:\s*true/);
  assert.match(source, /approved:\s*false/);
  assert.match(source, /if\s*\(!userId\)\s*return/);
  assert.match(source, /if\s*\(disposed\s*\|\|\s*document\.visibilityState !== 'visible'\)\s*return/);
});

test('all three wallet authorization reads use one bounded abort signal', () => {
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /10_000/);
  assert.equal((source.match(/\.abortSignal\(controller\.signal\)/g) || []).length, 3);
  assert.match(source, /window\.clearTimeout\(timeout\)/);
});

test('Realtime remains the fast path with a slower 30 second recovery poll', () => {
  assert.match(source, /window\.setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.doesNotMatch(source, /setInterval\([\s\S]{0,100}5_000/);
  assert.match(source, /\.channel\('wallet-access:' \+ userId\)/);
  assert.match(source, /table:\s*'wallets'/);
  assert.match(source, /table:\s*'profiles'/);
});

test('wallet access rechecks on foreground, browser focus and network reconnect', () => {
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshWhenActive\)/);
  assert.match(source, /window\.addEventListener\('focus', refreshWhenActive\)/);
  assert.match(source, /window\.addEventListener\('online', refreshWhenActive\)/);
});

test('missed events during an in-flight refresh trigger one trailing verification', () => {
  assert.match(source, /if\s*\(busy\)\s*\{\s*refreshQueued = true;/);
  assert.match(source, /if\s*\(refreshQueued\)\s*\{/);
  assert.match(source, /if\s*\(!disposed && document\.visibilityState === 'visible'\)\s*void refresh\(\);/);
});

test('cleanup cancels the fallback poll, removes browser listeners and releases Realtime', () => {
  assert.match(source, /window\.clearInterval\(timer\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', refreshWhenActive\)/);
  assert.match(source, /window\.removeEventListener\('focus', refreshWhenActive\)/);
  assert.match(source, /window\.removeEventListener\('online', refreshWhenActive\)/);
  assert.match(source, /void supabase\.removeChannel\(channel\)/);
});
