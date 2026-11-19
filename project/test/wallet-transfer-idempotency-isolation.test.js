import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20261108193000_matmove_wallet_transfer_idempotency_isolation_v1.sql',import.meta.url);
const senderA='00000000-0000-4000-8000-000000000001';
const senderB='00000000-0000-4000-8000-000000000002';
const recipient='00000000-0000-4000-8000-000000000003';

async function makeDb(){
  const db=new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

    create table public.payment_transactions(
      id uuid primary key,
      user_id uuid,
      transaction_type text not null,
      amount numeric not null,
      currency text not null,
      metadata jsonb not null default '{}'::jsonb,
      status text not null,
      idempotency_key text not null
    );
    create unique index payment_transactions_idempotency_key_idx
      on public.payment_transactions(idempotency_key);

    create function public.transfer_wallet_funds(
      p_recipient_profile_id uuid,
      p_amount numeric,
      p_currency text,
      p_description text default 'MatMove Wallet Transfer',
      p_idempotency_key text default null
    )
    returns jsonb
    language plpgsql
    security definer
    as $function$
    declare
      v_sender_id uuid := auth.uid();
      v_existing_payment jsonb;
    begin
      if v_sender_id is null then
        raise exception 'Unauthorized';
      end if;

      IF p_idempotency_key IS NOT NULL THEN

        SELECT jsonb_build_object(
          'success', true,
          'duplicate', true,
          'payment_transaction_id', pt.id,
          'status', pt.status,
          'amount', pt.amount,
          'currency', pt.currency,
          'message', 'Transfer already processed'
        )
        INTO v_existing_payment
        FROM public.payment_transactions pt
        WHERE pt.idempotency_key = p_idempotency_key
        LIMIT 1;

        IF v_existing_payment IS NOT NULL THEN
          RETURN v_existing_payment;
        END IF;

      END IF;

      return jsonb_build_object('success',true,'duplicate',false);
    end;
    $function$;
  `);
  const migration=await readFile(migrationPath,'utf8');
  await db.exec(migration);
  return db;
}

test('cross-customer idempotency key cannot disclose another sender payment',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_transfer',10,'SLE',$3,'completed','known-key')`,
      ['10000000-0000-4000-8000-000000000001',senderA,{recipient_profile_id:recipient}]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[senderB]);
    await assert.rejects(
      db.query('select public.transfer_wallet_funds($1,$2,$3,$4,$5)',[recipient,10,'SLE','retry','known-key']),
      /CONFLICT: This request key has already been used for another transaction/
    );
  }finally{await db.close();}
});

test('same customer can safely retry the identical transfer and receive only their own receipt',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_transfer',10,'SLE',$3,'completed','known-key')`,
      ['10000000-0000-4000-8000-000000000001',senderA,{recipient_profile_id:recipient}]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[senderA]);
    const result=await db.query(
      'select public.transfer_wallet_funds($1,$2,$3,$4,$5) as receipt',
      [recipient,10,'SLE','retry','known-key']
    );
    assert.equal(result.rows[0].receipt.duplicate,true);
    assert.equal(result.rows[0].receipt.amount,10);
  }finally{await db.close();}
});

test('same customer cannot reuse a transfer key with a different amount or recipient',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_transfer',10,'SLE',$3,'completed','known-key')`,
      ['10000000-0000-4000-8000-000000000001',senderA,{recipient_profile_id:recipient}]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[senderA]);
    await assert.rejects(
      db.query('select public.transfer_wallet_funds($1,$2,$3,$4,$5)',[recipient,20,'SLE','changed','known-key']),
      /CONFLICT: This request key has already been used for another transaction/
    );
    await assert.rejects(
      db.query('select public.transfer_wallet_funds($1,$2,$3,$4,$5)',['00000000-0000-4000-8000-000000000004',10,'SLE','changed','known-key']),
      /CONFLICT: This request key has already been used for another transaction/
    );
  }finally{await db.close();}
});
