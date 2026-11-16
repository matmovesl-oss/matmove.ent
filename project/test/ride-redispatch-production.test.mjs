import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261116165000_matmove_driver_cancel_redispatch_hardening_v2.sql', import.meta.url), 'utf8');
const ridePayments = await readFile(new URL('../server/ride-payments.js', import.meta.url), 'utf8');
const cashPayments = await readFile(new URL('../server/cash-ride-payments.js', import.meta.url), 'utf8');
const rideService = await readFile(new URL('../src/services/rideService.ts', import.meta.url), 'utf8');
const driver = await readFile(new URL('../src/pages/DriverDashboard.tsx', import.meta.url), 'utf8');

test('driver cancellation keeps the same booking and retains verified digital escrow or cash reserve', () => {
  assert.match(migration, /public\.matmove_driver_cancel_redispatch/);
  assert.match(migration, /b\.status::text <> 'accepted'/);
  assert.match(migration, /b\.started_at is not null/);
  assert.match(migration, /rp\.state <> 'funded'/);
  assert.match(migration, /cp\.status <> 'fee_reserved'/);
  assert.match(migration, /paymentHoldRetained', true/);
  assert.match(migration, /matmove_excluded_driver_ids/);
  assert.match(migration, /driver_redispatch_queued/);
  assert.doesNotMatch(migration, /insert into public\.ride_payment_transfers\s*\([\s\S]{0,300}kind,\s*amount_minor[\s\S]{0,100}'refund'/i);
});

test('replacement digital driver is validated and becomes only the future payout beneficiary', () => {
  assert.match(migration, /public\.matmove_accept_redispatched_digital/);
  assert.match(migration, /rp\.state <> 'funded'/);
  assert.match(migration, /matmove_dispatch_driver_status/);
  assert.match(migration, /p_driver_account =/i);
  assert.match(migration, /set driver_id = p_driver_id,[\s\S]*driver_account = p_driver_account/);
  assert.match(migration, /newEscrowHold', false/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.matmove_accept_redispatched_digital'), migration.indexOf('revoke all on function public.matmove_accept_redispatched_digital')), /insert into public\.ride_payment_transfers/i);
});

test('both re-dispatch database functions are service-role only and idempotent by request reference', () => {
  assert.match(migration, /revoke all on function public\.matmove_driver_cancel_redispatch\(uuid,uuid,uuid\)[\s\S]*grant execute on function public\.matmove_driver_cancel_redispatch\(uuid,uuid,uuid\)\s+to service_role/i);
  assert.match(migration, /revoke all on function public\.matmove_accept_redispatched_digital\(uuid,uuid,text,uuid\)[\s\S]*grant execute on function public\.matmove_accept_redispatched_digital\(uuid,uuid,text,uuid\)\s+to service_role/i);
  assert.match(migration, /select \* into prior[\s\S]*from public\.matmove_dispatch_audit[\s\S]*where request_id = p_request_id/i);
});

test('the API sends driver cancellations through redispatch and never through customer refund', () => {
  assert.match(ridePayments, /const isDriver = profile\.role === 'driver'[\s\S]*matmove_driver_cancel_redispatch/);
  assert.match(cashPayments, /if \(actorType === 'driver'\)[\s\S]*matmove_driver_cancel_redispatch/);
  assert.match(cashPayments, /Driver cancellation re-dispatched the same request/);
});

test('the digital replacement acceptance path does not create another customer debit or escrow hold', () => {
  assert.match(ridePayments, /matmove_accept_redispatched_digital/);
  assert.match(ridePayments, /booking\.driver_id === user\.id && payment\.driver_id === user\.id/);
});

test('browser retries preserve the same idempotency request ID for accept and cancel', () => {
  assert.match(rideService, /const requestId = .*randomUUID/);
  assert.match(rideService, /requestId,?\s*\}/);
  assert.match(rideService, /walletFetch\(urls\[action\], body\)/);
  assert.match(rideService, /sessionStorage\.getItem\(key\)/);\n  assert.match(rideService, /clearRideActionRequestId\(action, bookingId\)/);
});

test('driver radar excludes the driver who cancelled while other eligible drivers can see the same pending request', () => {
  assert.match(driver, /matmove_excluded_driver_ids/);
  assert.match(driver, /Finding another driver/);
  assert.match(driver, /result\.redispatched === true/);
});

test('Admin trip review surfaces the actual digital payout beneficiary and keeps assignment history in the timeline', () => {
  assert.match(migration, /payoutDriverId/);
  assert.match(migration, /payoutAccount/);
});


test('accepted timestamp resets when the same unstarted booking returns to driver matching', () => {
  const start = migration.indexOf('create or replace function public.matmove_record_trip_timeline');
  const end = migration.indexOf('$function$;', start) + '$function$;'.length;
  const timeline = migration.slice(start, end);
  assert.match(timeline, /new\.status::text = 'pending'[\s\S]*old\.status::text = 'accepted'[\s\S]*new\.driver_id is null[\s\S]*new\.accepted_at := null/i);
  assert.match(timeline, /new\.status::text = 'accepted'[\s\S]*old\.status::text in \('pending', 'pending_admin'\)[\s\S]*new\.accepted_at := pg_catalog\.clock_timestamp\(\)/i);
});

test('driver cancellation retry reaches the database idempotency check after the old assignment is cleared', () => {
  const retryBranchStart = ridePayments.indexOf('if (isDriver) {');
  const retryBranchEnd = ridePayments.indexOf('// Do not silently turn an accepted rider cancellation', retryBranchStart);
  const cancelBranch = ridePayments.slice(retryBranchStart, retryBranchEnd);
  assert.match(cancelBranch, /matmove_driver_cancel_redispatch/);
  assert.doesNotMatch(cancelBranch, /booking\.driver_id\s*!==\s*user\.id/);
  assert.match(cashPayments, /if \(actorType === 'driver'\)[\s\S]*matmove_driver_cancel_redispatch/);
});
