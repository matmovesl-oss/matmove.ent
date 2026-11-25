import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const staff = '22222222-2222-4222-8222-222222222222';
const rider = '33333333-3333-4333-8333-333333333333';
const driver = '44444444-4444-4444-8444-444444444444';
const merchant = '55555555-5555-4555-8555-555555555555';
const other = '66666666-6666-4666-8666-666666666666';
const tokenA = 'ExpoPushToken[AbCdEfGhIjKlMnOpQrStUvWx]';
const tokenB = 'ExponentPushToken[ZyXwVuTsRqPoNmLkJiHgFeDc]';

test('native Expo push tokens are owner-bound and unavailable to customer table queries', async (t) => {
  const db = new PGlite({
    postgresqlconf: ['shared_buffers=16MB', 'max_connections=10', 'work_mem=1MB', 'maintenance_work_mem=8MB'],
  });

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key);
      insert into auth.users values
        ('${owner}'), ('${staff}'), ('${rider}'), ('${driver}'), ('${merchant}'), ('${other}');
      create table profiles(id uuid primary key references auth.users(id), role text, kyc_status text);
      insert into profiles values
        ('${owner}','admin','approved'),
        ('${staff}','rider','approved'),
        ('${rider}','rider','pending'),
        ('${driver}','driver','pending'),
        ('${merchant}','merchant','rejected'),
        ('${other}','rider','approved');
      create table user_roles(profile_id uuid, role text);
      insert into user_roles values
        ('${owner}','admin'), ('${staff}','rider'), ('${rider}','rider'),
        ('${driver}','driver'), ('${merchant}','merchant'), ('${other}','rider');
      create table wallets(user_id uuid, balance numeric);
      insert into wallets values ('${rider}',42.50);
      create table matmove_staff_access(
        id uuid primary key, is_owner boolean, is_active boolean, permissions jsonb, removed_at timestamptz
      );
      insert into matmove_staff_access values
        ('${owner}',true,true,'[]',null),
        ('${staff}',false,true,'["customers"]',null);
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);

    await db.exec(await readFile('docs/PORTAL_HOME_SETUP.sql', 'utf8'));
    await db.exec(await readFile('docs/NOTIFICATIONS_SETUP.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/20261125141500_matmove_native_push_tokens_v1.sql', 'utf8'));

    const session = async (id, role = 'authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
      await db.exec('set role ' + role);
    };
    const register = async (token, platform = 'android') =>
      (await db.query('select public.matmove_register_push_token($1,$2) as result', [token, platform])).rows[0].result;
    const unregister = async (token) =>
      (await db.query('select public.matmove_unregister_push_token($1) as result', [token])).rows[0].result;
    const stored = async () => {
      await db.exec('reset role');
      return (await db.query('select user_id,expo_push_token,platform from public.matmove_push_tokens order by expo_push_token')).rows;
    };

    await t.test('a signed-in customer registers a valid token idempotently', async () => {
      await session(rider);
      const first = await register(tokenA, 'android');
      const second = await register(tokenA, 'ios');
      assert.equal(first.user_id, rider);
      assert.equal(first.registered, true);
      assert.equal(second.registered, true);
      assert.equal(second.platform, 'ios');
      const rows = await stored();
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], { user_id: rider, expo_push_token: tokenA, platform: 'ios' });
    });

    await t.test('a different customer cannot claim a token already linked to another account', async () => {
      await session(driver);
      await assert.rejects(() => register(tokenA, 'android'), /already linked to another MatMove account/);
      const rows = await stored();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_id, rider);
    });

    await t.test('each supported customer role can register a separate device token', async () => {
      await session(driver);
      assert.equal((await register(tokenB, 'android')).user_id, driver);
      const rows = await stored();
      assert.equal(rows.length, 2);
      assert.equal(rows.filter(row => row.user_id === driver).length, 1);
      await session(merchant);
      const tokenC = 'ExpoPushToken[MnBvCxZaSdFgHjKlQwErTyUi]';
      assert.equal((await register(tokenC, 'ios')).user_id, merchant);
    });

    await t.test('admins and active staff cannot register customer push tokens', async () => {
      await session(owner);
      await assert.rejects(() => register('ExpoPushToken[OwnerToken12345678]', 'ios'), /verified MatMove customer/);
      await session(staff);
      await assert.rejects(() => register('ExpoPushToken[StaffToken12345678]', 'ios'), /verified MatMove customer/);
    });

    await t.test('malformed tokens and unsupported platforms are rejected', async () => {
      await session(other);
      await assert.rejects(() => register('not-an-expo-token', 'ios'), /device notification details are invalid/);
      await assert.rejects(() => register('ExpoPushToken[AbCdEfGhIjKlMnOpQrStUvWx]', 'web'), /device notification details are invalid/);
    });

    await t.test('unregister only deletes the signed-in account token', async () => {
      await session(driver);
      const result = await unregister(tokenA);
      assert.equal(result.user_id, driver);
      assert.equal(result.unregistered, true);
      let rows = await stored();
      assert.ok(rows.some(row => row.user_id === rider && row.expo_push_token === tokenA));
      await session(rider);
      await unregister(tokenA);
      rows = await stored();
      assert.ok(!rows.some(row => row.expo_push_token === tokenA));
    });

    await t.test('unauthenticated callers cannot execute registration or unregister RPCs', async () => {
      await session(null, 'anon');
      await assert.rejects(() => register(tokenA), /permission denied/i);
      await assert.rejects(() => unregister(tokenA), /permission denied/i);
    });

    await t.test('authenticated customers cannot read or write the token table directly', async () => {
      await session(rider);
      await assert.rejects(() => db.query('select * from public.matmove_push_tokens'), /permission denied/i);
      await assert.rejects(
        () => db.query(
          'insert into public.matmove_push_tokens(user_id,expo_push_token,platform) values($1,$2,$3)',
          [rider, tokenA, 'ios'],
        ),
        /permission denied/i,
      );
      const policies = await db.query(
        "select count(*)::int as count from pg_policies where schemaname='public' and tablename='matmove_push_tokens'",
      );
      assert.equal(policies.rows[0].count, 0);
    });

    await t.test('service role can read and prune device tokens for delivery', async () => {
      await session(null, 'service_role');
      const rows = await db.query('select expo_push_token from public.matmove_push_tokens');
      assert.ok(rows.rows.length >= 1);
      await db.query('delete from public.matmove_push_tokens where expo_push_token=$1', [tokenB]);
      await db.exec('reset role');
      const remaining = await db.query('select count(*)::int as count from public.matmove_push_tokens where expo_push_token=$1', [tokenB]);
      assert.equal(remaining.rows[0].count, 0);
    });

    await t.test('registration requires a real authenticated identity', async () => {
      await session(null, 'authenticated');
      await assert.rejects(() => register(tokenA), /Sign in before enabling/);
    });
  } finally {
    await db.close();
  }
});
