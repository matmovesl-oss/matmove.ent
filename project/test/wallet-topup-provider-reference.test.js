import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL(
  '../supabase/migrations/20261112173000_matmove_require_topup_provider_reference.sql',
  import.meta.url
);

test('wallet top-up cannot transition to completed without a provider transaction reference', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /create or replace function public\.matmove_require_topup_provider_reference/i);
  assert.match(sql, /new\.status = 'completed'/i);
  assert.match(sql, /old\.status is distinct from 'completed'/i);
  assert.match(sql, /nullif\(trim\(coalesce\(new\.provider_reference, ''\)\), ''\) is null/i);
});

test('wallet top-up cannot reuse the original checkout reference as settlement proof', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /new\.provider_reference is not distinct from old\.provider_reference/i);
  assert.match(sql, /before update of status, provider_reference/i);
});

test('reference guard is limited to wallet top-up transaction types', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /lower\(trim\(coalesce\(new\.transaction_type, ''\)\)\) in \('wallet_topup', 'topup'\)/i);
});

test('trigger function uses a fixed search path and denies direct browser execution', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /set search_path to 'pg_catalog', 'public'/i);
  assert.match(sql, /revoke all on function public\.matmove_require_topup_provider_reference\(\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /create trigger matmove_require_topup_provider_reference/i);
});
