import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = () => readFile(
  new URL('../supabase/migrations/20261125145204_matmove_native_push_notifications_v1.sql', import.meta.url),
  'utf8'
);

const rider = '11111111-1111-4111-8111-111111111111';
const driver = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const message = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const riderToken = 'ExpoPushToken[Abcdefgh12345678]';
const driverToken = 'ExponentPushToken[Qwertyui12345678]';

test('native push tokens are private, customer-owned and dispatchable only by service_role', async () => {
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
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users(id), role text not null);
      create table public.matmove_notification_messages(
        id uuid primary key,
        destination text,
        title text not null,
        body text not null,
        recipient_count integer not null default 0,
        deleted_at timestamptz
      );
      create table public.matmove_notification_inbox(
        id bigint generated always as identity primary key,
        message_id uuid not null references public.matmove_notification_messages(id),
        user_id uuid not null references auth.users(id)
      );
      create function public.matmove_notification_customer(p_id uuid)
      returns boolean language sql stable security definer
      set search_path='pg_catalog','public'
      as $$
        select exists(
          select 1 from public.profiles p
          join auth.users u on u.id=p.id
          where p.id=p_id and p.role in ('rider','driver','merchant')
        )
      $$;

      insert into auth.users values
        ('${rider}'), ('${driver}'), ('${admin}');
      insert into public.profiles values
        ('${rider}','rider'), ('${driver}','driver'), ('${admin}','admin');
      insert into public.matmove_notification_messages
        (id,destination,title,body,recipient_count)
      values ('${message}','wallet','Private heading','Private message body',2);
      insert into public.matmove_notification_inbox(message_id,user_id)
      values ('${message}','${rider}'), ('${message}','${driver}');
    `);

    await db.exec(await migration());

    const session = async (userId, role = 'authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? '']);
      await db.exec(`set role ${role}`);
    };

    await session(rider);
    const registeredRider = await db.query(
      'select public.matmove_register_push_token($1,$2) as result',
      [riderToken, 'ios']
    );
    assert.deepEqual(registeredRider.rows[0].result, { user_id: rider, registered: true });

    await session(driver);
    const registeredDriver = await db.query(
      'select public.matmove_register_push_token($1,$2) as result',
      [driverToken, 'android']
    );
    assert.deepEqual(registeredDriver.rows[0].result, { user_id: driver, registered: true });

    await assert.rejects(
      db.query('select public.matmove_register_push_token($1,$2)', [riderToken, 'windows']),
      /platform is invalid/
    );

    await session(admin);
    await assert.rejects(
      db.query('select public.matmove_register_push_token($1,$2)', [riderToken, 'ios']),
      /verified MatMove customer account/
    );

    await session(rider);
    await assert.rejects(
      db.query('select * from private.matmove_push_tokens'),
      /permission denied/
    );
    await assert.rejects(
      db.query('select public.matmove_push_dispatch_context($1)', [message]),
      /permission denied/
    );

    await session(rider);
    const removedRider = await db.query(
      'select public.matmove_unregister_push_token($1) as result',
      [riderToken]
    );
    assert.deepEqual(removedRider.rows[0].result, { user_id: rider, unregistered: true });

    await session(driver, 'service_role');
    const context = await db.query(
      'select public.matmove_push_dispatch_context($1) as result',
      [message]
    );
    assert.equal(context.rows[0].result.message_id, message);
    assert.equal(context.rows[0].result.destination, 'wallet');
    assert.deepEqual(context.rows[0].result.tokens, [
      { token: driverToken, platform: 'android' }
    ]);
    assert.equal(JSON.stringify(context.rows[0].result).includes('Private message body'), false);
    assert.equal(JSON.stringify(context.rows[0].result).includes('Private heading'), false);

    const staleRemoved = await db.query(
      'select public.matmove_push_remove_invalid_token($1) as result',
      [driverToken]
    );
    assert.equal(staleRemoved.rows[0].result, true);
    const alreadyRemoved = await db.query(
      'select public.matmove_push_remove_invalid_token($1) as result',
      [driverToken]
    );
    assert.equal(alreadyRemoved.rows[0].result, false);

    await db.exec('reset role');
    await db.query('update public.matmove_notification_messages set deleted_at=now() where id=$1', [message]);
    await db.exec('set role service_role');
    const deletedContext = await db.query(
      'select public.matmove_push_dispatch_context($1) as result',
      [message]
    );
    assert.equal(deletedContext.rows[0].result, null);
  } finally {
    await db.close();
  }
});
