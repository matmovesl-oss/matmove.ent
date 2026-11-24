import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('duplicate-index cleanup retains query coverage and the wallet uniqueness constraint', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.wallets (
        id integer generated always as identity primary key,
        user_id uuid not null,
        currency text not null,
        constraint unique_user_currency unique(user_id, currency)
      );
      create unique index wallets_one_wallet_per_user_currency_idx
        on public.wallets(user_id, currency);

      create table public.concierge_interests (
        id integer generated always as identity primary key,
        customer_id uuid not null,
        created_at timestamptz not null default now()
      );
      create index concierge_interest_customer_created_idx
        on public.concierge_interests(customer_id, created_at desc);
      create index concierge_interests_customer_created_idx
        on public.concierge_interests(customer_id, created_at desc);

      insert into public.wallets(user_id,currency)
      values ('10000000-0000-4000-8000-000000000001','SLE');
      insert into public.concierge_interests(customer_id)
      values ('10000000-0000-4000-8000-000000000001');
    `);

    const migration = await readFile(
      new URL('../supabase/migrations/20261124000300_matmove_drop_duplicate_indexes_v1.sql', import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(migration, /DROP\s+CONSTRAINT/i, 'the migration must not drop constraints');
    assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i, 'the migration must not change data');
    await db.exec(migration);

    const indexes = await db.query(`
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname='public'
      order by tablename,indexname
    `);
    const present = new Set(indexes.rows.map((row) => row.indexname));
    assert.equal(present.has('concierge_interests_customer_created_idx'), false);
    assert.equal(present.has('wallets_one_wallet_per_user_currency_idx'), false);
    assert.equal(present.has('concierge_interest_customer_created_idx'), true);
    assert.equal(present.has('unique_user_currency'), true);

    const constraint = await db.query(`
      select conname, contype
      from pg_constraint
      where conrelid='public.wallets'::regclass and conname='unique_user_currency'
    `);
    assert.deepEqual(constraint.rows, [{ conname: 'unique_user_currency', contype: 'u' }]);

    await assert.rejects(
      db.query('insert into public.wallets(user_id,currency) values ($1,$2)', [
        '10000000-0000-4000-8000-000000000001',
        'SLE'
      ]),
      /duplicate key|unique/i,
      'the retained unique constraint must still reject duplicate wallets'
    );

    const walletRows = await db.query('select count(*)::int as count from public.wallets');
    const interestRows = await db.query('select count(*)::int as count from public.concierge_interests');
    assert.equal(walletRows.rows[0].count, 1, 'wallet data is unchanged');
    assert.equal(interestRows.rows[0].count, 1, 'concierge interest data is unchanged');
  } finally {
    await db.close();
  }
});
