import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const sql = await readFile(new URL('../docs/EXPO_PUSH_NOTIFICATIONS_SETUP.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/matmove-push/index.ts', import.meta.url), 'utf8');
const setup = await readFile(new URL('../docs/EXPO_PUSH_NOTIFICATIONS_SETUP.md', import.meta.url), 'utf8');

test('Expo push token storage is private and only authenticated RPCs can register or unregister tokens', () => {
  assert.match(sql, /create table if not exists public\.matmove_push_tokens/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.matmove_push_tokens from public, anon, authenticated/i);
  assert.match(sql, /grant select, update on table public\.matmove_push_tokens to service_role/i);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /matmove_notification_customer\(v_user\)/);
  assert.match(sql, /grant execute on function public\.matmove_register_push_token\(text, text\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.matmove_unregister_push_token\(text\) to authenticated/i);
  assert.match(sql, /on conflict \(expo_push_token\) do update/i);
});

test('push webhook validates its dedicated secret and accepts only per-recipient inbox inserts', () => {
  assert.match(edge, /MATMOVE_PUSH_WEBHOOK_SECRET/);
  assert.match(edge, /x-matmove-push-secret/);
  assert.match(edge, /payload\?\.type !== 'INSERT'/);
  assert.match(edge, /payload\.table !== 'matmove_notification_inbox'/);
  assert.match(edge, /payload\.schema !== 'public'/);
  assert.match(edge, /matmove_notification_messages/);
  assert.match(edge, /matmove_push_tokens/);
});

test('phone push alerts never expose private notification message content', () => {
  assert.match(edge, /title: 'MatMove update'/);
  assert.match(edge, /body: 'You have a new notification\. Open MatMove to view it\.'/);
  assert.match(edge, /destination:/);
  assert.doesNotMatch(edge, /body: message\.body/);
  assert.doesNotMatch(edge, /title: message\.title/);
});

test('stale Expo device tokens are disabled after DeviceNotRegistered responses', () => {
  assert.match(edge, /DeviceNotRegistered/);
  assert.match(edge, /disabled_at: new Date\(\)\.toISOString\(\)/);
});

test('setup requires server-only Expo secrets and a physical-device test before production', () => {
  assert.match(setup, /EXPO_ACCESS_TOKEN/);
  assert.match(setup, /MATMOVE_PUSH_WEBHOOK_SECRET/);
  assert.match(setup, /physical iPhone or Android device/i);
  assert.match(setup, /single test customer account only/i);
});

test('Expo push token SQL applies and enforces authenticated ownership in isolated PostgreSQL', async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   create role anon;
   create role authenticated;
   create role service_role;
   create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$
     select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
   $$;
   create function public.matmove_notification_customer(p_user uuid)
     returns boolean language sql stable as $$ select p_user is not null $$;
   insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
   select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
  `);
  await db.exec(sql);
  const registered = await db.query(
   'select public.matmove_register_push_token($1,$2) as result',
   ['ExponentPushToken[abcdef1234567890]', 'ios']
  );
  assert.equal(registered.rows[0].result.registered, true);
  assert.equal(registered.rows[0].result.user_id, '10000000-0000-4000-8000-000000000001');
  const access = await db.query(`
   select
    has_table_privilege('authenticated','public.matmove_push_tokens','select') as client_can_read,
    has_table_privilege('service_role','public.matmove_push_tokens','select') as dispatcher_can_read,
    has_function_privilege('authenticated','public.matmove_register_push_token(text,text)','execute') as customer_can_register,
    has_function_privilege('anon','public.matmove_register_push_token(text,text)','execute') as anonymous_can_register
  `);
  assert.equal(access.rows[0].client_can_read, false);
  assert.equal(access.rows[0].dispatcher_can_read, true);
  assert.equal(access.rows[0].customer_can_register, true);
  assert.equal(access.rows[0].anonymous_can_register, false);
  await assert.rejects(
   db.query('select public.matmove_register_push_token($1,$2)', ['not-a-token', 'ios']),
   /invalid/i
  );
  const removed = await db.query(
   'select public.matmove_unregister_push_token($1) as result',
   ['ExponentPushToken[abcdef1234567890]']
  );
  assert.equal(removed.rows[0].result.unregistered, true);
  const state = await db.query('select disabled_at from public.matmove_push_tokens');
  assert.ok(state.rows[0].disabled_at);
 } finally {
  await db.close();
 }
});
