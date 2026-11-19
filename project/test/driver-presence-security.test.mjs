import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20261119133000_matmove_driver_presence_v1.sql',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/pages/DriverDashboard.tsx',import.meta.url),'utf8');

test('driver presence is server-owned and protected by RLS and authenticated RPCs',()=>{
 assert.match(migration,/create table if not exists public\.matmove_driver_presence/i);
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/revoke all on public\.matmove_driver_presence from anon, authenticated/i);
 assert.match(migration,/auth\.uid\(\)/i);
 assert.match(migration,/kyc_status::text is distinct from 'approved'/i);
 assert.match(migration,/is_wallet_frozen/i);
 assert.match(migration,/is_frozen/i);
 assert.match(migration,/last_seen_at>now\(\)-interval '45 seconds'/i);
 assert.match(migration,/p_accuracy_m > 150/i);
 assert.match(migration,/p_observed_at < now\(\)-interval '30 seconds'/i);
 assert.match(migration,/accepted','in_progress/i);
});

test('driver online status requires GPS and a confirmed server heartbeat',()=>{
 assert.doesNotMatch(dashboard,/matmove:driver-online:v1/);
 assert.match(dashboard,/getCurrentPosition/);
 assert.match(dashboard,/matmove_set_driver_presence/);
 assert.match(dashboard,/matmove_driver_presence_snapshot/);
 assert.match(dashboard,/watchPosition/);
 assert.match(dashboard,/45000/);
 assert.match(dashboard,/GPS heartbeat expired/);
});
