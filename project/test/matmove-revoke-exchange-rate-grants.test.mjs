import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('exchange_rates remains publicly readable but authenticated direct writes are revoked', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.exchange_rates (
        id integer generated always as identity primary key,
        from_currency text not null,
        to_currency text not null,
        rate numeric not null,
        updated_at timestamptz not null default now()
      );
      alter table public.exchange_rates enable row level security;
      create policy "Allow public read access to exchange rates"
        on public.exchange_rates for select to public using (true);

      grant select on public.exchange_rates to anon, authenticated;
      grant insert, update, delete on public.exchange_rates to authenticated;
      grant all on public.exchange_rates to service_role;
      grant usage, select on sequence public.exchange_rates_id_seq to authenticated, service_role;

      insert into public.exchange_rates(from_currency,to_currency,rate)
      values ('USD','SLE',24.3);
    `);

    const sql = await readFile(
      new URL('../supabase/migrations/20261124000400_matmove_revoke_exchange_rate_client_writes_v1.sql', import.meta.url),
      'utf8'
    );
    assert.match(sql, /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.exchange_rates\s+FROM\s+authenticated/i);
    assert.doesNotMatch(sql, /REVOKE\s+SELECT/i);
    assert.doesNotMatch(sql, /FROM\s+(?:anon|service_role|public)\b/i);
    await db.exec(sql);

    for (const role of ['anon','authenticated']) {
      const readable = await db.query(
        'select has_table_privilege($1,\'public.exchange_rates\',\'SELECT\') as allowed',
        [role]
      );
      assert.equal(readable.rows[0].allowed, true, role + ' must retain public rate reads');
    }
    for (const privilege of ['INSERT','UPDATE','DELETE']) {
      const result = await db.query(
        'select has_table_privilege(\'authenticated\',\'public.exchange_rates\',$1) as allowed',
        [privilege]
      );
      assert.equal(result.rows[0].allowed, false, 'authenticated direct ' + privilege + ' must be revoked');
      const service = await db.query(
        'select has_table_privilege(\'service_role\',\'public.exchange_rates\',$1) as allowed',
        [privilege]
      );
      assert.equal(service.rows[0].allowed, true, 'service_role retains ' + privilege);
    }

    const rates = await db.query('select from_currency,to_currency,rate from public.exchange_rates');
    assert.equal(rates.rows.length, 1, 'existing public rate data is preserved');
    assert.equal(rates.rows[0].rate, '24.3');
  } finally {
    await db.close();
  }
});
