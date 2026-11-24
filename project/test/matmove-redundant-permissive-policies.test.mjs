import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = async (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('redundant permissive policy cleanup preserves wallet, transaction, ticket, withdrawal and staff access', async () => {
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
      create function public.matmove_admin_any(text[]) returns boolean
      language sql stable as $$
        select coalesce(current_setting('test.matmove_admin', true), 'false') = 'true'
      $$;
      create function public.matmove_admin_can(text) returns boolean
      language sql stable as $$
        select coalesce(current_setting('test.matmove_admin', true), 'false') = 'true'
      $$;

      create table public.wallets (id integer primary key, user_id uuid not null, currency text not null);
      create table public.wallet_transactions (id integer primary key, wallet_id integer not null);
      create table public.event_tickets (id integer primary key, user_id uuid not null, checked_in boolean not null default false);
      create table public.withdrawal_requests (id integer primary key, user_id uuid not null);

      alter table public.wallets enable row level security;
      alter table public.wallet_transactions enable row level security;
      alter table public.event_tickets enable row level security;
      alter table public.withdrawal_requests enable row level security;

      create policy "Service role full access on wallets" on public.wallets
        for all to service_role using (true) with check (true);
      create policy "Users can only view own wallet" on public.wallets
        for select to public using (auth.uid() = user_id);
      create policy "Users can view own wallet" on public.wallets
        for select to public using (auth.uid() = user_id);
      create policy "Users can view their own wallets" on public.wallets
        for select to authenticated using (auth.uid() = user_id);
      create policy wallets_select_own on public.wallets
        for select to authenticated using (user_id = auth.uid());
      create policy matmove_lock_wallets_select on public.wallets
        as restrictive for select to authenticated using (
          (user_id = (select auth.uid())) or
          public.matmove_admin_any(array['financials'::text, 'payouts'::text, 'transactions'::text])
        );
      create policy matmove_staff_allow_select on public.wallets
        for select to authenticated using (public.matmove_admin_any(array['financials'::text]));

      create policy "Users can view own wallet transactions" on public.wallet_transactions
        for select to public using (
          exists (
            select 1 from public.wallets
            where wallets.id = wallet_transactions.wallet_id
              and wallets.user_id = auth.uid()
          )
        );
      create policy wallet_transactions_select_own on public.wallet_transactions
        for select to authenticated using (
          exists (
            select 1 from public.wallets w
            where w.id = wallet_transactions.wallet_id
              and w.user_id = auth.uid()
          )
        );
      create policy matmove_lock_wallet_transactions_select on public.wallet_transactions
        as restrictive for select to authenticated using (
          exists (
            select 1 from public.wallets w
            where w.id = wallet_transactions.wallet_id
              and w.user_id = (select auth.uid())
          ) or public.matmove_admin_any(array['financials'::text, 'payouts'::text, 'transactions'::text])
        );
      create policy matmove_staff_allow_select on public.wallet_transactions
        for select to authenticated using (public.matmove_admin_any(array['financials'::text, 'transactions'::text]));

      create policy "Users view own tickets" on public.event_tickets
        for select to public using (auth.uid() = user_id);
      create policy matmove_event_tickets_owner_read on public.event_tickets
        for select to authenticated using (user_id = (select auth.uid()));
      create policy matmove_event_tickets_checkin_update on public.event_tickets
        as restrictive for update to authenticated
        using (public.matmove_admin_can('events.checkin'))
        with check (public.matmove_admin_can('events.checkin'));
      create policy matmove_event_tickets_staff_checkin on public.event_tickets
        for update to authenticated
        using (public.matmove_admin_can('events.checkin'))
        with check (public.matmove_admin_can('events.checkin'));
      create policy matmove_event_tickets_staff_checkin_update on public.event_tickets
        for update to authenticated
        using (public.matmove_admin_can('events.checkin'))
        with check (public.matmove_admin_can('events.checkin'));
      create policy matmove_event_tickets_staff_read on public.event_tickets
        for select to authenticated
        using (public.matmove_admin_any(array['events.sales'::text, 'events.checkin'::text]));
      create policy matmove_lock_event_tickets_select on public.event_tickets
        as restrictive for select to authenticated using (
          (user_id = (select auth.uid())) or
          public.matmove_admin_any(array['events.sales'::text, 'events.checkin'::text])
        );

      create policy "Users can create withdrawal requests" on public.withdrawal_requests
        for insert to public with check (auth.uid() = user_id);
      create policy "Users can view own withdrawal requests" on public.withdrawal_requests
        for select to public using (auth.uid() = user_id);
      create policy matmove_lock_withdrawal_requests_select on public.withdrawal_requests
        as restrictive for select to authenticated using (
          (user_id = (select auth.uid())) or public.matmove_admin_can('payouts')
        );
      create policy matmove_staff_allow_select on public.withdrawal_requests
        for select to authenticated using (public.matmove_admin_any(array['payouts'::text]));
      create policy withdrawal_requests_select_own on public.withdrawal_requests
        for select to authenticated using (user_id = auth.uid());

      grant select on public.wallets, public.wallet_transactions, public.event_tickets, public.withdrawal_requests to anon, authenticated;
      grant insert on public.withdrawal_requests to authenticated;
      grant update on public.event_tickets to authenticated;
    `);

    await db.exec(await migration('20261124000200_matmove_remove_redundant_permissive_select_policies_v1.sql'));

    const policyRows = await db.query(`
      select tablename, policyname, permissive, roles, cmd
      from pg_policies
      where schemaname='public'
      order by tablename, policyname
    `);
    const names = new Set(policyRows.rows.map((row) => `${row.tablename}.${row.policyname}`));
    const removed = [
      'wallets.Users can view own wallet',
      'wallets.Users can view their own wallets',
      'wallets.wallets_select_own',
      'wallet_transactions.wallet_transactions_select_own',
      'event_tickets.matmove_event_tickets_owner_read',
      'event_tickets.matmove_event_tickets_staff_checkin_update',
      'withdrawal_requests.withdrawal_requests_select_own'
    ];
    for (const name of removed) assert.equal(names.has(name), false, `${name} should be removed`);

    const retained = [
      'wallets.Users can only view own wallet',
      'wallets.matmove_lock_wallets_select',
      'wallets.matmove_staff_allow_select',
      'wallet_transactions.Users can view own wallet transactions',
      'wallet_transactions.matmove_lock_wallet_transactions_select',
      'wallet_transactions.matmove_staff_allow_select',
      'event_tickets.Users view own tickets',
      'event_tickets.matmove_event_tickets_checkin_update',
      'event_tickets.matmove_event_tickets_staff_checkin',
      'event_tickets.matmove_event_tickets_staff_read',
      'event_tickets.matmove_lock_event_tickets_select',
      'withdrawal_requests.Users can create withdrawal requests',
      'withdrawal_requests.Users can view own withdrawal requests',
      'withdrawal_requests.matmove_lock_withdrawal_requests_select',
      'withdrawal_requests.matmove_staff_allow_select'
    ];
    for (const name of retained) assert.equal(names.has(name), true, `${name} must remain`);
    assert.equal(policyRows.rows.length, 15);

    const user1 = '10000000-0000-4000-8000-000000000001';
    const user2 = '10000000-0000-4000-8000-000000000002';
    const admin = '10000000-0000-4000-8000-000000000003';
    await db.query('insert into public.wallets(id,user_id,currency) values (1,$1,$2),(2,$3,$2)', [user1,'SLE',user2]);
    await db.query('insert into public.wallet_transactions(id,wallet_id) values (11,1),(22,2)');
    await db.query('insert into public.event_tickets(id,user_id) values (101,$1),(202,$2)', [user1,user2]);
    await db.query('insert into public.withdrawal_requests(id,user_id) values (301,$1),(302,$2)', [user1,user2]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user1]);
    await db.exec('set role authenticated');
    const ownWallets = await db.query('select id from public.wallets order by id');
    const ownTransactions = await db.query('select id from public.wallet_transactions order by id');
    const ownTickets = await db.query('select id from public.event_tickets order by id');
    const ownWithdrawals = await db.query('select id from public.withdrawal_requests order by id');
    assert.deepEqual(ownWallets.rows.map((row) => row.id), [1]);
    assert.deepEqual(ownTransactions.rows.map((row) => row.id), [11]);
    assert.deepEqual(ownTickets.rows.map((row) => row.id), [101]);
    assert.deepEqual(ownWithdrawals.rows.map((row) => row.id), [301]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.query("select set_config('test.matmove_admin','true',false)");
    const staffWallets = await db.query('select id from public.wallets order by id');
    const staffTransactions = await db.query('select id from public.wallet_transactions order by id');
    const staffTickets = await db.query('select id from public.event_tickets order by id');
    const staffWithdrawals = await db.query('select id from public.withdrawal_requests order by id');
    assert.deepEqual(staffWallets.rows.map((row) => row.id), [1,2], 'financial staff retain wallet review');
    assert.deepEqual(staffTransactions.rows.map((row) => row.id), [11,22], 'financial staff retain transaction review');
    assert.deepEqual(staffTickets.rows.map((row) => row.id), [101,202], 'event staff retain ticket review');
    assert.deepEqual(staffWithdrawals.rows.map((row) => row.id), [301,302], 'payout staff retain withdrawal review');
    await db.query('update public.event_tickets set checked_in=true where id=101');
    const checked = await db.query('select checked_in from public.event_tickets where id=101');
    assert.equal(checked.rows[0].checked_in, true, 'event staff retain check-in updates');
    await db.exec('reset role');

    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role anon');
    const anonWallets = await db.query('select id from public.wallets');
    const anonTransactions = await db.query('select id from public.wallet_transactions');
    const anonTickets = await db.query('select id from public.event_tickets');
    const anonWithdrawals = await db.query('select id from public.withdrawal_requests');
    assert.equal(anonWallets.rows.length, 0);
    assert.equal(anonTransactions.rows.length, 0);
    assert.equal(anonTickets.rows.length, 0);
    assert.equal(anonWithdrawals.rows.length, 0);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});
