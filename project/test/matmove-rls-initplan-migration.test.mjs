import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationName = '20261124000100_matmove_rls_auth_uid_initplan_v1.sql';
const targets = [
  {
    "table": "admins",
    "name": "admins_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "app_orders",
    "name": "Merchants update orders",
    "cmd": "UPDATE",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "app_orders",
    "name": "Riders insert orders",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "app_orders",
    "name": "Users read own orders",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "bookings",
    "name": "Riders can create bookings",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "cart_items",
    "name": "Riders manage cart",
    "cmd": "ALL",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "event_tickets",
    "name": "Users view own tickets",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "kyc_documents",
    "name": "Users can insert own KYC documents",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "kyc_documents",
    "name": "Users can view own KYC documents",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "kyc_submissions",
    "name": "Users can insert own KYC submissions",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "kyc_submissions",
    "name": "Users can manage their own kyc",
    "cmd": "ALL",
    "hasUsing": true,
    "hasCheck": true
  },
  {
    "table": "kyc_submissions",
    "name": "Users can view own KYC submissions",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "ledger_accounts",
    "name": "ledger_accounts_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "ledger_entries",
    "name": "ledger_entries_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "ledger_transactions",
    "name": "ledger_transactions_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "matmove_account_deletion_requests",
    "name": "matmove_account_deletion_own_read",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "matmove_driver_presence",
    "name": "matmove_driver_presence_driver_read",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "matmove_kyc_drafts",
    "name": "matmove_kyc_draft_owner_read",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "payment_transactions",
    "name": "payment_transactions_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "products",
    "name": "matmove_catalog_insert",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "products",
    "name": "matmove_catalog_update",
    "cmd": "UPDATE",
    "hasUsing": true,
    "hasCheck": true
  },
  {
    "table": "profiles",
    "name": "Users can insert own profile",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "profiles",
    "name": "Users can update own profile",
    "cmd": "UPDATE",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "profiles",
    "name": "Users can view own profile",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallet_transactions",
    "name": "Users can view own wallet transactions",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallet_transactions",
    "name": "wallet_transactions_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallets",
    "name": "Users can only view own wallet",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallets",
    "name": "Users can view own wallet",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallets",
    "name": "Users can view their own wallets",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "wallets",
    "name": "wallets_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "withdrawal_requests",
    "name": "Users can create withdrawal requests",
    "cmd": "INSERT",
    "hasUsing": false,
    "hasCheck": true
  },
  {
    "table": "withdrawal_requests",
    "name": "Users can view own withdrawal requests",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  },
  {
    "table": "withdrawal_requests",
    "name": "withdrawal_requests_select_own",
    "cmd": "SELECT",
    "hasUsing": true,
    "hasCheck": false
  }
];

test('RLS auth.uid initplan migration preserves its 33 live policy targets and predicate access boundaries', async () => {
  const sql = await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8');
  const statements = [...sql.matchAll(/ALTER POLICY "((?:[^"]|"")*)" ON public\."((?:[^"]|"")*)"\s+([\s\S]*?);/g)];
  assert.equal(statements.length, 33, 'migration should alter exactly the 33 audited policies');

  const actual = statements.map(([, name, table, body]) => ({
    table: table.replace(/""/g, '"'),
    name: name.replace(/""/g, '"'),
    hasUsing: /\bUSING\s*\(/i.test(body),
    hasCheck: /\bWITH CHECK\s*\(/i.test(body)
  }));
  assert.deepEqual(
    actual.map(({ table, name }) => `${table}.${name}`).sort(),
    targets.map(({ table, name }) => `${table}.${name}`).sort(),
    'the altered table and policy names must match the live database audit exactly'
  );

  assert.equal(new Set(actual.map(({ table, name }) => `${table}.${name}`)).size, 33);
  for (const target of targets) {
    const statement = actual.find((item) => item.table === target.table && item.name === target.name);
    assert.equal(statement.hasUsing, target.hasUsing, `${target.table}.${target.name} USING shape must be preserved`);
    assert.equal(statement.hasCheck, target.hasCheck, `${target.table}.${target.name} WITH CHECK shape must be preserved`);
  }

  assert.doesNotMatch(sql, /\b(?:CREATE|DROP)\s+POLICY\b/i, 'migration must not add or remove policies');
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b/i, 'migration must not change table privileges');
  const uidCalls = [...sql.matchAll(/auth\.uid\(\)/gi)];
  assert.ok(uidCalls.length > 0);
  for (const call of uidCalls) {
    assert.match(sql.slice(Math.max(0, call.index - 40), call.index), /SELECT\s*$/i, 'every auth.uid call must be inside a scalar SELECT');
  }

  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function public.matmove_catalog_is_merchant() returns boolean
      language sql stable as $$ select true $$;

      create table public.admins(id uuid);
      create table public.app_orders(merchant_id uuid, rider_id uuid);
      create table public.bookings(rider_id uuid);
      create table public.cart_items(rider_id uuid);
      create table public.event_tickets(user_id uuid);
      create table public.kyc_documents(submission_id uuid);
      create table public.kyc_submissions(id uuid, profile_id uuid);
      create table public.ledger_accounts(id uuid, owner_profile_id uuid);
      create table public.ledger_entries(id uuid, ledger_account_id uuid);
      create table public.ledger_transactions(payment_transaction_id uuid);
      create table public.matmove_account_deletion_requests(user_id uuid);
      create table public.matmove_driver_presence(driver_id uuid);
      create table public.matmove_kyc_drafts(user_id uuid);
      create table public.payment_transactions(id uuid, user_id uuid);
      create table public.products(merchant_id uuid);
      create table public.profiles(id uuid);
      create table public.wallet_transactions(wallet_id uuid);
      create table public.wallets(id uuid, user_id uuid);
      create table public.withdrawal_requests(user_id uuid);
    `);

    const tables = [...new Set(targets.map((item) => item.table))];
    for (const table of tables) {
      await db.exec(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`);
    }
    for (const target of targets) {
      await db.exec(`CREATE POLICY "${target.name.replace(/"/g, '""')}" ON public."${target.table}" FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`);
    }
    await db.exec(sql);

    const applied = await db.query(`
      select tablename, policyname, qual, with_check
      from pg_policies where schemaname='public'
    `);
    assert.equal(applied.rows.length, 33, 'all policy objects must remain present after ALTER POLICY');

    for (const policy of applied.rows) {
      for (const expr of [policy.qual, policy.with_check].filter(Boolean)) {
        const unwrapped = expr.replace(/\(\s*SELECT\s+auth\.uid\(\)(?:\s+AS\s+uid)?\s*\)/gi, '');
        assert.doesNotMatch(unwrapped, /auth\.uid\(\)/i, `${policy.tablename}.${policy.policyname} has no direct row-level auth.uid call`);
      }
    }

    const owner = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    await db.query('insert into public.admins(id) values ($1), ($2)', [owner, other]);
    await db.query('grant select on public.admins to authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec('set role authenticated');
    const own = await db.query('select count(*)::int as n from public.admins');
    assert.equal(own.rows[0].n, 1, 'authenticated user can still read their own policy-protected row');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    const notOwn = await db.query('select count(*)::int as n from public.admins');
    assert.equal(notOwn.rows[0].n, 1, 'a different authenticated subject sees only their own row');
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
