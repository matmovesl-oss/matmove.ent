import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('verified cash refunds resolve old review tickets without closing uncertain handovers', async () => {
  const migration = await readFile('supabase/migrations/20261120093040_matmove_resolve_verified_cash_investigations_v1.sql', 'utf8');
  assert.match(migration, /matmove_resolve_ride_investigation_if_safe/);
  assert.match(migration, /after update of status,cash_return_status on public\.matmove_cash_ride_payments/);
  assert.match(migration, /after update of state on public\.ride_payments/);
  assert.match(migration, /cp\.status not in \('refunded','cancelled'\)/);
  assert.match(migration, /cp\.driver_id is not null and cp\.cash_return_status<>'refunded'/);
  assert.ok(migration.includes("status=''cash_review_required'' and exists"));
  assert.match(migration, /cp\.status='refunded'/);
  assert.match(migration, /b\.status='cash_review_required'/);
  assert.match(migration, /v_updated=v_definition/);
});
