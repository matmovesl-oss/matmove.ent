-- Prevent currency-conversion and withdrawal RPCs from returning another
-- customer's receipt for a globally unique idempotency key. A duplicate is
-- returned only to the same authenticated user for the same request payload.
do $migration$
declare
  v_oid oid;
  v_definition text;

  v_old_conversion_select text := $old$
SELECT jsonb_build_object(
    'success', true,
    'duplicate', true,
    'payment_transaction_id', pt.id,
$old$;
  v_new_conversion_select text := $new$
IF EXISTS (
    SELECT 1
    FROM public.payment_transactions x
    WHERE x.idempotency_key = v_effective_idempotency_key
      AND (
        x.user_id IS DISTINCT FROM v_user_id
        OR x.transaction_type IS DISTINCT FROM 'currency_conversion'
        OR x.amount IS DISTINCT FROM p_amount
        OR x.currency IS DISTINCT FROM v_from_currency
        OR x.metadata->>'conversion_type' IS DISTINCT FROM 'wallet_currency_conversion'
        OR x.metadata->>'from_currency' IS DISTINCT FROM v_from_currency
        OR x.metadata->>'to_currency' IS DISTINCT FROM v_to_currency
      )
  ) THEN
    RAISE EXCEPTION
      'CONFLICT: This conversion key has already been used for another transaction.';
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'duplicate', true,
    'payment_transaction_id', pt.id,
$new$;
  v_old_conversion_where text := $old$
WHERE pt.idempotency_key =
    v_effective_idempotency_key
$old$;
  v_new_conversion_where text := $new$
WHERE pt.idempotency_key = v_effective_idempotency_key
    AND pt.user_id = v_user_id
    AND pt.transaction_type = 'currency_conversion'
    AND pt.amount = p_amount
    AND pt.currency = v_from_currency
    AND pt.metadata->>'conversion_type' = 'wallet_currency_conversion'
    AND pt.metadata->>'from_currency' = v_from_currency
    AND pt.metadata->>'to_currency' = v_to_currency
$new$;

  v_old_withdrawal_select text := $old$
SELECT jsonb_build_object(
    'success', true,
    'duplicate', true,
    'payment_transaction_id', pt.id,
    'withdrawal_id', wr.id,
$old$;
  v_new_withdrawal_select text := $new$
IF EXISTS (
    SELECT 1
    FROM public.payment_transactions x
    WHERE x.idempotency_key = v_effective_idempotency_key
      AND (
        x.user_id IS DISTINCT FROM v_user_id
        OR x.transaction_type IS DISTINCT FROM 'wallet_withdrawal'
        OR x.amount IS DISTINCT FROM p_amount
        OR x.currency IS DISTINCT FROM v_currency
        OR x.provider IS DISTINCT FROM v_provider
        OR x.customer_phone IS DISTINCT FROM v_phone
        OR x.metadata->>'operation' IS DISTINCT FROM 'wallet_withdrawal'
        OR NOT EXISTS (
          SELECT 1
          FROM public.withdrawal_requests wr_check
          WHERE wr_check.payment_transaction_id = x.id
            AND wr_check.user_id = v_user_id
            AND wr_check.amount = p_amount
            AND wr_check.provider = v_provider
            AND wr_check.currency = v_currency
            AND wr_check.idempotency_key = v_effective_idempotency_key
        )
      )
  ) THEN
    RAISE EXCEPTION
      'CONFLICT: This withdrawal key has already been used for another transaction.';
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'duplicate', true,
    'payment_transaction_id', pt.id,
    'withdrawal_id', wr.id,
$new$;
  v_old_withdrawal_where text := $old$
WHERE pt.idempotency_key = v_effective_idempotency_key
$old$;
  v_new_withdrawal_where text := $new$
WHERE pt.idempotency_key = v_effective_idempotency_key
    AND pt.user_id = v_user_id
    AND pt.transaction_type = 'wallet_withdrawal'
    AND pt.amount = p_amount
    AND pt.currency = v_currency
    AND pt.provider = v_provider
    AND pt.customer_phone = v_phone
    AND pt.metadata->>'operation' = 'wallet_withdrawal'
    AND wr.user_id = v_user_id
    AND wr.idempotency_key = v_effective_idempotency_key
$new$;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='convert_wallet_currency'
    and pg_get_function_identity_arguments(p.oid)=
      'p_from_currency text, p_to_currency text, p_amount numeric, p_idempotency_key text, p_description text';
  if v_oid is null then
    raise exception 'Expected convert_wallet_currency signature was not found.';
  end if;

  v_definition:=replace(pg_get_functiondef(v_oid),E'\r\n',E'\n');
  if position(v_old_conversion_select in v_definition)=0
     or position(v_old_conversion_where in v_definition)=0 then
    raise exception 'Currency conversion idempotency anchors did not match the live function.';
  end if;
  v_definition:=replace(v_definition,v_old_conversion_select,v_new_conversion_select);
  v_definition:=replace(v_definition,v_old_conversion_where,v_new_conversion_where);
  if position('x.user_id IS DISTINCT FROM v_user_id' in v_definition)=0
     or position('pt.user_id = v_user_id' in v_definition)=0 then
    raise exception 'Currency conversion isolation patch did not apply.';
  end if;
  execute v_definition;

  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='initiate_wallet_withdrawal'
    and pg_get_function_identity_arguments(p.oid)=
      'p_amount numeric, p_currency text, p_provider text, p_customer_phone text, p_idempotency_key text';
  if v_oid is null then
    raise exception 'Expected initiate_wallet_withdrawal signature was not found.';
  end if;

  v_definition:=replace(pg_get_functiondef(v_oid),E'\r\n',E'\n');
  if position(v_old_withdrawal_select in v_definition)=0
     or position(v_old_withdrawal_where in v_definition)=0 then
    raise exception 'Withdrawal idempotency anchors did not match the live function.';
  end if;
  v_definition:=replace(v_definition,v_old_withdrawal_select,v_new_withdrawal_select);
  v_definition:=replace(v_definition,v_old_withdrawal_where,v_new_withdrawal_where);
  if position('x.user_id IS DISTINCT FROM v_user_id' in v_definition)=0
     or position('pt.user_id = v_user_id' in v_definition)=0
     or position('wr.user_id = v_user_id' in v_definition)=0 then
    raise exception 'Withdrawal isolation patch did not apply.';
  end if;
  execute v_definition;
end;
$migration$;
