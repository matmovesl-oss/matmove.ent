import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Driver KYC wrapper writes only to the authenticated profile ID', async () => {
  const sql = await readFile(
    'supabase/migrations/20261108165500_matmove_driver_kyc_profile_id_fix_v1.sql',
    'utf8'
  );

  assert.match(sql, /v_profile_id\s*:=\s*v_uid\s*;/);
  assert.match(sql, /v_result->>'success'/);
  assert.doesNotMatch(sql, /v_result->>'profile_id'/);
});
