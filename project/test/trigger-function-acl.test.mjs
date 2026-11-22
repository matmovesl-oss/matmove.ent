import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = 'docs/pending-migrations/matmove_trigger_only_definer_function_acl_v1.sql';

test('trigger-only SECURITY DEFINER entry points are not directly executable by API roles', async () => {
  const sql = await readFile(migration, 'utf8');

  for (const fn of [
    'matmove_homepage_enforce_three_published',
    'matmove_resolve_ride_investigation_after_cash_payment',
    'matmove_resolve_ride_investigation_after_digital_payment',
  ]) {
    const expected = `revoke all on function public.${fn}()
  from public, anon, authenticated, service_role;`;
    assert.ok(sql.includes(expected), `Missing least-privilege revoke for ${fn}`);
  }

  assert.match(sql, /notify pgrst/i);
  assert.doesNotMatch(sql, /matmove_get_travel_availability/);
  assert.doesNotMatch(sql, /drop trigger|drop function|create or replace function/i);
});
