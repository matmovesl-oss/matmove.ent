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
