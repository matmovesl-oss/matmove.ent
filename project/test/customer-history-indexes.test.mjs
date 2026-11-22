import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer and merchant history indexes match owner-filtered newest-first queries', async () => {
  const sql = await readFile(
    'docs/pending-migrations/matmove_customer_trip_order_history_indexes_v1.sql',
    'utf8'
  );

  assert.match(sql, /create index if not exists matmove_bookings_rider_created_idx\s+on public\.bookings\s*\(rider_id,\s*created_at desc\)/i);
  assert.match(sql, /create index if not exists matmove_bookings_driver_created_idx\s+on public\.bookings\s*\(driver_id,\s*created_at desc\)/i);
  assert.match(sql, /create index if not exists matmove_app_orders_rider_created_idx\s+on public\.app_orders\s*\(rider_id,\s*created_at desc\)/i);
  assert.match(sql, /create index if not exists matmove_app_orders_merchant_created_idx\s+on public\.app_orders\s*\(merchant_id,\s*created_at desc\)/i);
  assert.doesNotMatch(sql, /drop index|drop table|delete from/i);
});
