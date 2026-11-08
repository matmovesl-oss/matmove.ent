-- Scope idempotency receipt lookups to the authenticated owner and the
-- exact operation payload. The existing unique payment_transactions
-- idempotency_key index remains the atomic guard: if a key exists for another
-- user or a different payload, the subsequent insert fails and the transaction
-- rolls back before any wallet debit/reservation is committed.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_updated text;
  v_conversion_pattern text :=
    'WHERE pt[.]idempotency_key =[[:space:]]*v_effective_idempotency_key';
  v_conversion_filter text :=
    'WHERE pt.idempotency_key = v_effective_idempotency_key
    AND pt.user_id = v_user_id
    AND pt.transaction_type = ''currency_conversion''
    AND pt.amount = p_amount
    AND pt.currency = v_from_currency
    AND pt.metadata->>''conversion_type'' = ''wallet_currency_conversion''
    AND pt.metadata->>''from_currency'' = v_from_currency
    AND pt.metadata->>''to_currency'' = v_to_currency';
  v_withdrawal_pattern text :=
    'WHERE pt[.]idempotency_key = v_effective_idempotency_key';
  v_withdrawal_filter text :=
    'WHERE pt.idempotency_key = v_effective_idempotency_key
    AND pt.user_id = v_user_id
    AND pt.transaction_type = ''wallet_withdrawal''
    AND pt.amount = p_amount
    AND pt.currency = v_currency
    AND pt.provider = v_provider
    AND pt.customer_phone = v_phone
    AND pt.metadata->>''operation'' = ''wallet_withdrawal''
    AND wr.user_id = v_user_id
    AND wr.idempotency_key = v_effective_idempotency_key';
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
  v_updated:=regexp_replace(v_definition,v_conversion_pattern,v_conversion_filter,'g');
  if v_updated=v_definition
     or position('pt.user_id = v_user_id' in v_updated)=0
     or position('pt.metadata->>''to_currency'' = v_to_currency' in v_updated)=0 then
    raise exception 'Currency conversion idempotency lookup could not be safely scoped.';
  end if;
  execute v_updated;

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
  v_updated:=regexp_replace(v_definition,v_withdrawal_pattern,v_withdrawal_filter,'g');
  if v_updated=v_definition
     or position('pt.user_id = v_user_id' in v_updated)=0
     or position('wr.user_id = v_user_id' in v_updated)=0
     or position('pt.customer_phone = v_phone' in v_updated)=0 then
    raise exception 'Withdrawal idempotency lookup could not be safely scoped.';
  end if;
  execute v_updated;
end;
$migration$;
