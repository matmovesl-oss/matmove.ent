import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Supabase Cron schedules the worker but makes no HTTP request until Vault secrets exist',async()=>{
  const migration=await readFile(
    new URL('../supabase/migrations/20261108191500_matmove_monime_webhook_cron_v1.sql',import.meta.url),
    'utf8'
  );
  const db=new PGlite();
  try{
    await db.exec(`
      create schema cron;
      create schema vault;
      create schema net;
      create table vault.decrypted_secrets(name text primary key,decrypted_secret text not null);
      create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text);
      create table net.requests(
        id bigserial primary key,
        url text,
        headers jsonb,
        body jsonb,
        timeout_milliseconds integer
      );
      create function cron.schedule(job_name text, schedule text, command text)
      returns bigint language plpgsql as $$
      declare v_id bigint;
      begin
        insert into cron.job(jobname,schedule,command)
        values(job_name,schedule,command)
        on conflict(jobname) do update
          set schedule=excluded.schedule,command=excluded.command
        returning jobid into v_id;
        return v_id;
      end $$;
      create function net.http_post(
        url text,
        headers jsonb,
        body jsonb,
        timeout_milliseconds integer
      ) returns bigint language plpgsql as $$
      declare v_id bigint;
      begin
        insert into net.requests(url,headers,body,timeout_milliseconds)
        values(url,headers,body,timeout_milliseconds)
        returning id into v_id;
        return v_id;
      end $$;
    `);
    await db.exec(migration);

    const job=await db.query(
      "select jobname,schedule,command from cron.job where jobname='matmove-monime-webhook-worker-v1'"
    );
    assert.equal(job.rows.length,1);
    assert.equal(job.rows[0].schedule,'* * * * *');

    await db.exec(job.rows[0].command);
    let requests=await db.query('select * from net.requests');
    assert.equal(requests.rows.length,0);

    await db.exec(`
      insert into vault.decrypted_secrets(name,decrypted_secret) values
        ('matmove_vercel_base_url','https://matmoveent.vercel.app'),
        ('matmove_vercel_cron_secret','test-cron-secret-with-at-least-32-characters');
    `);
    await db.exec(job.rows[0].command);

    requests=await db.query('select * from net.requests');
    assert.equal(requests.rows.length,1);
    assert.equal(requests.rows[0].url,'https://matmoveent.vercel.app/api/create-monime-payout?action=monime_webhooks');
    assert.equal(requests.rows[0].headers.Authorization,'Bearer test-cron-secret-with-at-least-32-characters');
    assert.equal(requests.rows[0].timeout_milliseconds,8000);
  }finally{
    await db.close();
  }
});
