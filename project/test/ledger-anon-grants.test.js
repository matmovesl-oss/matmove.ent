import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ledger balance helper is not executable by anonymous or public callers', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261112144032_matmove_revoke_anonymous_ledger_balance_probe.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /revoke execute on function public\.ledger_transaction_is_balanced\(uuid\)[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.ledger_transaction_is_balanced\(uuid\)[\s\S]*to authenticated, service_role/i);
  assert.match(migration, /SECURITY INVOKER|subject to ledger_entries RLS/i);
});
