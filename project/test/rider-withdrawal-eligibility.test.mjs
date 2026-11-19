import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('both withdrawal RPC paths allow riders only after approved KYC', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261119190000_matmove_rider_withdrawal_eligibility.sql', import.meta.url), 'utf8');
  assert.match(sql, /role IN \('rider', 'driver', 'merchant'\)/i);
  assert.match(sql, /allow KYC-approved riders to withdraw/i);
  assert.match(sql, /role in \('rider', 'driver', 'merchant'\)\s+and kyc_status = 'approved'/i);
  assert.match(sql, /Wallet is frozen\./);
  assert.match(sql, /Insufficient available/);
  assert.match(sql, /idempotency_key/);
});
