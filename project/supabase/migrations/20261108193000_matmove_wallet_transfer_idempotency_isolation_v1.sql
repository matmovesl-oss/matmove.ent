-- Prevent transfer_wallet_funds from returning another customer's
-- payment receipt when the caller supplies an idempotency key owned by
-- another transaction. Also reject reuse of a key for different parameters.
--
-- The existing global unique index on payment_transactions.idempotency_key
-- remains the final concurrency guard. The advisory lock serializes same-key
-- requests before lookup, and the scoped lookup returns duplicates only for
-- the same sender, transfer type, amount, currency and recipient.
do $migration$
declare
  v_function oid;
  v_definition text;
  v_old_open text := 'IF p_idempotency_key IS NOT NULL THEN';
  v_new_open text := $replacement$
IF p_idempotency_key IS NOT NULL THEN

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'wallet-transfer:' || v_sender_id::text || ':' || p_idempotency_key,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.payment_transactions x
      WHERE x.idempotency_key = p_idempotency_key
        AND (
          x.user_id IS DISTINCT FROM v_sender_id
          OR x.transaction_type IS DISTINCT FROM 'wallet_transfer'
          OR x.amount IS DISTINCT FROM p_amount
          OR x.currency IS DISTINCT FROM p_currency
          OR x.metadata->>'recipient_profile_id' IS DISTINCT FROM p_recipient_profile_id::text
        )
    ) THEN
      RAISE EXCEPTION
        'CONFLICT: This request key has already been used for another transaction.';
    END IF;
$replacement$;
  v_old_where text := 'WHERE pt.idempotency_key = p_idempotency_key';
  v_new_where text := $replacement$
WHERE pt.idempotency_key = p_idempotency_key
      AND pt.user_id = v_sender_id
      AND pt.transaction_type = 'wallet_transfer'
      AND pt.amount = p_amount
      AND pt.currency = p_currency
      AND pt.metadata->>'recipient_profile_id' = p_recipient_profile_id::text
$replacement$;
begin
  select p.oid
  into v_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'transfer_wallet_funds'
    and pg_get_function_identity_arguments(p.oid) =
      'p_recipient_profile_id uuid, p_amount numeric, p_currency text, p_description text, p_idempotency_key text';

  if v_function is null then
    raise exception 'Expected transfer_wallet_funds signature was not found.';
  end if;

  v_definition := replace(pg_get_functiondef(v_function), E'\r\n', E'\n');

  if length(v_definition) - length(replace(v_definition, v_old_open, '')) <> length(v_old_open) then
    raise exception 'Expected exactly one transfer idempotency block opener.';
  end if;

  if length(v_definition) - length(replace(v_definition, v_old_where, '')) <> length(v_old_where) then
    raise exception 'Expected exactly one transfer idempotency lookup.';
  end if;

  v_definition := replace(v_definition, v_old_open, v_new_open);
  v_definition := replace(v_definition, v_old_where, v_new_where);

  if position('x.user_id IS DISTINCT FROM v_sender_id' in v_definition) = 0
     or position('pt.user_id = v_sender_id' in v_definition) = 0
     or position('pt.metadata->>''recipient_profile_id'' = p_recipient_profile_id::text' in v_definition) = 0 then
    raise exception 'Wallet transfer idempotency isolation patch did not apply.';
  end if;

  execute v_definition;
end;
$migration$;
