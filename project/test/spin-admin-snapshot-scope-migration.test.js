import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production migration scopes Spin Admin RPC summaries and keeps base functions private', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261111180000_matmove_spin_admin_snapshot_permission_scope.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.matmove_spin_admin_snapshot\(\)/i);
  assert.match(sql, /public\.matmove_admin_can\('games\.settings'\)/i);
  assert.match(sql, /public\.matmove_admin_can\('games\.entries'\)/i);
  assert.match(sql, /public\.matmove_admin_can\('games\.winnings'\)/i);
  assert.match(sql, /public\.matmove_admin_any\(ARRAY\['games\.overview','games\.winnings'\]::text\[\]\)/i);
  assert.match(sql, /revoke all on function public\.matmove_spin_admin_snapshot_staff_base\(\) from public,anon,authenticated,service_role/i);
  assert.match(sql, /revoke all on function public\.matmove_spin_admin_report_staff_base\(text,integer,text,text,uuid\) from public,anon,authenticated,service_role/i);
  assert.match(sql, /grant execute on function public\.matmove_spin_admin_snapshot\(\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.matmove_spin_admin_report\(text,integer,text,text,uuid\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.matmove_spin_admin_snapshot_staff_base/i);
  assert.doesNotMatch(sql, /grant execute on function public\.matmove_spin_admin_report_staff_base/i);
  assert.doesNotMatch(sql, /'rounds'\s*,\s*v_snapshot->'rounds'|'receipts'\s*,\s*v_snapshot->'receipts'|'access'\s*,\s*v_snapshot->'access'/i);
});
