import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL(
  '../supabase/migrations/20261112170000_matmove_travel_purchase_single_payment.sql',
  import.meta.url
);

test('one travel booking cannot have multiple non-failed purchase payment attempts', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /create unique index if not exists matmove_travel_purchase_booking_once/i);
  assert.match(sql, /on public\.matmove_purchase_payments\s*\(booking_id\)/i);
  assert.match(sql, /purchase_type\s*=\s*'travel'/i);
  assert.match(sql, /state in \('initiating', 'pending', 'processing', 'completed', 'review_required'\)/i);
});

test('travel fulfilment rejects a second payment ID before changing an already-paid booking', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /from public\.travel_bookings[\s\S]*?for update/i);
  assert.match(sql, /if b\.is_paid and b\.payment_id is distinct from p\.id then[\s\S]*?raise exception 'CONFLICT:/i);
  assert.match(sql, /if b\.payment_id is not null and b\.payment_id is distinct from p\.id then[\s\S]*?raise exception 'CONFLICT:/i);
  assert.match(sql, /p\.provider_status <> 'completed'/i);
  assert.match(sql, /p\.state not in \('processing', 'completed'\)/i);
});

test('purchase fulfilment RPC remains service-role-only', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /revoke all on function public\.matmove_fulfill_purchase_payment\(uuid\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.matmove_fulfill_purchase_payment\(uuid\)[\s\S]*?to service_role/i);
});
