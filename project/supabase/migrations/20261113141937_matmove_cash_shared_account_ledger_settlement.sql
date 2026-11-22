-- Shared-account cash-ride settlement.
-- The rider fee reserve still transfers to the configured Monime account.
-- When the escrow role and platform-fee role share that same provider account,
-- the post-ride capture is an audited internal-ledger release, never a
-- Monime transfer from an account to itself.
begin;

alter table public.matmove_cash_ride_settings
  drop constraint if exists matmove_cash_ride_settings_accounts_distinct;
alter table public.matmove_cash_ride_settings
  drop constraint if exists matmove_cash_ride_settings_enabled_requires_accounts;
alter table public.matmove_cash_ride_settings
  add constraint matmove_cash_ride_settings_enabled_requires_accounts
  check (
    not enabled
    or (
      fee_hold_account_id is not null
      and fee_revenue_account_id is not null
    )
  );

-- fee_hold_account_id remains explicitly configured from
-- MONIME_ESCROW_ACCOUNT_ID by deployment operations. Do not silently
-- substitute the platform-fee account when the holding account is absent.

alter table public.matmove_cash_ride_legs
  add column if not exists settlement_mode text not null default 'provider_transfer';

alter table public.matmove_cash_ride_legs
  drop constraint if exists matmove_cash_ride_legs_settlement_mode_check;
alter table public.matmove_cash_ride_legs
  add constraint matmove_cash_ride_legs_settlement_mode_check
  check (settlement_mode in ('provider_transfer','internal_ledger'));

create or replace function public.matmove_cash_ride_leg_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'CASH_LEG_IMMUTABLE: Cash transfer legs cannot be deleted.';
  end if;

  if new.id is distinct from old.id
     or new.booking_id is distinct from old.booking_id
     or new.leg_kind is distinct from old.leg_kind
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.source_account_ref is distinct from old.source_account_ref
     or new.destination_account_ref is distinct from old.destination_account_ref
     or new.request_key is distinct from old.request_key
     or new.created_at is distinct from old.created_at then
    raise exception 'CASH_LEG_IMMUTABLE: Transfer identity, amount, accounts and idempotency key cannot be changed.';
  end if;

  if old.provider_transfer_id is not null
     and new.provider_transfer_id is distinct from old.provider_transfer_id then
    raise exception 'CASH_PROVIDER_ID_IMMUTABLE: A provider transfer ID cannot be replaced.';
  end if;

  if old.settlement_mode is distinct from new.settlement_mode
     and not (
       old.settlement_mode = 'provider_transfer'
       and new.settlement_mode = 'internal_ledger'
       and new.leg_kind = 'capture'
       and new.source_account_ref = new.destination_account_ref
       and new.provider_transfer_id is null
     ) then
    raise exception 'CASH_SETTLEMENT_MODE_IMMUTABLE: Only a same-account capture can be reclassified as an internal ledger release.';
  end if;

  if new.settlement_mode = 'internal_ledger'
     and (
       new.leg_kind <> 'capture'
       or new.source_account_ref <> new.destination_account_ref
       or new.provider_transfer_id is not null
     ) then
    raise exception 'CASH_INTERNAL_SETTLEMENT_INVALID: Internal-ledger settlement is only valid for a same-account capture.';
  end if;

  if old.verified_at is not null
     and (new.verified_amount_minor is distinct from old.verified_amount_minor
       or new.verified_currency is distinct from old.verified_currency
       or new.verified_source_account_ref is distinct from old.verified_source_account_ref
       or new.verified_destination_account_ref is distinct from old.verified_destination_account_ref
       or new.verified_reference is distinct from old.verified_reference
       or new.verified_at is distinct from old.verified_at) then
    raise exception 'CASH_RECEIPT_IMMUTABLE: A verified provider receipt or ledger release cannot be overwritten.';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_settle_shared_capture(
  p_booking_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  cfg public.matmove_cash_ride_settings%rowtype;
  reserve_leg public.matmove_cash_ride_legs%rowtype;
  capture_leg public.matmove_cash_ride_legs%rowtype;
begin
  if p_booking_id is null then
    raise exception 'INVALID: A cash ride booking is required.';
  end if;

  select * into cfg
  from public.matmove_cash_ride_settings
  where singleton = true
  for share;

  if not found
     or not cfg.enabled
     or cfg.fee_hold_account_id is null
     or cfg.fee_revenue_account_id is null
     or cfg.fee_hold_account_id <> cfg.fee_revenue_account_id
     or p_environment is distinct from cfg.provider_environment then
    raise exception 'CASH_NOT_CONFIGURED: Shared-account cash settlement is not enabled for this Monime environment.';
  end if;

  select * into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or b.payment_method <> 'cash' or b.service_type <> 'ride' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p
  from public.matmove_cash_ride_payments
  where booking_id = p_booking_id
  for update;

  if not found then
    raise exception 'CASH_LEDGER_MISSING: Cash payment record not found.';
  end if;

  select * into reserve_leg
  from public.matmove_cash_ride_legs
  where booking_id = p_booking_id and leg_kind = 'reserve'
  for update;

  if not found
     or reserve_leg.status <> 'completed'
     or reserve_leg.destination_account_ref <> cfg.fee_hold_account_id
     or reserve_leg.amount_minor <> p.matmove_fee_minor
     or reserve_leg.currency <> 'SLE' then
    raise exception 'CASH_RESERVE_NOT_VERIFIED: The exact cash fee must already be verified in the configured account.';
  end if;

  select * into capture_leg
  from public.matmove_cash_ride_legs
  where booking_id = p_booking_id and leg_kind = 'capture'
  for update;

  if not found
     or capture_leg.amount_minor <> p.matmove_fee_minor
     or capture_leg.currency <> 'SLE'
     or capture_leg.source_account_ref <> cfg.fee_hold_account_id
     or capture_leg.destination_account_ref <> cfg.fee_revenue_account_id
     or capture_leg.source_account_ref <> capture_leg.destination_account_ref then
    raise exception 'CASH_CAPTURE_ACCOUNT_MISMATCH: Shared-account capture must match the verified fee reserve and configured fee account.';
  end if;

  if p.status = 'settled'
     and capture_leg.status = 'completed'
     and capture_leg.settlement_mode = 'internal_ledger' then
    return jsonb_build_object(
      'leg', to_jsonb(capture_leg),
      'paymentStatus', p.status,
      'bookingStatus', b.status,
      'settlementMode', 'internal_ledger'
    );
  end if;

  if b.status <> 'in_progress'
     or p.status <> 'capture_pending'
     or capture_leg.status not in ('ready','processing')
     or capture_leg.provider_transfer_id is not null
     or not (
       (p.driver_cash_confirmed_at is not null
        and p.rider_cash_confirmed_at is not null)
       or (
         p.manual_resolution_at is not null
         and p.manual_resolution_by is not null
         and nullif(btrim(p.manual_resolution_note),'') is not null
       )
     ) then
    raise exception 'CASH_COLLECTION_NOT_CONFIRMED: Both cash parties must confirm, or an audited Admin resolution must exist, before release.';
  end if;

  update public.matmove_cash_ride_legs
  set status = 'completed',
      settlement_mode = 'internal_ledger',
      verified_amount_minor = amount_minor,
      verified_currency = currency,
      verified_source_account_ref = source_account_ref,
      verified_destination_account_ref = destination_account_ref,
      verified_reference = request_key,
      verified_at = clock_timestamp(),
      error_code = null,
      updated_at = clock_timestamp()
  where id = capture_leg.id
  returning * into capture_leg;

  update public.matmove_cash_ride_payments
  set status = 'settled',
      updated_at = clock_timestamp()
  where booking_id = p_booking_id
  returning * into p;

  update public.bookings
  set status = 'completed',
      updated_at = clock_timestamp()
  where id = p_booking_id
    and status = 'in_progress'
  returning * into b;

  if not found then
    raise exception 'CASH_BOOKING_STATE_CONFLICT: Booking status changed before cash settlement.';
  end if;

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,details
  ) values (
    p_booking_id,
    'capture_verified',
    'system',
    jsonb_build_object(
      'legKind','capture',
      'settlementMode','internal_ledger',
      'providerTransferId',null,
      'amountMinor',capture_leg.amount_minor,
      'currency',capture_leg.currency,
      'accountId',cfg.fee_revenue_account_id,
      'requestKey',capture_leg.request_key
    )
  );

  return jsonb_build_object(
    'leg',to_jsonb(capture_leg),
    'paymentStatus',p.status,
    'bookingStatus',b.status,
    'settlementMode','internal_ledger'
  );
end;
$function$;

revoke all on function public.matmove_cash_ride_settle_shared_capture(uuid,text)
  from public, anon, authenticated;
grant execute on function public.matmove_cash_ride_settle_shared_capture(uuid,text)
  to service_role;

comment on column public.matmove_cash_ride_legs.settlement_mode is
  'provider_transfer for real Monime transfers; internal_ledger for the audited same-account cash-fee release after both parties confirm.';

comment on function public.matmove_cash_ride_settle_shared_capture(uuid,text) is
  'Service-role-only atomic ledger release for a cash ride when escrow and fee revenue are the same physical Monime account. It never creates a Monime self-transfer.';

commit;
