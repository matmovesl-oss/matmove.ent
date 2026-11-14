import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Rider and Merchant Trips expose unfinished requests and a real cancellation action', async () => {
  const source = await read('../src/components/TripHistory.tsx');
  assert.match(source, /aria-label="Unfinished requests"/);
  assert.match(source, /activeRequests = ownedTrips\.filter/);
  assert.match(source, /updateRide\('cancel',t\.id\)/);
  assert.match(source, /Open request details/);
  assert.match(source, /Cancel request/);
  assert.match(source, /refund is still being verified/i);
});

test('Admin cash refund legs are included in the scheduled queue and reconciled by their existing idempotent transfer ID', async () => {
  const api = await read('../server/ride-api.js');
  const cash = await read('../server/cash-ride-payments.js');
  assert.match(api, /and\(leg_kind\.eq\.refund,status\.eq\.ready\)/);
  assert.match(cash, /leg\.leg_kind === 'refund' && leg\.status === 'ready'/);
  assert.match(cash, /payment\?\.status === 'refund_pending'/);
  assert.match(cash, /runCashLeg\(db, bookingId, leg\.leg_kind, provider\)/);
});

test('Admin cancellation is dispatch-authorized, idempotent and keeps paid bookings open until refund verification', async () => {
  const migration = await read('../supabase/migrations/20261114150000_matmove_admin_cancel_refund_workflow_v1.sql');
  assert.match(migration, /public\.matmove_dispatch_actor\(\)/);
  assert.match(migration, /public\.matmove_admin_cancel_booking/);
  assert.match(migration, /p_request_id/);
  assert.match(migration, /set state='refunding'/);
  assert.match(migration, /set status='refund_pending'/);
  assert.match(migration, /matmove_cash_ride_legs/);
  assert.match(migration, /matmove_dispatch_audit/);
  assert.match(migration, /matmove_cash_ride_payments where booking_id=b\.id/);
});

test('protected scheduled reconciliation runs the stale-ticket sweep and is configured as a Vercel cron', async () => {
  const api = await read('../server/ride-api.js');
  const routes = await read('../vercel.json');
  assert.match(api, /db\.rpc\('matmove_ride_stale_request_sweep'\)/);
  assert.match(api, /staleRequests: staleSweep\.data/);
  assert.match(routes, /"path": "\/api\/reconcile-ride-payments"/);
  assert.match(routes, /"schedule": "\* \* \* \* \*"/);
});

test('automatic abandonment never cancels a request with any payment ledger or an assigned driver', async () => {
  const migration = await read('../supabase/migrations/20261114150000_matmove_admin_cancel_refund_workflow_v1.sql');
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /interval '60 minutes'/);
  assert.match(migration, /b\.driver_id is null/);
  assert.match(migration, /not exists\(select 1 from public\.ride_payments/);
  assert.match(migration, /not exists\(select 1 from public\.matmove_cash_ride_payments/);
  assert.match(migration, /matmove_ride_investigation_tickets/);
});
