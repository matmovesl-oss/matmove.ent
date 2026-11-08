import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20261108193100_matmove_conversion_withdrawal_idempotency_isolation_v1.sql',import.meta.url);
const userA='00000000-0000-4000-8000-000000000011';
const userB='00000000-0000-4000-8000-000000000012';
const recipient='00000000-0000-4000-8000-000000000013';

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
      provider text,
      customer_phone text,
      amount numeric not null,
      currency text not null,
      metadata jsonb not null default '{}'::jsonb,
      status text not null,
      idempotency_key text not null
    );
    create unique index payment_transactions_idempotency_key_idx
      on public.payment_transactions(idempotency_key);

    create table public.withdrawal_requests(
      id uuid primary key,
      user_id uuid not null,
      amount numeric not null,
      provider text not null,
      reference_code text not null,
      status text not null,
      payment_transaction_id uuid not null,
      currency text not null,
      idempotency_key text not null
    );

    create function public.convert_wallet_currency(
      p_from_currency text,
      p_to_currency text,
      p_amount numeric,
      p_idempotency_key text default null,
      p_description text default 'MatMove Currency Conversion'
    ) returns jsonb
    language plpgsql
    security definer
    set search_path to 'pg_catalog','public'
    as $function$
    declare
      v_user_id uuid := auth.uid();
      v_from_currency text := upper(trim(p_from_currency));
      v_to_currency text := upper(trim(p_to_currency));
      v_effective_idempotency_key text;
      v_existing_payment jsonb;
    begin
      v_effective_idempotency_key:=coalesce(nullif(trim(p_idempotency_key),''),'FX-'||gen_random_uuid()::text);
      perform pg_advisory_xact_lock(hashtextextended(v_effective_idempotency_key,0));

      SELECT jsonb_build_object(
        'success', true,
        'duplicate', true,
        'payment_transaction_id', pt.id,
        'status', pt.status,
        'amount', pt.amount,
        'currency', pt.currency,
        'idempotency_key', pt.idempotency_key,
        'message',
          'Currency conversion already processed'
      )
      INTO v_existing_payment
      FROM public.payment_transactions pt
      WHERE pt.idempotency_key =
        v_effective_idempotency_key
      LIMIT 1;

      IF v_existing_payment IS NOT NULL THEN
        RETURN v_existing_payment;
      END IF;
      return jsonb_build_object('success',true,'duplicate',false);
    end;
    $function$;

    create function public.initiate_wallet_withdrawal(
      p_amount numeric,
      p_currency text,
      p_provider text default 'mobile_money',
      p_customer_phone text default null,
      p_idempotency_key text default null
    ) returns jsonb
    language plpgsql
    security definer
    set search_path to 'pg_catalog','public'
    as $function$
    declare
      v_user_id uuid := auth.uid();
      v_currency text := upper(trim(p_currency));
      v_provider text := lower(trim(coalesce(p_provider,'mobile_money')));
      v_phone text := nullif(trim(p_customer_phone),'');
      v_effective_idempotency_key text;
      v_existing_payment jsonb;
    begin
      v_effective_idempotency_key:=coalesce(nullif(trim(p_idempotency_key),''),'WD-'||gen_random_uuid()::text);
      perform pg_advisory_xact_lock(hashtextextended(v_effective_idempotency_key,0));

      SELECT jsonb_build_object(
        'success', true,
        'duplicate', true,
        'payment_transaction_id', pt.id,
        'withdrawal_id', wr.id,
        'status', pt.status,
        'amount', pt.amount,
        'currency', pt.currency,
        'idempotency_key', pt.idempotency_key,
        'reference_code', wr.reference_code,
        'message', 'Withdrawal request already exists'
      )
      INTO v_existing_payment
      FROM public.payment_transactions pt
      LEFT JOIN public.withdrawal_requests wr
        ON wr.payment_transaction_id = pt.id
      WHERE pt.idempotency_key = v_effective_idempotency_key
      LIMIT 1;

      IF v_existing_payment IS NOT NULL THEN
        RETURN v_existing_payment;
      END IF;
      return jsonb_build_object('success',true,'duplicate',false);
    end;
    $function$;
  `);

  const migration=await readFile(migrationPath,'utf8');
  await db.exec(migration);
  return db;
}

test('currency conversion idempotency cannot disclose another user transaction',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'currency_conversion',100,'SLE',$3,'completed','shared-fx-key')`,
      ['10000000-0000-4000-8000-000000000011',userA,{
        conversion_type:'wallet_currency_conversion',
        from_currency:'SLE',
        to_currency:'USD'
      }]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userB]);
    await assert.rejects(
      db.query('select public.convert_wallet_currency($1,$2,$3,$4)', ['SLE','USD',100,'shared-fx-key']),
      /CONFLICT: This conversion key has already been used for another transaction/
    );
  }finally{await db.close();}
});

test('same-user identical currency conversion retry returns its own receipt',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'currency_conversion',100,'SLE',$3,'completed','same-fx-key')`,
      ['10000000-0000-4000-8000-000000000012',userA,{
        conversion_type:'wallet_currency_conversion',
        from_currency:'SLE',
        to_currency:'USD'
      }]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userA]);
    const result=await db.query(
      'select public.convert_wallet_currency($1,$2,$3,$4) as receipt',
      ['SLE','USD',100,'same-fx-key']
    );
    assert.equal(result.rows[0].receipt.duplicate,true);
  }finally{await db.close();}
});

test('currency conversion rejects changed amount or target currency for a reused key',async()=>{
  const db=await makeDb();
  try{
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'currency_conversion',100,'SLE',$3,'completed','reuse-fx-key')`,
      ['10000000-0000-4000-8000-000000000013',userA,{
        conversion_type:'wallet_currency_conversion',
        from_currency:'SLE',
        to_currency:'USD'
      }]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userA]);
    await assert.rejects(
      db.query('select public.convert_wallet_currency($1,$2,$3,$4)', ['SLE','USD',200,'reuse-fx-key']),
      /CONFLICT: This conversion key has already been used for another transaction/
    );
    await assert.rejects(
      db.query('select public.convert_wallet_currency($1,$2,$3,$4)', ['SLE','EUR',100,'reuse-fx-key']),
      /CONFLICT: This conversion key has already been used for another transaction/
    );
  }finally{await db.close();}
});

test('withdrawal idempotency cannot disclose another user payment or payout reference',async()=>{
  const db=await makeDb();
  try{
    const paymentId='10000000-0000-4000-8000-000000000021';
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,provider,customer_phone,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_withdrawal','mobile_money','+23276000000',50,'SLE',$3,'pending','shared-withdrawal-key')`,
      [paymentId,userA,{operation:'wallet_withdrawal',provider:'mobile_money',currency:'SLE',requested_amount:50}]
    );
    await db.query(
      `insert into public.withdrawal_requests
       (id,user_id,amount,provider,reference_code,status,payment_transaction_id,currency,idempotency_key)
       values ($1,$2,50,'mobile_money','WD-SECRET-REFERENCE','pending',$3,'SLE','shared-withdrawal-key')`,
      ['20000000-0000-4000-8000-000000000021',userA,paymentId]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userB]);
    await assert.rejects(
      db.query('select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',[50,'SLE','mobile_money','+23276000000','shared-withdrawal-key']),
      /CONFLICT: This withdrawal key has already been used for another transaction/
    );
  }finally{await db.close();}
});

test('same-user identical withdrawal retry returns its own reference',async()=>{
  const db=await makeDb();
  try{
    const paymentId='10000000-0000-4000-8000-000000000022';
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,provider,customer_phone,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_withdrawal','mobile_money','+23276000000',50,'SLE',$3,'pending','same-withdrawal-key')`,
      [paymentId,userA,{operation:'wallet_withdrawal',provider:'mobile_money',currency:'SLE',requested_amount:50}]
    );
    await db.query(
      `insert into public.withdrawal_requests
       (id,user_id,amount,provider,reference_code,status,payment_transaction_id,currency,idempotency_key)
       values ($1,$2,50,'mobile_money','WD-OWN-REFERENCE','pending',$3,'SLE','same-withdrawal-key')`,
      ['20000000-0000-4000-8000-000000000022',userA,paymentId]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userA]);
    const result=await db.query(
      'select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5) as receipt',
      [50,'SLE','mobile_money','+23276000000','same-withdrawal-key']
    );
    assert.equal(result.rows[0].receipt.duplicate,true);
    assert.equal(result.rows[0].receipt.reference_code,'WD-OWN-REFERENCE');
  }finally{await db.close();}
});

test('withdrawal key reuse with changed amount, phone or provider is rejected',async()=>{
  const db=await makeDb();
  try{
    const paymentId='10000000-0000-4000-8000-000000000023';
    await db.query(
      `insert into public.payment_transactions
       (id,user_id,transaction_type,provider,customer_phone,amount,currency,metadata,status,idempotency_key)
       values ($1,$2,'wallet_withdrawal','mobile_money','+23276000000',50,'SLE',$3,'pending','reuse-withdrawal-key')`,
      [paymentId,userA,{operation:'wallet_withdrawal',provider:'mobile_money',currency:'SLE',requested_amount:50}]
    );
    await db.query(
      `insert into public.withdrawal_requests
       (id,user_id,amount,provider,reference_code,status,payment_transaction_id,currency,idempotency_key)
       values ($1,$2,50,'mobile_money','WD-OWN-REFERENCE','pending',$3,'SLE','reuse-withdrawal-key')`,
      ['20000000-0000-4000-8000-000000000023',userA,paymentId]
    );
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[userA]);
    await assert.rejects(
      db.query('select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',[100,'SLE','mobile_money','+23276000000','reuse-withdrawal-key']),
      /CONFLICT: This withdrawal key has already been used for another transaction/
    );
    await assert.rejects(
      db.query('select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',[50,'SLE','mobile_money','+23276000001','reuse-withdrawal-key']),
      /CONFLICT: This withdrawal key has already been used for another transaction/
    );
    await assert.rejects(
      db.query('select public.initiate_wallet_withdrawal($1,$2,$3,$4,$5)',[50,'SLE','other_provider','+23276000000','reuse-withdrawal-key']),
      /CONFLICT: This withdrawal key has already been used for another transaction/
    );
  }finally{await db.close();}
});
