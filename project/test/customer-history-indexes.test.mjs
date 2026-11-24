import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('customer trip and order history indexes support owner/newest-first lookups without changing data', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20261124000500_matmove_customer_history_lookup_indexes_v1.sql', import.meta.url),
    'utf8'
  );
  const expected = [
    ['matmove_bookings_rider_created_idx', 'bookings', 'rider_id', 'created_at DESC'],
    ['matmove_bookings_driver_created_idx', 'bookings', 'driver_id', 'created_at DESC'],
    ['matmove_app_orders_rider_created_idx', 'app_orders', 'rider_id', 'created_at DESC'],
    ['matmove_app_orders_merchant_created_idx', 'app_orders', 'merchant_id', 'created_at DESC'],
  ];

  assert.equal((sql.match(/CREATE INDEX IF NOT EXISTS/gi) || []).length, expected.length);
  assert.doesNotMatch(sql, /DROP\s+(?:INDEX|TABLE)|TRUNCATE|DELETE\s+FROM/i, 'the migration must not remove indexes, tables or records');

  const db = new PGlite();
  try {
    await db.exec(`
      create table public.bookings (
        id integer generated always as identity primary key,
        rider_id uuid not null,
        driver_id uuid,
        created_at timestamptz not null default now()
      );
      create table public.app_orders (
        id integer generated always as identity primary key,
        rider_id uuid not null,
        merchant_id uuid not null,
        created_at timestamptz not null default now()
      );

      insert into public.bookings(rider_id, driver_id, created_at)
      values
        ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','2026-11-22T10:00:00Z'),
        ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','2026-11-23T10:00:00Z'),
        ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','2026-11-24T10:00:00Z');

      insert into public.app_orders(rider_id, merchant_id, created_at)
      values
        ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-11-22T10:00:00Z'),
        ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','2026-11-23T10:00:00Z'),
        ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','2026-11-24T10:00:00Z');
    `);

    await db.exec(sql);
    await db.exec(sql); // IF NOT EXISTS makes a safe rerun a no-op.

    const indexes = await db.query(`
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname='public'
        and indexname in (
          'matmove_bookings_rider_created_idx',
          'matmove_bookings_driver_created_idx',
          'matmove_app_orders_rider_created_idx',
          'matmove_app_orders_merchant_created_idx'
        )
      order by indexname
    `);
    assert.equal(indexes.rows.length, expected.length, 'all four indexes exist exactly once');

    for (const [name, table, ownerColumn, dateSort] of expected) {
      const index = indexes.rows.find(row => row.indexname === name);
      assert.ok(index, name + ' exists');
      assert.equal(index.tablename, table);
      assert.match(index.indexdef, new RegExp('\\(' + ownerColumn + ', created_at DESC\\)', 'i'));
      assert.match(index.indexdef, /USING btree/i);
    }

    const bookingRows = await db.query('select count(*)::int as n from public.bookings');
    const orderRows = await db.query('select count(*)::int as n from public.app_orders');
    assert.equal(bookingRows.rows[0].n, 3, 'booking rows remain unchanged');
    assert.equal(orderRows.rows[0].n, 3, 'order rows remain unchanged');

    const orderedBookings = await db.query(
      'select id from public.bookings where rider_id=$1 order by created_at desc',
      ['10000000-0000-4000-8000-000000000001']
    );
    assert.deepEqual(orderedBookings.rows.map(row => row.id), [2, 1]);
  } finally {
    await db.close();
  }
});
