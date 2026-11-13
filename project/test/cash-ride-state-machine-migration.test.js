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


test('database independently rejects completed cash receipts that mismatch the immutable provider leg', async () => {
  const sql = await readFile(migration, 'utf8');
  const record = sql.slice(
    sql.indexOf('create or replace function public.matmove_cash_ride_record_leg'),
    sql.indexOf('create or replace function public.matmove_cash_ride_assign_driver')
  );

  const guard = record.indexOf("if p_provider_status = 'completed' and (");
  const write = record.indexOf('update public.matmove_cash_ride_legs');
  assert.ok(guard >= 0 && write > guard, 'receipt validation must run before a completion update');

  assert.match(record, /nullif\(btrim\(p_provider_transfer_id\), ''\) is null/i);
  assert.match(record, /p_verified_amount_minor is distinct from l\.amount_minor/i);
  assert.match(record, /p_verified_currency is distinct from l\.currency/i);
  assert.match(record, /p_verified_source_account is distinct from l\.source_account_ref/i);
  assert.match(record, /p_verified_destination_account is distinct from l\.destination_account_ref/i);
  assert.match(record, /p_verified_reference is distinct from l\.request_key/i);
  assert.match(record, /CASH_RECEIPT_MISMATCH/i);
});

test('cash fee capture destination must match the deployed MONIME_PLATFORM_FEE_ACCOUNT_ID', async () => {
  const source = await readFile(new URL('../server/cash-ride-payments.js', import.meta.url), 'utf8');
  const settings = source.slice(
    source.indexOf('async function readSettings'),
    source.indexOf('function providerAccountBalance')
  );
  assert.match(settings, /process\.env\.MONIME_ESCROW_ACCOUNT_ID/);
  assert.match(settings, /data\.fee_hold_account_id !== escrowAccountId/);
  assert.match(settings, /process\.env\.MONIME_PLATFORM_FEE_ACCOUNT_ID/);
  assert.match(settings, /data\.fee_revenue_account_id !== platformFeeAccountId/);
  assert.match(settings, /data\.fee_hold_account_id === platformFeeAccountId/);
  assert.match(settings, /escrow and platform-fee accounts match their production settings/i);
});

const sharedMigration = new URL(
  '../supabase/migrations/20261113143000_matmove_cash_shared_account_ledger_settlement.sql',
  import.meta.url
);

test('legacy shared-account release remains audited while production configuration requires distinct accounts', async () => {
  const sql = await readFile(sharedMigration, 'utf8');
  const server = await readFile(new URL('../server/cash-ride-payments.js', import.meta.url), 'utf8');
  assert.match(sql, /drop constraint if exists matmove_cash_ride_settings_accounts_distinct/i);
  assert.match(sql, /cfg\.fee_hold_account_id <> cfg\.fee_revenue_account_id/i);
  assert.match(sql, /settlement_mode in \('provider_transfer','internal_ledger'\)/i);
  assert.match(sql, /create or replace function public\.matmove_cash_ride_settle_shared_capture/i);
  assert.match(sql, /both cash parties must confirm/i);
  assert.match(sql, /set status = 'completed',[\s\S]*settlement_mode = 'internal_ledger'/i);
  assert.match(sql, /revoke all on function public\.matmove_cash_ride_settle_shared_capture/i);
  assert.match(server, /data\.fee_revenue_account_id !== platformFeeAccountId/);
  assert.doesNotMatch(server.slice(server.indexOf('async function readSettings'), server.indexOf('function providerAccountBalance')),
    /fee_hold_account_id === platformFeeAccountId/);
  assert.match(server, /kind === 'capture' && storedLeg\.source_account_ref === storedLeg\.destination_account_ref/);
  assert.match(server, /matmove_cash_ride_settle_shared_capture/);
});
