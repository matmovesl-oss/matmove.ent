import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL(
  '../supabase/migrations/20261112180000_matmove_cash_ride_ledger_foundation.sql',
  import.meta.url
);

test('cash rides use dedicated ledger tables and never reuse digital escrow tables', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /create table if not exists public\.matmove_cash_ride_payments/i);
  assert.match(sql, /create table if not exists public\.matmove_cash_ride_legs/i);
  assert.match(sql, /create table if not exists public\.matmove_cash_ride_audit_events/i);
  assert.match(sql, /references public\.bookings\(id\)/i);
  assert.doesNotMatch(sql, /alter table public\.(ride_payments|ride_payment_transfers)/i);
});

test('cash split is constrained to 85 percent driver cash plus the MatMove fee remainder', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /driver_cash_minor \+ matmove_fee_minor = fare_minor/i);
  assert.match(sql, /driver_cash_minor = round\(fare_minor::numeric \* 0\.85\)::bigint/i);
  assert.match(sql, /currency = 'SLE'/i);
});

test('cash transfer legs are idempotent and require exact verified provider receipts', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /unique \(request_key\)/i);
  assert.match(sql, /matmove_cash_ride_leg_one_kind_per_booking/i);
  assert.match(sql, /verified_amount_minor = amount_minor/i);
  assert.match(sql, /verified_currency = currency/i);
  assert.match(sql, /verified_source_account_ref = source_account_ref/i);
  assert.match(sql, /verified_destination_account_ref = destination_account_ref/i);
  assert.match(sql, /nullif\(btrim\(verified_reference\), ''\) is not null/i);
  assert.match(sql, /status <> 'completed'[\s\S]*?verified_at is not null/i);
});

test('cash confirmations are actor-bound and settlement requires both parties or recorded admin resolution', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /driver_cash_confirmed_by = driver_id/i);
  assert.match(sql, /rider_cash_confirmed_by = rider_id/i);
  assert.match(sql, /status <> 'settled'[\s\S]*?driver_cash_confirmed_at is not null and rider_cash_confirmed_at is not null/i);
  assert.match(sql, /manual_resolution_at is not null/i);
});

test('cash records have immutable history and isolated service-role-only access', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /before update or delete on public\.matmove_cash_ride_payments/i);
  assert.match(sql, /before update or delete on public\.matmove_cash_ride_legs/i);
  assert.match(sql, /before update or delete on public\.matmove_cash_ride_audit_events/i);
  assert.match(sql, /alter table public\.matmove_cash_ride_payments enable row level security/i);
  assert.match(sql, /alter table public\.matmove_cash_ride_legs enable row level security/i);
  assert.match(sql, /alter table public\.matmove_cash_ride_audit_events enable row level security/i);
  assert.match(sql, /from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public\.matmove_cash_ride_payments to service_role/i);
  assert.match(sql, /grant select, insert on table public\.matmove_cash_ride_audit_events to service_role/i);
});

test('cash foundation does not issue provider requests or mutate wallets/bookings', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.doesNotMatch(sql, /insert into public\.(wallets|wallet_transactions|ledger_entries|ride_payments|ride_payment_transfers)/i);
  assert.doesNotMatch(sql, /update public\.(wallets|wallet_transactions|bookings)/i);
  assert.doesNotMatch(sql, /http\./i);
});
