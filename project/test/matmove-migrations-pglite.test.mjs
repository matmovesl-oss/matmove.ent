import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('MatMove rider-withdrawal and Loading Bonanza migrations apply in an isolated PostgreSQL engine', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;

      create table public.profiles (
        id uuid primary key,
        role text not null,
        kyc_status text,
        is_wallet_frozen boolean not null default false
      );
      create table public.wallets (
        id uuid primary key,
        user_id uuid not null references public.profiles(id),
        currency text not null,
        balance numeric not null default 0,
        reserved_balance numeric not null default 0,
        monime_account_id text,
        metadata jsonb not null default '{}'::jsonb,
        is_frozen boolean not null default false
      );
      create table public.payment_transactions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        wallet_id uuid not null,
        transaction_type text not null,
        provider text not null,
        provider_reference text,
        idempotency_key text not null,
        amount numeric not null,
        currency text not null,
        status text not null,
        customer_phone text,
        metadata jsonb not null default '{}'::jsonb,
        initiated_at timestamptz
      );
      create table public.withdrawal_requests (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        amount numeric not null,
        provider text not null,
        reference_code text not null,
        status text not null,
        payment_transaction_id uuid not null,
        currency text not null,
        idempotency_key text not null,
        updated_at timestamptz
      );
      create table public.matmove_withdrawals (
        id uuid primary key default gen_random_uuid(),
        request_key text not null unique,
        user_id uuid not null,
        wallet_id uuid not null,
        source_account text not null,
        platform_account text not null,
        amount_minor bigint not null,
        monime_fee_minor bigint not null,
        platform_fee_minor bigint not null,
        total_minor bigint not null,
        provider text not null,
        phone text not null,
        state text not null
      );
      create table public.matmove_withdrawal_legs (
        id uuid primary key default gen_random_uuid(),
        withdrawal_id uuid not null,
        kind text not null,
        amount_minor bigint not null
      );
      create table public.matmove_staff_access (
        id uuid primary key,
        is_active boolean not null default false,
        is_owner boolean not null default false,
        removed_at timestamptz
      );
      create function public.matmove_report_allowed(uuid, text)
      returns boolean language sql stable as $$ select true $$;
    `);

    await db.exec(await migration('20261119190000_matmove_rider_withdrawal_eligibility.sql'));
    await db.exec(await migration('20261119201500_matmove_loading_bonanza_cashback_v1.sql'));

    const objects = await db.query(`
      select table_name from information_schema.tables
      where table_schema='public' and table_name like 'matmove_loading_bonanza_%'
      order by table_name
    `);
    assert.deepEqual(objects.rows.map((row) => row.table_name), [
      'matmove_loading_bonanza_admin_events',
      'matmove_loading_bonanza_campaign',
      'matmove_loading_bonanza_fundings',
      'matmove_loading_bonanza_pending_codes',
      'matmove_loading_bonanza_rewards',
      'matmove_loading_bonanza_topups'
    ]);

    const functions = await db.query(`
      select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname in (
        'initiate_wallet_withdrawal','matmove_prepare_withdrawal',
        'matmove_loading_bonanza_record_topup','matmove_loading_bonanza_queue_completed_code',
        'matmove_loading_bonanza_admin_overview','matmove_loading_bonanza_admin_save',
        'matmove_loading_bonanza_claim','matmove_loading_bonanza_record',
        'matmove_loading_bonanza_funding_claim','matmove_loading_bonanza_funding_record'
      )
      order by proname
    `);
    assert.equal(functions.rows.length, 10);
    const trigger = await db.query(`
      select 1 from pg_trigger where tgname='matmove_loading_bonanza_topup_after_completed'
        and not tgisinternal
    `);
    assert.equal(trigger.rows.length, 1);

    const riderId = '10000000-0000-4000-8000-000000000001';
    const walletId = '20000000-0000-4000-8000-000000000001';
    await db.query(
      'insert into public.profiles(id,role,kyc_status) values($1,$2,$3)',
      [riderId, 'rider', 'approved']
    );
    await db.query(
      'insert into public.wallets(id,user_id,currency,balance,reserved_balance,monime_account_id) values($1,$2,$3,$4,$5,$6)',
      [walletId, riderId, 'SLE', 1000, 0, 'fac-rider-wallet']
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [riderId]);

    const payout = await db.query(
      'select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5) as result',
      [100, 'SLE', 'mobile_money', '+23276543210', 'rider-withdrawal-idem-001']
    );
    assert.equal(payout.rows[0].result.success, true);
    assert.equal(payout.rows[0].result.duplicate, false);
    const balance = await db.query('select balance,reserved_balance from public.wallets where id=$1', [walletId]);
    assert.equal(Number(balance.rows[0].reserved_balance), 100);
    assert.equal(Number(balance.rows[0].balance) - Number(balance.rows[0].reserved_balance), 900);

    const duplicate = await db.query(
      'select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5) as result',
      [100, 'SLE', 'mobile_money', '+23276543210', 'rider-withdrawal-idem-001']
    );
    assert.equal(duplicate.rows[0].result.duplicate, true);
    const afterDuplicate = await db.query('select reserved_balance from public.wallets where id=$1', [walletId]);
    assert.equal(Number(afterDuplicate.rows[0].reserved_balance), 100);

    await db.query('update public.wallets set is_frozen=true where id=$1', [walletId]);
    await assert.rejects(
      db.query(
        'select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',
        [50, 'SLE', 'mobile_money', '+23276543210', 'rider-withdrawal-frozen']
      ),
      /Wallet is frozen/
    );
    await db.query('update public.wallets set is_frozen=false where id=$1', [walletId]);
    await db.query("update public.profiles set kyc_status='pending' where id=$1", [riderId]);
    await assert.rejects(
      db.query(
        'select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',
        [50, 'SLE', 'mobile_money', '+23276543210', 'rider-withdrawal-kyc-pending']
      ),
      /KYC approval is required/
    );
    await db.query("update public.profiles set kyc_status='approved' where id=$1", [riderId]);

    const monimeWithdrawal = await db.query(
      'select public.matmove_prepare_withdrawal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
      ['a'.repeat(64), riderId, walletId, 'fac-rider-wallet', 'fac-platform', 5000, 50, 29, 'mobile_money', '+23276543210']
    );
    assert.equal(monimeWithdrawal.rows[0].result.user_id, riderId);
    assert.equal(monimeWithdrawal.rows[0].result.state, 'fee_pending');
    const legs = await db.query(
      'select kind,amount_minor from public.matmove_withdrawal_legs order by kind'
    );
    assert.deepEqual(legs.rows, [
      { kind: 'fee', amount_minor: 29 },
      { kind: 'payout', amount_minor: 5000 }
    ]);

    await db.query(
      "update public.matmove_loading_bonanza_campaign set enabled=true, minimum_topup_minor=5000, budget_minor=100000, treasury_account='fac-referral' where singleton=true"
    );
    await db.query(
      "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)"
    );
    const topup = await db.query(
      'select public.matmove_loading_bonanza_record_topup($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [riderId, walletId, 'code-rider-001', 'pay-rider-topup', 10000, 100, 9900, 'fac-rider-wallet']
    );
    const topupId = topup.rows[0].result.id;
    const reward = await db.query(
      'select * from public.matmove_loading_bonanza_rewards where topup_id=$1',
      [topupId]
    );
    assert.equal(reward.rows.length, 1);
    assert.equal(Number(reward.rows[0].cashback_minor), 99);
    const claimed = await db.query(
      'select public.matmove_loading_bonanza_claim($1,$2,clock_timestamp()) as result',
      [reward.rows[0].id, 100000]
    );
    assert.equal(claimed.rows[0].result.can_create, true);
    const receipt = {
      id: 'trn-rider-cashback',
      amount: { currency: 'SLE', value: '99' },
      sourceFinancialAccount: { id: 'fac-referral' },
      destinationFinancialAccount: { id: 'fac-rider-wallet' },
      metadata: {
        matmoveLoadingBonanzaRewardId: reward.rows[0].id,
        matmoveLoadingBonanzaTopupId: topupId,
        matmoveMonimePaymentId: 'pay-rider-topup',
        matmoveRequestKey: reward.rows[0].request_key
      },
      status: 'completed'
    };
    const recorded = await db.query(
      'select public.matmove_loading_bonanza_record($1,$2::jsonb) as result',
      [reward.rows[0].id, JSON.stringify(receipt)]
    );
    assert.equal(recorded.rows[0].result.state, 'completed');
  } finally {
    await db.close();
  }
});
