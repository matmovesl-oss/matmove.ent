-- Draft-only foundation for physical-cash ride collection.
-- This migration is intentionally NOT applied to Production by this PR.
-- It creates isolated, service-role-only records; it does not move money,
-- reserve a wallet balance, dispatch a ride, mark a booking paid, or settle cash.
begin;

create table if not exists public.matmove_cash_ride_payments (
  booking_id uuid primary key
    references public.bookings(id) on delete restrict,
  rider_id uuid not null
    references public.profiles(id) on delete restrict,
  driver_id uuid
    references public.profiles(id) on delete restrict,
  fare_minor bigint not null
    check (fare_minor between 1 and 100000000),
  driver_cash_minor bigint not null
    check (driver_cash_minor > 0),
  matmove_fee_minor bigint not null
    check (matmove_fee_minor > 0),
  currency text not null default 'SLE'
    check (currency = 'SLE'),
  status text not null default 'reserve_ready'
    check (status in (
      'reserve_ready',
      'reserve_pending',
      'fee_reserved',
      'collection_pending',
      'capture_pending',
      'settled',
      'refund_pending',
      'refunded',
      'review_required',
      'cancelled'
    )),
  driver_cash_confirmed_at timestamptz,
  driver_cash_confirmed_by uuid
    references public.profiles(id) on delete restrict,
  rider_cash_confirmed_at timestamptz,
  rider_cash_confirmed_by uuid
    references public.profiles(id) on delete restrict,
  manual_resolution_at timestamptz,
  manual_resolution_by uuid
    references public.profiles(id) on delete restrict,
  manual_resolution_note text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint matmove_cash_ride_payment_split_conserves_fare
    check (driver_cash_minor + matmove_fee_minor = fare_minor),
  constraint matmove_cash_ride_payment_85_15_split
    check (driver_cash_minor = round(fare_minor::numeric * 0.85)::bigint),
  constraint matmove_cash_ride_payment_distinct_parties
    check (driver_id is null or rider_id <> driver_id),
  constraint matmove_cash_ride_payment_driver_confirmation_pair
    check (
      (driver_cash_confirmed_at is null and driver_cash_confirmed_by is null)
      or (driver_cash_confirmed_at is not null
          and driver_cash_confirmed_by is not null
          and driver_id is not null
          and driver_cash_confirmed_by = driver_id)
    ),
  constraint matmove_cash_ride_payment_rider_confirmation_pair
    check (
      (rider_cash_confirmed_at is null and rider_cash_confirmed_by is null)
      or (rider_cash_confirmed_at is not null
          and rider_cash_confirmed_by is not null
          and rider_cash_confirmed_by = rider_id)
    ),
  constraint matmove_cash_ride_payment_manual_resolution_pair
    check (
      (manual_resolution_at is null
       and manual_resolution_by is null
       and manual_resolution_note is null)
      or (manual_resolution_at is not null
          and manual_resolution_by is not null
          and manual_resolution_note is not null
          and length(btrim(manual_resolution_note)) between 3 and 1000)
    ),
  constraint matmove_cash_ride_payment_settlement_evidence
    check (
      status <> 'settled'
      or (
        (driver_cash_confirmed_at is not null and rider_cash_confirmed_at is not null)
        or manual_resolution_at is not null
      )
    )
);

create table if not exists public.matmove_cash_ride_legs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null
    references public.matmove_cash_ride_payments(booking_id) on delete restrict,
  leg_kind text not null
    check (leg_kind in ('reserve', 'capture', 'refund')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'SLE' check (currency = 'SLE'),
  source_account_ref text not null
    check (length(btrim(source_account_ref)) between 1 and 200),
  destination_account_ref text not null
    check (length(btrim(destination_account_ref)) between 1 and 200),
  request_key text not null unique
    check (length(btrim(request_key)) between 16 and 200),
  provider_transfer_id text unique
    check (provider_transfer_id is null or length(btrim(provider_transfer_id)) between 1 and 200),
  status text not null default 'ready'
    check (status in ('ready', 'pending', 'processing', 'completed', 'failed', 'review_required')),
  attempted_at timestamptz,
  verified_amount_minor bigint,
  verified_currency text,
  verified_source_account_ref text,
  verified_destination_account_ref text,
  verified_reference text,
  verified_at timestamptz,
  error_code text
    check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint matmove_cash_ride_leg_distinct_accounts
    check (source_account_ref <> destination_account_ref),
  constraint matmove_cash_ride_leg_verified_receipt
    check (
      status <> 'completed'
      or (
        nullif(btrim(provider_transfer_id), '') is not null
        and verified_amount_minor = amount_minor
        and verified_currency = currency
        and verified_source_account_ref = source_account_ref
        and verified_destination_account_ref = destination_account_ref
        and nullif(btrim(verified_reference), '') is not null
        and verified_at is not null
      )
    ),
  constraint matmove_cash_ride_leg_verified_amount_positive
    check (verified_amount_minor is null or verified_amount_minor > 0),
  constraint matmove_cash_ride_leg_verified_currency
    check (verified_currency is null or verified_currency = 'SLE')
);

create unique index if not exists matmove_cash_ride_leg_one_kind_per_booking
  on public.matmove_cash_ride_legs(booking_id, leg_kind);

create index if not exists matmove_cash_ride_payments_status_created_idx
  on public.matmove_cash_ride_payments(status, created_at desc);

create index if not exists matmove_cash_ride_legs_status_updated_idx
  on public.matmove_cash_ride_legs(status, updated_at desc);

create table if not exists public.matmove_cash_ride_audit_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null
    references public.matmove_cash_ride_payments(booking_id) on delete restrict,
  event_type text not null
    check (event_type in (
      'cash_payment_created',
      'reserve_requested',
      'reserve_verified',
      'driver_assigned',
      'driver_cash_confirmed',
      'rider_cash_confirmed',
      'capture_requested',
      'capture_verified',
      'refund_requested',
      'refund_verified',
      'manual_review_opened',
      'manual_review_resolved',
      'payment_cancelled'
    )),
  actor_type text not null
    check (actor_type in ('system', 'rider', 'driver', 'admin')),
  actor_profile_id uuid
    references public.profiles(id) on delete restrict,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists matmove_cash_ride_audit_booking_created_idx
  on public.matmove_cash_ride_audit_events(booking_id, created_at desc);

create or replace function public.matmove_cash_ride_payment_insert_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rider_id uuid;
  v_driver_id uuid;
  v_fare_amount numeric;
  v_service_type text;
begin
  select b.rider_id, b.driver_id, b.fare_amount, b.service_type
    into v_rider_id, v_driver_id, v_fare_amount, v_service_type
  from public.bookings b
  where b.id = new.booking_id
  for key share;

  if not found then
    raise exception 'CASH_BOOKING_NOT_FOUND: Cash payment must reference an existing booking.';
  end if;

  if lower(coalesce(v_service_type, '')) <> 'ride'
     or v_rider_id is distinct from new.rider_id
     or round(v_fare_amount * 100)::bigint is distinct from new.fare_minor
     or v_driver_id is distinct from new.driver_id then
    raise exception 'CASH_BOOKING_SNAPSHOT_MISMATCH: Cash payment must match the current ride booking, rider, driver and locked fare.';
  end if;

  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_payment_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_booking_driver_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'CASH_LEDGER_IMMUTABLE: Cash ride payment records cannot be deleted.';
  end if;

  if old.driver_id is null and new.driver_id is not null then
    select b.driver_id into v_booking_driver_id
    from public.bookings b
    where b.id = old.booking_id
    for key share;
    if not found or v_booking_driver_id is distinct from new.driver_id then
      raise exception 'CASH_DRIVER_ASSIGNMENT_MISMATCH: Cash ride driver must match the booking assignment.';
    end if;
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.rider_id is distinct from old.rider_id
     or new.fare_minor is distinct from old.fare_minor
     or new.driver_cash_minor is distinct from old.driver_cash_minor
     or new.matmove_fee_minor is distinct from old.matmove_fee_minor
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'CASH_LEDGER_IMMUTABLE: Booking identity and quoted fare fields cannot be changed.';
  end if;

  if old.driver_id is not null and new.driver_id is distinct from old.driver_id then
    raise exception 'CASH_DRIVER_IMMUTABLE: An assigned cash-ride driver cannot be silently replaced.';
  end if;

  if old.driver_cash_confirmed_at is not null
     and (new.driver_cash_confirmed_at is distinct from old.driver_cash_confirmed_at
       or new.driver_cash_confirmed_by is distinct from old.driver_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Driver cash confirmation cannot be overwritten.';
  end if;

  if old.rider_cash_confirmed_at is not null
     and (new.rider_cash_confirmed_at is distinct from old.rider_cash_confirmed_at
       or new.rider_cash_confirmed_by is distinct from old.rider_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Rider cash confirmation cannot be overwritten.';
  end if;

  if old.manual_resolution_at is not null
     and (new.manual_resolution_at is distinct from old.manual_resolution_at
       or new.manual_resolution_by is distinct from old.manual_resolution_by
       or new.manual_resolution_note is distinct from old.manual_resolution_note) then
    raise exception 'CASH_RESOLUTION_IMMUTABLE: A recorded manual resolution cannot be overwritten.';
  end if;

  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_leg_insert_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_payment public.matmove_cash_ride_payments%rowtype;
  v_wallet_account text;
  v_reserve public.matmove_cash_ride_legs%rowtype;
begin
  select * into v_payment
  from public.matmove_cash_ride_payments p
  where p.booking_id = new.booking_id
  for update;

  if not found or v_payment.matmove_fee_minor <= 0
     or new.amount_minor is distinct from v_payment.matmove_fee_minor then
    raise exception 'CASH_LEG_AMOUNT_MISMATCH: Cash reserve, capture and refund legs must equal the locked MatMove fee.';
  end if;

  if new.leg_kind = 'reserve' then
    select w.monime_account_id into v_wallet_account
    from public.wallets w
    where w.user_id = v_payment.rider_id
      and w.currency = 'SLE'
    for key share;

    if not found
       or nullif(btrim(v_wallet_account), '') is null
       or new.source_account_ref is distinct from v_wallet_account then
      raise exception 'CASH_RESERVE_SOURCE_MISMATCH: Reserve source must be the rider's currently linked SLE Monime account.';
    end if;
  else
    select * into v_reserve
    from public.matmove_cash_ride_legs l
    where l.booking_id = new.booking_id
      and l.leg_kind = 'reserve'
    for key share;

    if not found or v_reserve.status <> 'completed' then
      raise exception 'CASH_RESERVE_NOT_VERIFIED: Capture or refund requires an independently verified reserve leg.';
    end if;

    if new.leg_kind = 'capture' then
      if not (
        (v_payment.driver_cash_confirmed_at is not null
         and v_payment.rider_cash_confirmed_at is not null)
        or v_payment.manual_resolution_at is not null
      ) then
        raise exception 'CASH_COLLECTION_NOT_CONFIRMED: Capture requires both cash attestations or an audited Admin resolution.';
      end if;

      if new.source_account_ref is distinct from v_reserve.destination_account_ref then
        raise exception 'CASH_CAPTURE_SOURCE_MISMATCH: Capture must debit the exact restricted account that received the reserve.';
      end if;
    elsif new.leg_kind = 'refund' then
      if new.source_account_ref is distinct from v_reserve.destination_account_ref
         or new.destination_account_ref is distinct from v_reserve.source_account_ref then
        raise exception 'CASH_REFUND_ACCOUNT_MISMATCH: Refund must reverse the original verified reserve accounts.';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_leg_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
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

  if old.verified_at is not null
     and (new.verified_amount_minor is distinct from old.verified_amount_minor
       or new.verified_currency is distinct from old.verified_currency
       or new.verified_source_account_ref is distinct from old.verified_source_account_ref
       or new.verified_destination_account_ref is distinct from old.verified_destination_account_ref
       or new.verified_reference is distinct from old.verified_reference
       or new.verified_at is distinct from old.verified_at) then
    raise exception 'CASH_RECEIPT_IMMUTABLE: A verified provider receipt cannot be overwritten.';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_audit_immutable()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  raise exception 'CASH_AUDIT_IMMUTABLE: Cash audit events are append-only.';
end;
$function$;

drop trigger if exists matmove_cash_ride_payment_insert_guard
  on public.matmove_cash_ride_payments;
create trigger matmove_cash_ride_payment_insert_guard
before insert on public.matmove_cash_ride_payments
for each row execute function public.matmove_cash_ride_payment_insert_guard();

drop trigger if exists matmove_cash_ride_leg_insert_guard
  on public.matmove_cash_ride_legs;
create trigger matmove_cash_ride_leg_insert_guard
before insert on public.matmove_cash_ride_legs
for each row execute function public.matmove_cash_ride_leg_insert_guard();

drop trigger if exists matmove_cash_ride_payment_guard
  on public.matmove_cash_ride_payments;
create trigger matmove_cash_ride_payment_guard
before update or delete on public.matmove_cash_ride_payments
for each row execute function public.matmove_cash_ride_payment_guard();

drop trigger if exists matmove_cash_ride_leg_guard
  on public.matmove_cash_ride_legs;
create trigger matmove_cash_ride_leg_guard
before update or delete on public.matmove_cash_ride_legs
for each row execute function public.matmove_cash_ride_leg_guard();

drop trigger if exists matmove_cash_ride_audit_immutable
  on public.matmove_cash_ride_audit_events;
create trigger matmove_cash_ride_audit_immutable
before update or delete on public.matmove_cash_ride_audit_events
for each row execute function public.matmove_cash_ride_audit_immutable();

alter table public.matmove_cash_ride_payments enable row level security;
alter table public.matmove_cash_ride_legs enable row level security;
alter table public.matmove_cash_ride_audit_events enable row level security;

revoke all on table public.matmove_cash_ride_payments
  from public, anon, authenticated;
revoke all on table public.matmove_cash_ride_legs
  from public, anon, authenticated;
revoke all on table public.matmove_cash_ride_audit_events
  from public, anon, authenticated;

grant select, insert, update on table public.matmove_cash_ride_payments to service_role;
grant select, insert, update on table public.matmove_cash_ride_legs to service_role;
grant select, insert on table public.matmove_cash_ride_audit_events to service_role;

revoke all on function public.matmove_cash_ride_payment_insert_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.matmove_cash_ride_leg_insert_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.matmove_cash_ride_payment_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.matmove_cash_ride_leg_guard()
  from public, anon, authenticated, service_role;
revoke all on function public.matmove_cash_ride_audit_immutable()
  from public, anon, authenticated, service_role;

comment on table public.matmove_cash_ride_payments is
  'Private cash-ride commercial snapshots and dual cash-collection attestations. This table does not itself reserve or settle money.';
comment on table public.matmove_cash_ride_legs is
  'Private idempotent Monime reserve/capture/refund leg records. Completion requires an independently verified exact provider receipt.';
comment on table public.matmove_cash_ride_audit_events is
  'Append-only audit trail for physical-cash ride payment lifecycle events; details must contain sanitized metadata only.';

comment on function public.matmove_cash_ride_payment_insert_guard() is
  'Requires the cash payment fare and party snapshot to match the existing ride booking.';
comment on function public.matmove_cash_ride_leg_insert_guard() is
  'Checks the exact cash fee, rider SLE source account, verified reserve lineage and dual collection confirmation before a leg is recorded.';
comment on function public.matmove_cash_ride_payment_guard() is
  'Protects immutable fare and party fields, one-time driver assignment, one-time attestations and manual resolution.';
comment on function public.matmove_cash_ride_leg_guard() is
  'Protects immutable cash transfer request fields, provider identity and verified receipt fields.';
comment on function public.matmove_cash_ride_audit_immutable() is
  'Prevents update and deletion of cash ride audit events.';

notify pgrst, 'reload schema';
commit;
