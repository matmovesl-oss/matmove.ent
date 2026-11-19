-- MatMove: allow KYC-approved riders to withdraw, with the same wallet safeguards as drivers and merchants.
-- Replaces only the customer-role guard; all existing KYC, freeze, balance, idempotency and reservation logic is preserved.

CREATE OR REPLACE FUNCTION public.initiate_wallet_withdrawal(p_amount numeric, p_currency text, p_provider text DEFAULT 'mobile_money'::text, p_customer_phone text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$

DECLARE
  v_user_id uuid := auth.uid();

  v_currency text;
  v_provider text;
  v_phone text;

  v_wallet_id uuid;
  v_balance numeric;
  v_reserved_balance numeric;
  v_available_balance numeric;

  v_payment_transaction_id uuid;
  v_withdrawal_id uuid;

  v_reference_code text;
  v_effective_idempotency_key text;

  v_existing_payment jsonb;

BEGIN

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_currency := upper(trim(p_currency));
  v_provider := lower(trim(COALESCE(p_provider, 'mobile_money')));
  v_phone := NULLIF(trim(p_customer_phone), '');

  IF v_currency NOT IN ('SLE', 'USD') THEN
    RAISE EXCEPTION 'MatMove supports SLE and USD only.';
  END IF;

  IF v_provider <> 'mobile_money' THEN
    RAISE EXCEPTION 'This withdrawal engine currently supports Mobile Money only.';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
  END IF;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Mobile Money phone number is required.';
  END IF;

  v_effective_idempotency_key :=
    COALESCE(
      NULLIF(trim(p_idempotency_key), ''),
      'WD-' || gen_random_uuid()::text
    );

  /*
    Prevent concurrent requests using the same idempotency key.
  */
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_effective_idempotency_key, 0)
  );

  /*
    If this request was already created, return the existing result
    without reserving the funds again.
  */
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
    AND pt.user_id = v_user_id
    AND pt.transaction_type = 'wallet_withdrawal'
    AND pt.amount = p_amount
    AND pt.currency = v_currency
    AND pt.provider = v_provider
    AND pt.customer_phone = v_phone
    AND pt.metadata->>'operation' = 'wallet_withdrawal'
    AND wr.user_id = v_user_id
    AND wr.idempotency_key = v_effective_idempotency_key
  LIMIT 1;

  IF v_existing_payment IS NOT NULL THEN
    RETURN v_existing_payment;
  END IF;

  /*
    Riders, drivers and merchants may withdraw after KYC approval.
    Role eligibility is intentionally consistent across all customer types.
  */
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_user_id
      AND role IN ('rider', 'driver', 'merchant')
  ) THEN
    RAISE EXCEPTION 'A MatMove customer account is required to withdraw funds.';
  END IF;

  /*
    Withdrawal requires approved KYC.
  */
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_user_id
      AND kyc_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'KYC approval is required before withdrawal.';
  END IF;

  /*
    Find the customer's wallet in the requested currency.
  */
  SELECT
    id,
    balance,
    reserved_balance
  INTO
    v_wallet_id,
    v_balance,
    v_reserved_balance
  FROM public.wallets
  WHERE user_id = v_user_id
    AND currency = v_currency
  LIMIT 1;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION '% wallet not found.', v_currency;
  END IF;

  /*
    Lock the wallet for the entire transaction so two withdrawal
    requests cannot reserve the same funds simultaneously.
  */
  PERFORM 1
  FROM public.wallets
  WHERE id = v_wallet_id
  FOR UPDATE;

  SELECT
    balance,
    reserved_balance
  INTO
    v_balance,
    v_reserved_balance
  FROM public.wallets
  WHERE id = v_wallet_id;

  IF EXISTS (
    SELECT 1
    FROM public.wallets
    WHERE id = v_wallet_id
      AND is_frozen = true
  ) THEN
    RAISE EXCEPTION 'Wallet is frozen.';
  END IF;

  v_available_balance :=
    v_balance - v_reserved_balance;

  IF v_available_balance < p_amount THEN
    RAISE EXCEPTION
      'Insufficient available % balance. Required: %, Available: %.',
      v_currency,
      p_amount,
      v_available_balance;
  END IF;

  /*
    Generate an internal MatMove withdrawal reference.
  */
  v_reference_code :=
    'WD-' ||
    upper(
      substr(
        replace(gen_random_uuid()::text, '-', ''),
        1,
        16
      )
    );

  /*
    Create the payment transaction in pending state.
    No money has been permanently debited.
  */
  INSERT INTO public.payment_transactions (
    user_id,
    wallet_id,
    transaction_type,
    provider,
    provider_reference,
    idempotency_key,
    amount,
    currency,
    status,
    customer_phone,
    metadata,
    initiated_at
  )
  VALUES (
    v_user_id,
    v_wallet_id,
    'wallet_withdrawal',
    v_provider,
    v_reference_code,
    v_effective_idempotency_key,
    p_amount,
    v_currency,
    'pending',
    v_phone,
    jsonb_build_object(
      'operation', 'wallet_withdrawal',
      'provider', v_provider,
      'currency', v_currency,
      'requested_amount', p_amount
    ),
    now()
  )
  RETURNING id
  INTO v_payment_transaction_id;

  /*
    Create the withdrawal request.
    It remains pending until an authoritative provider
    confirmation is received.
  */
  INSERT INTO public.withdrawal_requests (
    user_id,
    amount,
    provider,
    reference_code,
    status,
    payment_transaction_id,
    currency,
    idempotency_key,
    updated_at
  )
  VALUES (
    v_user_id,
    p_amount,
    v_provider,
    v_reference_code,
    'pending',
    v_payment_transaction_id,
    v_currency,
    v_effective_idempotency_key,
    now()
  )
  RETURNING id
  INTO v_withdrawal_id;

  /*
    Reserve the funds.
    The customer's spendable balance becomes:

      balance - reserved_balance
  */
  UPDATE public.wallets
  SET reserved_balance = reserved_balance + p_amount
  WHERE id = v_wallet_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'withdrawal_id', v_withdrawal_id,
    'payment_transaction_id', v_payment_transaction_id,
    'reference_code', v_reference_code,
    'status', 'pending',
    'provider', v_provider,
    'currency', v_currency,
    'amount', p_amount,
    'reserved_amount', p_amount,
    'wallet_balance', v_balance,
    'previous_reserved_balance', v_reserved_balance,
    'new_reserved_balance',
      (
        SELECT reserved_balance
        FROM public.wallets
        WHERE id = v_wallet_id
      ),
    'new_available_balance',
      (
        SELECT balance - reserved_balance
        FROM public.wallets
        WHERE id = v_wallet_id
      ),
    'idempotency_key', v_effective_idempotency_key,
    'message',
      'Withdrawal created and funds reserved pending provider confirmation.'
  );

END;
$function$

-- Apply the same approved-KYC rule to the current Monime payout engine.
CREATE OR REPLACE FUNCTION public.matmove_prepare_withdrawal(p_key text, p_user_id uuid, p_wallet_id uuid, p_source text, p_platform text, p_amount bigint, p_monime_fee bigint, p_platform_fee bigint, p_provider text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  w public.wallets%rowtype;
  v public.matmove_withdrawals%rowtype;
begin
  select *
  into w
  from public.wallets
  where id = p_wallet_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'FORBIDDEN: Wallet not found.';
  end if;

  select *
  into v
  from public.matmove_withdrawals
  where request_key = p_key;

  if found then
    if v.user_id <> p_user_id
      or v.wallet_id <> p_wallet_id
      or v.source_account <> p_source
      or v.amount_minor <> p_amount
      or v.provider <> p_provider
      or v.phone <> p_phone
    then
      raise exception
        'CONFLICT: This request key was already used for a different withdrawal.';
    end if;

    return to_jsonb(v);
  end if;

  if p_key !~ '^[a-f0-9]{64}$'
    or p_phone !~ '^\+232[0-9]{8}$'
    or p_source !~ '^fac-[A-Za-z0-9_-]+$'
    or p_platform !~ '^fac-[A-Za-z0-9_-]+$'
    or p_source = p_platform
  then
    raise exception 'INVALID: Invalid withdrawal accounts or request.';
  end if;

  if w.currency <> 'SLE'
    or coalesce(
      nullif(to_jsonb(w)->>'monime_account_id', ''),
      w.metadata->>'monime_account_id'
    ) is distinct from p_source
  then
    raise exception 'CONFLICT: Wallet link changed.';
  end if;

  if exists(
    select 1
    from public.wallets
    where user_id = p_user_id and coalesce(is_frozen, false)
  )
  or not exists(
    select 1
    from public.profiles
    where id = p_user_id
      and not coalesce(is_wallet_frozen, false)
      and role in ('rider', 'driver', 'merchant')
      and kyc_status = 'approved'
  )
  then
    raise exception
      'FORBIDDEN: Your wallet must be unfrozen and approved before withdrawing.';
  end if;

  insert into public.matmove_withdrawals(
    request_key,
    user_id,
    wallet_id,
    source_account,
    platform_account,
    amount_minor,
    monime_fee_minor,
    platform_fee_minor,
    total_minor,
    provider,
    phone,
    state
  )
  values(
    p_key,
    p_user_id,
    p_wallet_id,
    p_source,
    p_platform,
    p_amount,
    p_monime_fee,
    p_platform_fee,
    p_amount + p_monime_fee + p_platform_fee,
    p_provider,
    p_phone,
    case
      when p_platform_fee = 0 then 'fee_paid'
      else 'fee_pending'
    end
  )
  returning * into v;

  if p_platform_fee > 0 then
    insert into public.matmove_withdrawal_legs(
      withdrawal_id, kind, amount_minor
    )
    values(v.id, 'fee', p_platform_fee);
  end if;

  insert into public.matmove_withdrawal_legs(
    withdrawal_id, kind, amount_minor
  )
  values(v.id, 'payout', p_amount);

  return to_jsonb(v);
end;
$function$
