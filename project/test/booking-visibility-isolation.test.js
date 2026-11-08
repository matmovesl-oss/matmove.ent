import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const riderId = '00000000-0000-0000-0000-000000000001';
const otherRiderId = '00000000-0000-0000-0000-000000000002';
const otherDriverId = '00000000-0000-0000-0000-000000000003';
const driverId = '00000000-0000-0000-0000-000000000004';
const staffId = '00000000-0000-0000-0000-000000000005';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      role text
    );
    CREATE TABLE public.matmove_staff_access (
      id uuid PRIMARY KEY,
      is_active boolean NOT NULL DEFAULT true,
      removed_at timestamptz
    );

    INSERT INTO public.profiles(id, role) VALUES
      ('${riderId}', 'rider'),
      ('${driverId}', 'driver'),
      ('${staffId}', 'rider');
    INSERT INTO public.matmove_staff_access(id, is_active, removed_at)
    VALUES ('${staffId}', true, null);

    CREATE FUNCTION public.matmove_admin_can(text)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

    CREATE FUNCTION public.matmove_driver_radar_visible(uuid, uuid, text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce($2 = auth.uid(), false)
    $$;
  `);

  const migration = await readFile(
    new URL('../supabase/migrations/20261108185004_matmove_booking_read_policy_customer_isolation_v1.sql', import.meta.url),
    'utf8'
  );
  await db.exec(migration);
  return db;
}

async function canRead(db, actor, rider, driver, status = 'pending') {
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [actor]
  );
  const result = await db.query(
    'select public.matmove_dispatch_booking_visible($1, $2, $3) as allowed',
    [rider, driver, status]
  );
  return result.rows[0].allowed;
}

test('unrelated signed-in customer cannot read another customer booking', async () => {
  const db = await fixture();
  try {
    assert.equal(await canRead(db, riderId, otherRiderId, otherDriverId), false);
  } finally {
    await db.close();
  }
});

test('rider can read a booking they own', async () => {
  const db = await fixture();
  try {
    assert.equal(await canRead(db, riderId, riderId, otherDriverId), true);
  } finally {
    await db.close();
  }
});

test('assigned driver can read their assigned booking', async () => {
  const db = await fixture();
  try {
    assert.equal(await canRead(db, driverId, riderId, driverId, 'accepted'), true);
  } finally {
    await db.close();
  }
});

test('staff without dispatch permission cannot read unrelated bookings', async () => {
  const db = await fixture();
  try {
    assert.equal(await canRead(db, staffId, riderId, driverId, 'accepted'), false);
  } finally {
    await db.close();
  }
});

test('staff can read a booking where they are a participant', async () => {
  const db = await fixture();
  try {
    assert.equal(await canRead(db, staffId, riderId, staffId, 'accepted'), true);
  } finally {
    await db.close();
  }
});
