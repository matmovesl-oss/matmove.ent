import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Monime webhook worker migration creates a safe, atomic queue claim function',async()=>{
  const migration=await readFile(
    new URL('../supabase/migrations/20261108190000_matmove_monime_webhook_queue_worker_v1.sql',import.meta.url),
    'utf8'
  );
  const db=new PGlite();

  try{
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.jwt() returns jsonb
      language sql stable
      as $$
        select coalesce(
          nullif(current_setting('request.jwt.claims',true),''),
          '{"role":"service_role"}'
        )::jsonb
      $$;

      create table public.provider_webhook_events(
        id uuid primary key,
        provider text not null,
        event_id text not null,
        event_type text not null,
        signature_verified boolean not null default false,
        payload jsonb not null default '{}'::jsonb,
        processing_status text not null default 'received',
        processing_attempts integer not null default 0,
        processing_error text,
        received_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    await db.exec(migration);

    await db.exec(`
      insert into public.provider_webhook_events(
        id,provider,event_id,event_type,signature_verified,payload
      ) values
        ('00000000-0000-4000-8000-000000000001','monime_customer','wke-1','checkout_session.completed',true,'{"data":{"id":"chk-1"}}'),
        ('00000000-0000-4000-8000-000000000002','monime_customer','wke-2','checkout_session.completed',true,'{"data":{"id":"chk-2"}}'),
        ('00000000-0000-4000-8000-000000000003','monime_customer','wke-3','checkout_session.completed',true,'{"data":{"id":"chk-3"}}'),
        ('00000000-0000-4000-8000-000000000004','monime_customer','wke-4','checkout_session.completed',true,'{"data":{"id":"chk-4"}}'),
        ('00000000-0000-4000-8000-000000000005','monime_customer','wke-5','checkout_session.completed',false,'{"data":{"id":"chk-5"}}'),
        ('00000000-0000-4000-8000-000000000006','monime_customer','wke-6','checkout_session.completed',true,'{"data":{"id":"chk-6"}}');
      update public.provider_webhook_events
      set processing_status='failed',processing_attempts=8
      where event_id='wke-6';
    `);

    const first=await db.query(
      'select * from public.matmove_claim_monime_customer_webhooks($1)',
      [2]
    );
    assert.equal(first.rows.length,2);
    assert.deepEqual(first.rows.map(row=>row.event_row_id).sort(),[
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]);
    assert.deepEqual(first.rows.map(row=>row.attempt_number),[1,1]);

    const second=await db.query(
      'select * from public.matmove_claim_monime_customer_webhooks($1)',
      [10]
    );
    assert.equal(second.rows.length,2);
    assert.ok(second.rows.every(row=>row.attempt_number===1));

    const none=await db.query(
      'select * from public.matmove_claim_monime_customer_webhooks($1)',
      [10]
    );
    assert.equal(none.rows.length,0);

    await db.exec(`
      update public.provider_webhook_events
      set updated_at=now()-interval '6 minutes'
      where event_id='wke-1';
    `);
    const reclaimed=await db.query(
      'select * from public.matmove_claim_monime_customer_webhooks($1)',
      [3]
    );
    assert.equal(reclaimed.rows.length,1);
    assert.equal(reclaimed.rows[0].provider_event_id,'wke-1');
    assert.equal(reclaimed.rows[0].attempt_number,2);
  }finally{
    await db.close();
  }
});
