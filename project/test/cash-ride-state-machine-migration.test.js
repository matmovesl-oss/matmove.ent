import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL(
  '../supabase/migrations/20261112190000_matmove_cash_ride_booking_and_state_machine.sql',
  import.meta.url
);

test('cash booking is a separate payment method and starts outside driver discovery', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /add column if not exists payment_method text not null default 'digital'/i);
  assert.match(sql, /'cash_reserve_pending'/i);
  assert.match(sql, /'cash_review_required'/i);
  assert.match(sql, /new\.status is distinct from 'cash_reserve_pending'/i);
  assert.match(sql, /status='pending'.*where id=p_booking_id and status='cash_reserve_pending'/is);
});

test('cash booking creation is disabled until a restricted holding and fee account are configured', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /enabled boolean not null default false/i);
  assert.match(sql, /CASH_NOT_CONFIGURED/i);
  assert.match(sql, /fee_hold_account_id <> fee_revenue_account_id/i);
  assert.match(sql, /service <> 'ride' or role_name <> 'rider'/i);
});

test('cash bookings cannot be assigned, started, completed or cancelled outside verified ledger states', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /CASH_FEE_NOT_RESERVED/i);
  assert.match(sql, /CASH_RIDE_NOT_READY/i);
  assert.match(sql, /CASH_CAPTURE_NOT_VERIFIED/i);
  assert.match(sql, /CASH_REFUND_NOT_VERIFIED/i);
});

test('cash reserve, capture and refund legs use exact configured account lineage and stable request keys', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /request_ref := 'matmove-cash:'/i);
  assert.match(sql, /destination_ref := cfg\.fee_hold_account_id/i);
  assert.match(sql, /destination_ref := cfg\.fee_revenue_account_id/i);
  assert.match(sql, /destination_ref := reserve\.source_account_ref/i);
  assert.match(sql, /existing\.request_key <> request_ref/i);
});

test('cash legs cannot create a second provider POST after an uncertain attempt', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /l\.status='ready' and l\.attempted_at is null/i);
  assert.match(sql, /status='processing',attempted_at=clock_timestamp\(\)/i);
  assert.match(sql, /interval '2 minutes'/i);
  assert.match(sql, /reasonCode','uncertain_post'/i);
  assert.match(sql, /set status='cash_review_required'/i);
});

test('cash settlement needs dual confirmations and booking status follows verified capture/refund', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /p\.driver_cash_confirmed_at is not null and p\.rider_cash_confirmed_at is not null/i);
  assert.match(sql, /status='settled'/i);
  assert.match(sql, /status='completed',updated_at=clock_timestamp\(\)[\s\S]*where id=p_booking_id and status='in_progress'/i);
  assert.match(sql, /when 'refund' then 'refunded'/i);
  assert.match(sql, /status='cancelled',updated_at=clock_timestamp\(\)[\s\S]*where id=p_booking_id and status in \('cash_reserve_pending','pending','accepted'\)/i);
});

test('cash state RPCs are service-role only and do not reuse digital escrow tables', async () => {
  const sql = await readFile(migration, 'utf8');
  for (const name of [
    'matmove_cash_ride_prepare_leg',
    'matmove_cash_ride_claim_leg',
    'matmove_cash_ride_record_leg',
    'matmove_cash_ride_assign_driver',
    'matmove_cash_ride_start',
    'matmove_cash_ride_confirm_collection',
    'matmove_cash_ride_cancel'
  ]) {
    assert.match(sql, new RegExp('revoke all on function public\\.' + name));
    assert.match(sql, new RegExp('grant execute on function public\\.' + name + '[^;]+to service_role', 'i'));
  }
  assert.doesNotMatch(sql, /insert into public\.(ride_payments|ride_payment_transfers)/i);
});


test('cash reserve claim revalidates the current rider SLE wallet link and freeze state before the one-time POST', async () => {
  const sql = await readFile(migration, 'utf8');
  const claim = sql.slice(
    sql.indexOf('create or replace function public.matmove_cash_ride_claim_leg'),
    sql.indexOf('create or replace function public.matmove_cash_ride_record_leg')
  );
  assert.match(claim, /public\.wallets w[\s\S]*public\.profiles rider/i);
  assert.match(claim, /coalesce\(w\.monime_account_id,w\.metadata->>'monime_account_id'\)=l\.source_account_ref/i);
  assert.match(claim, /not coalesce\(w\.is_frozen,false\)/i);
  assert.match(claim, /not coalesce\(rider\.is_wallet_frozen,false\)/i);
  assert.match(claim, /source_account_changed/i);
  assert.match(claim, /status='review_required'/i);
  assert.match(claim, /canCreate',false,'canLookup',false/i);
});
