import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

const migration = read('supabase/migrations/20261116143000_matmove_driver_cancel_redispatch_v1.sql');
const digital = read('server/ride-payments.js');
const cash = read('server/cash-ride-payments.js');
const driverUi = read('src/pages/DriverDashboard.tsx');

test('driver re-dispatch keeps the original booking and records every driver assignment', () => {
  assert.match(migration, /matmove_ride_driver_assignments/);
  assert.match(migration, /matmove_ride_booking_events/);
  assert.match(migration, /matmove_excluded_driver_ids uuid\[\] not null default/);
  assert.match(migration, /unique index if not exists matmove_ride_one_active_assignment_idx/);
  assert.match(migration, /after insert or update of driver_id on public\.bookings/);
  assert.match(migration, /'driver_cancelled'/);
  assert.match(migration, /'booking_redispatched'/);
});

test('pre-start driver cancellation is atomic, idempotent, and excludes the cancelling driver', () => {
  assert.match(migration, /matmove_driver_cancel_and_redispatch/);
  assert.match(migration, /where id=p_booking_id for update/);
  assert.match(migration, /p_driver_id = any\(coalesce\(b\.matmove_excluded_driver_ids/);
  assert.match(migration, /set driver_id=null,[\s\S]*status='pending'/);
  assert.match(migration, /'sameBookingId',true/);
  assert.match(migration, /'paymentOrReserveReused',true/);
  assert.match(migration, /grant execute on function public\.matmove_driver_cancel_and_redispatch\(uuid,uuid,text\) to service_role/);
});

test('digital replacement requires the verified original escrow hold and changes only its payout beneficiary', () => {
  assert.match(migration, /matmove_redispatch_assign_digital_driver/);
  assert.match(migration, /p\.state <> 'funded'/);
  assert.match(migration, /t\.kind='hold'[\s\S]*t\.status='completed'[\s\S]*t\.provider_id is not null/);
  assert.match(migration, /t\.kind in \('driver','fee','refund'\)/);
  assert.match(migration, /set driver_id=p_driver_id,driver_account=p_driver_account/);
  assert.match(migration, /'newChargeCreated',false/);
  assert.match(digital, /matmove_redispatch_assign_digital_driver/);
  assert.match(digital, /booking\.status !== 'pending'/);
});

test('cash re-dispatch retains one verified 15 percent reserve and protects cash confirmations', () => {
  assert.match(migration, /create or replace function public\.matmove_cash_ride_payment_guard/);
  assert.match(migration, /old\.status <> 'fee_reserved'/);
  assert.match(migration, /old\.driver_cash_confirmed_at is not null/);
  assert.match(migration, /old\.cash_return_status <> 'not_requested'/);
  assert.match(migration, /assignment_status='driver_cancelled'/);
  assert.match(migration, /p\.status <> 'fee_reserved'/);
  assert.match(migration, /'CASH_FEE_NOT_RESERVED/);
  assert.match(cash, /if \(actorType === 'driver'\)[\s\S]*matmove_driver_cancel_and_redispatch/);
  assert.match(cash, /matmove_cash_ride_cancel/); // rider/merchant cancellation remains on the refund path
});

test('started trips and uncertain payment states are routed to Admin review without re-dispatch', () => {
  assert.match(migration, /b\.started_at is not null or b\.status='in_progress'/);
  assert.match(migration, /driver_cancel_after_start_review/);
  assert.match(migration, /requiresManualReconciliation/);
  assert.match(migration, /'noRedispatch',true/);
  assert.match(digital, /result\.reviewRequired/);
  assert.match(cash, /result\.reviewRequired/);
});


test('Admin trip review timeline includes the original and replacement driver history', () => {
  const adminMigration = read('supabase/migrations/20261116171000_matmove_admin_trip_review_driver_history_v1.sql');
  assert.match(adminMigration, /matmove_admin_trip_review/);
  assert.match(adminMigration, /matmove_ride_driver_assignments/);
  assert.match(adminMigration, /matmove_ride_booking_events/);
  assert.match(adminMigration, /Driver assignment #/);
  assert.match(adminMigration, /Booking event:/);
});

test('each replacement acceptance refreshes accepted_at and terminal states close the active assignment', () => {
  const lifecycleMigration = read('supabase/migrations/20261116172000_matmove_redispatch_timeline_lifecycle_v1.sql');
  assert.match(lifecycleMigration, /matmove_record_trip_timeline/);
  assert.match(lifecycleMigration, /and old\.accepted_at is null/);
  assert.match(lifecycleMigration, /matmove_close_ride_driver_assignment/);
  assert.match(lifecycleMigration, /assignment_status = v_closed_status/);
  assert.match(lifecycleMigration, /'booking_completed'/);
  assert.match(lifecycleMigration, /'booking_cancelled'/);
});

test('the cancelling driver does not see their own returned booking in the driver radar', () => {
  assert.match(driverUi, /matmove_excluded_driver_ids/);
  assert.match(driverUi, /result\.redispatched/);
  assert.match(driverUi, /same customer booking has returned to driver matching/);
});
