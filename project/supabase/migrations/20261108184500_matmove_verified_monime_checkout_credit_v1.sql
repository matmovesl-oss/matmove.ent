-- A verified Monime checkout may credit only the exact wallet/account
-- selected by the authenticated customer when MatMove created the session.
-- The event row is locked so duplicate deliveries cannot post twice.
create or replace function public.matmove_credit_monime_checkout(
  p_event_id uuid,
  p_wallet_id uuid,
  p_user_id uuid,
  p_financial_account_id text,
  p_checkout_session_id text,
  p_amount_minor bigint,
  p_verified_checkout jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.provider_webhook_events%rowtype;
  v_wallet public.wallets%rowtype;
  v_reference text;
  v_amount numeric;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: trusted server required';
  end if;

  if p_event_id is null or p_wallet_id is null or p_user_id is null
     or p_amount_minor is null or p_amount_minor <= 0
     or p_amount_minor > 1000000000000 then
    raise exception 'INVALID: checkout credit parameters are invalid';
  end if;

  if p_verified_checkout is null
     or p_verified_checkout->>'status' <> 'completed'
     or p_verified_checkout->>'id' <> p_checkout_session_id
     or p_verified_checkout->>'financialAccountId' <> p_financial_account_id
     or (p_verified_checkout->>'amountMinor')::bigint <> p_amount_minor
     or p_verified_checkout->>'currency' <> 'SLE'
     or p_verified_checkout->>'userId' <> p_user_id::text then
    raise exception 'INVALID: verified checkout receipt does not match';
  end if;

  select * into v_event
  from public.provider_webhook_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: webhook event not found';
  end if;

  if v_event.provider <> 'monime_customer'
     or v_event.event_type <> 'checkout_session.completed'
     or v_event.signature_verified is not true
     or v_event.payload->'data'->>'id' <> p_checkout_session_id then
    raise exception 'FORBIDDEN: webhook event is not eligible for wallet credit';
  end if;

  v_reference := 'MONIME-WEBHOOK:' || v_event.event_id;

  if v_event.processing_status = 'processed' then
    return jsonb_build_object('success',true,'duplicate',true,'event_id',v_event.id);
  end if;

  if v_event.processing_status not in ('received','failed','processing') then
    raise exception 'CONFLICT: webhook event cannot be credited from its current state';
  end if;

  select * into v_wallet
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found or v_wallet.user_id <> p_user_id or v_wallet.currency <> 'SLE' then
    raise exception 'FORBIDDEN: wallet ownership or currency mismatch';
  end if;

  if v_wallet.is_frozen is true then
    raise exception 'CONFLICT: wallet is frozen; manual review is required';
  end if;

  if coalesce(v_wallet.monime_account_id, v_wallet.metadata->>'monime_account_id') <> p_financial_account_id
     or (v_wallet.monime_account_id is not null
         and v_wallet.metadata->>'monime_account_id' is not null
         and v_wallet.monime_account_id <> v_wallet.metadata->>'monime_account_id') then
    raise exception 'FORBIDDEN: provider account does not belong to this wallet';
  end if;

  if exists (
    select 1 from public.wallet_transactions
    where reference_code = v_reference
  ) then
    update public.provider_webhook_events
    set processing_status='processed',
        processed_at=coalesce(processed_at,now()),
        processing_error=null,
        payload=payload || jsonb_build_object('matmoveVerifiedCheckout',p_verified_checkout),
        updated_at=now()
    where id=p_event_id;

    return jsonb_build_object('success',true,'duplicate',true,'event_id',v_event.id);
  end if;

  v_amount := p_amount_minor::numeric / 100;

  update public.wallets
  set balance=balance+v_amount,
      updated_at=now()
  where id=v_wallet.id;

  insert into public.wallet_transactions(
    wallet_id,amount,transaction_type,status,description,created_at,
    reference_code,metadata,currency
  ) values (
    v_wallet.id,v_amount,'credit','completed',
    'MatMove wallet top-up (verified Monime checkout)',now(),
    v_reference,
    jsonb_build_object(
      'provider','monime',
      'provider_event_id',v_event.event_id,
      'checkout_session_id',p_checkout_session_id,
      'financial_account_id',p_financial_account_id
    ),
    'SLE'
  );

  update public.provider_webhook_events
  set processing_status='processed',
      processed_at=now(),
      processing_attempts=processing_attempts+1,
      processing_error=null,
      payload=payload || jsonb_build_object('matmoveVerifiedCheckout',p_verified_checkout),
      updated_at=now()
  where id=p_event_id;

  return jsonb_build_object(
    'success',true,'duplicate',false,'event_id',v_event.id,
    'wallet_id',v_wallet.id,'amount',v_amount,'currency','SLE'
  );
end;
$$;

revoke all on function public.matmove_credit_monime_checkout(uuid,uuid,uuid,text,text,bigint,jsonb)
from public, anon, authenticated;
grant execute on function public.matmove_credit_monime_checkout(uuid,uuid,uuid,text,text,bigint,jsonb)
to service_role;
