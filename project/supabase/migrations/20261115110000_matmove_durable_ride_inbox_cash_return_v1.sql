-- Durable trip inbox and verified physical-cash return workflow.
-- This migration does not move money by itself. It records both parties'
-- physical return confirmations and queues the existing immutable Monime
-- fee-reserve refund leg. The booking remains active until that leg is verified.

alter table public.matmove_cash_ride_payments
  add column if not exists admin_return_request_id uuid,
  add column if not exists admin_return_requested_at timestamptz,
  add column if not exists admin_return_requested_by uuid references public.profiles(id) on delete restrict,
  add column if not exists admin_return_note text,
  add column if not exists driver_return_confirmed_at timestamptz,
  add column if not exists driver_return_confirmed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rider_return_confirmed_at timestamptz,
  add column if not exists rider_return_confirmed_by uuid references public.profiles(id) on delete restrict;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='matmove_cash_ride_admin_return_request_pair') then
    alter table public.matmove_cash_ride_payments add constraint matmove_cash_ride_admin_return_request_pair
    check (
      (admin_return_request_id is null and admin_return_requested_at is null and admin_return_requested_by is null and admin_return_note is null)
      or
      (admin_return_request_id is not null and admin_return_requested_at is not null and admin_return_requested_by is not null
        and admin_return_note is not null and length(btrim(admin_return_note)) between 3 and 300)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='matmove_cash_ride_driver_return_pair') then
    alter table public.matmove_cash_ride_payments add constraint matmove_cash_ride_driver_return_pair
    check (
      (driver_return_confirmed_at is null and driver_return_confirmed_by is null)
      or
      (driver_return_confirmed_at is not null and driver_return_confirmed_by is not null
        and driver_id is not null and driver_return_confirmed_by=driver_id)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='matmove_cash_ride_rider_return_pair') then
    alter table public.matmove_cash_ride_payments add constraint matmove_cash_ride_rider_return_pair
    check (
      (rider_return_confirmed_at is null and rider_return_confirmed_by is null)
      or
      (rider_return_confirmed_at is not null and rider_return_confirmed_by is not null
        and rider_return_confirmed_by=rider_id)
    );
  end if;
end $$;

alter table public.matmove_cash_ride_audit_events
  drop constraint if exists matmove_cash_ride_audit_events_event_type_check;
alter table public.matmove_cash_ride_audit_events
  add constraint matmove_cash_ride_audit_events_event_type_check
  check (event_type = any(array[
    'cash_payment_created','reserve_requested','reserve_verified','driver_assigned',
    'driver_cash_confirmed','rider_cash_confirmed','capture_requested','capture_verified',
    'refund_requested','refund_verified','manual_review_opened','manual_review_resolved',
    'payment_cancelled','admin_return_requested','driver_return_confirmed',
    'rider_return_confirmed','physical_cash_return_verified'
  ]::text[]));

create or replace function public.matmove_cash_ride_payment_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
declare v_booking_driver_id uuid;
begin
  if tg_op='DELETE' then
    raise exception 'CASH_LEDGER_IMMUTABLE: Cash ride payment records cannot be deleted.';
  end if;
  if old.driver_id is null and new.driver_id is not null then
    select b.driver_id into v_booking_driver_id from public.bookings b
    where b.id=old.booking_id for key share;
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
  if old.admin_return_request_id is not null
     and (new.admin_return_request_id is distinct from old.admin_return_request_id
       or new.admin_return_requested_at is distinct from old.admin_return_requested_at
       or new.admin_return_requested_by is distinct from old.admin_return_requested_by
       or new.admin_return_note is distinct from old.admin_return_note) then
    raise exception 'CASH_RETURN_REQUEST_IMMUTABLE: An Admin return request cannot be overwritten.';
  end if;
  if old.driver_return_confirmed_at is not null
     and (new.driver_return_confirmed_at is distinct from old.driver_return_confirmed_at
       or new.driver_return_confirmed_by is distinct from old.driver_return_confirmed_by) then
    raise exception 'CASH_RETURN_CONFIRMATION_IMMUTABLE: Driver return confirmation cannot be overwritten.';
  end if;
  if old.rider_return_confirmed_at is not null
     and (new.rider_return_confirmed_at is distinct from old.rider_return_confirmed_at
       or new.rider_return_confirmed_by is distinct from old.rider_return_confirmed_by) then
    raise exception 'CASH_RETURN_CONFIRMATION_IMMUTABLE: Rider return confirmation cannot be overwritten.';
  end if;
  new.updated_at:=clock_timestamp();
  new.version:=old.version+1;
  return new;
end;
$function$;

create or replace function public.matmove_admin_request_cash_return(
  p_booking_id uuid,p_expected bigint,p_request_id uuid,p_note text,p_expected_actor uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
begin
  actor:=public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then raise exception 'FORBIDDEN: Active Dispatch permission is required.'; end if;
  if p_booking_id is null or p_expected is null or p_request_id is null
     or p_note is null or length(btrim(p_note)) not between 3 and 300 then
    raise exception 'INVALID: A booking, request key and dispatch note (3–300 characters) are required.';
  end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  select * into cp from public.matmove_cash_ride_payments where booking_id=b.id for update;
  if not found or b.payment_method<>'cash' then raise exception 'CASH_LEDGER_MISSING: Cash ride payment record not found.'; end if;
  if cp.admin_return_request_id is not null then
    if cp.admin_return_request_id<>p_request_id or cp.admin_return_requested_by<>actor or cp.admin_return_note<>btrim(p_note) then
      raise exception 'CONFLICT: A different physical-return request is already recorded.';
    end if;
    return jsonb_build_object('actor',actor,'applied',true,'requestId',cp.admin_return_request_id,
      'bookingId',b.id,'action','cash_return','bookingStatus',b.status,
      'paymentStatus',cp.status,'driverReturnConfirmed',cp.driver_return_confirmed_at is not null,
      'riderReturnConfirmed',cp.rider_return_confirmed_at is not null,
      'refundStatus',case when cp.status='refunded' then 'refunded' when cp.status='refund_pending' then 'refund_pending' else 'physical_return_pending' end);
  end if;
  if b.matmove_dispatch_version is distinct from p_expected then
    raise exception 'CONFLICT: Booking changed. Refresh Dispatch before continuing.';
  end if;
  if b.status not in ('accepted','in_progress') or b.driver_id is null
     or cp.driver_id is distinct from b.driver_id then
    raise exception 'INVALID_STATE: Only a driver-assigned unfinished cash ride can enter physical-return review.';
  end if;
  if cp.status not in ('fee_reserved','collection_pending','capture_pending') then
    raise exception 'CASH_HANDOVER_NOT_READY: This cash request is not in a state that can enter physical-return review.';
  end if;
  select * into reserve from public.matmove_cash_ride_legs
    where booking_id=b.id and leg_kind='reserve' for key share;
  if not found or reserve.status<>'completed' then
    raise exception 'CASH_RESERVE_NOT_VERIFIED: The original MatMove fee reserve is not verified.';
  end if;
  update public.matmove_cash_ride_payments
    set admin_return_request_id=p_request_id,
        admin_return_requested_at=clock_timestamp(),
        admin_return_requested_by=actor,
        admin_return_note=btrim(p_note)
    where booking_id=b.id returning * into cp;
  insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id,details)
  values(b.id,'admin_return_requested','admin',actor,
    jsonb_build_object('note',btrim(p_note),'driverCashMinor',cp.driver_cash_minor,'feeMinor',cp.matmove_fee_minor));
  update public.bookings set updated_at=clock_timestamp() where id=b.id returning * into b;
  return jsonb_build_object('actor',actor,'applied',true,'requestId',p_request_id,
    'bookingId',b.id,'action','cash_return','bookingStatus',b.status,'paymentStatus',cp.status,
    'refundStatus','physical_return_pending','driverReturnConfirmed',false,'riderReturnConfirmed',false);
end;
$function$;

create or replace function public.matmove_cash_ride_confirm_return(
  p_booking_id uuid,p_actor_id uuid,p_actor_type text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
  existing_refund public.matmove_cash_ride_legs%rowtype;
begin
  if p_actor_id is null or p_actor_type not in ('rider','merchant','driver') then
    raise exception 'INVALID: A valid Rider or Driver return confirmation is required.';
  end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method<>'cash' then raise exception 'NOT_FOUND: Cash ride booking not found.'; end if;
  select * into cp from public.matmove_cash_ride_payments where booking_id=b.id for update;
  if not found or cp.admin_return_request_id is null then
    raise exception 'RETURN_NOT_REQUESTED: Dispatch has not requested a physical cash return for this ride.';
  end if;
  if b.status not in ('accepted','in_progress') or cp.status not in ('fee_reserved','collection_pending','capture_pending','refund_pending') then
    if cp.status='refunded' then
      return jsonb_build_object('returnReady',true,'paymentStatus','refunded',
        'driverReturnConfirmed',cp.driver_return_confirmed_at is not null,
        'riderReturnConfirmed',cp.rider_return_confirmed_at is not null);
    end if;
    raise exception 'INVALID_STATE: This cash return is no longer awaiting confirmation.';
  end if;
  if p_actor_type in ('rider','merchant') then
    if p_actor_id is distinct from cp.rider_id then raise exception 'FORBIDDEN: Only the booking customer can confirm returned cash.'; end if;
    if cp.rider_return_confirmed_at is null then
      update public.matmove_cash_ride_payments set rider_return_confirmed_at=clock_timestamp(),
        rider_return_confirmed_by=p_actor_id where booking_id=b.id returning * into cp;
      insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id)
      values(b.id,'rider_return_confirmed',p_actor_type,p_actor_id);
    end if;
  else
    if p_actor_id is distinct from cp.driver_id or p_actor_id is distinct from b.driver_id then
      raise exception 'FORBIDDEN: Only the assigned driver can confirm returning physical cash.';
    end if;
    if cp.driver_return_confirmed_at is null then
      update public.matmove_cash_ride_payments set driver_return_confirmed_at=clock_timestamp(),
        driver_return_confirmed_by=p_actor_id where booking_id=b.id returning * into cp;
      insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id)
      values(b.id,'driver_return_confirmed','driver',p_actor_id);
    end if;
  end if;

  if cp.driver_return_confirmed_at is not null and cp.rider_return_confirmed_at is not null then
    select * into reserve from public.matmove_cash_ride_legs
      where booking_id=b.id and leg_kind='reserve' for key share;
    if not found or reserve.status<>'completed' then
      raise exception 'CASH_RESERVE_NOT_VERIFIED: The fee reserve must be verified before returning it.';
    end if;
    select * into existing_refund from public.matmove_cash_ride_legs
      where booking_id=b.id and leg_kind='refund' for update;
    if not found then
      insert into public.matmove_cash_ride_legs(
        booking_id,leg_kind,amount_minor,currency,source_account_ref,destination_account_ref,request_key,status
      ) values(
        b.id,'refund',cp.matmove_fee_minor,'SLE',reserve.destination_account_ref,
        reserve.source_account_ref,'matmove-cash:'||b.id::text||':refund','ready'
      );
    elsif existing_refund.amount_minor<>cp.matmove_fee_minor
       or existing_refund.source_account_ref<>reserve.destination_account_ref
       or existing_refund.destination_account_ref<>reserve.source_account_ref
       or existing_refund.request_key<>'matmove-cash:'||b.id::text||':refund' then
      raise exception 'CASH_LEG_CONFLICT: Existing refund leg does not match the original reserve.';
    end if;
    if cp.status<>'refund_pending' then
      update public.matmove_cash_ride_payments set status='refund_pending' where booking_id=b.id returning * into cp;
    end if;
    insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id,details)
    values(b.id,'physical_cash_return_verified','system',null,
      jsonb_build_object('driverReturnedAt',cp.driver_return_confirmed_at,'riderReceivedAt',cp.rider_return_confirmed_at,
        'driverCashMinor',cp.driver_cash_minor,'feeRefundMinor',cp.matmove_fee_minor));
  end if;
  return jsonb_build_object('returnReady',cp.driver_return_confirmed_at is not null and cp.rider_return_confirmed_at is not null,
    'paymentStatus',cp.status,'driverReturnConfirmed',cp.driver_return_confirmed_at is not null,
    'riderReturnConfirmed',cp.rider_return_confirmed_at is not null);
end;
$function$;

-- The verified refund leg is the only point at which an Admin-requested
-- in-progress cash ride is finally cancelled.
create or replace function public.matmove_cash_ride_record_leg(
  p_booking_id uuid,p_leg_kind text,p_provider_transfer_id text,p_provider_status text,
  p_verified_amount_minor bigint default null,p_verified_currency text default null,
  p_verified_source_account text default null,p_verified_destination_account text default null,
  p_verified_reference text default null,p_error_code text default null
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  l public.matmove_cash_ride_legs%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  b public.bookings%rowtype;
  next_state text;
begin
  if p_provider_status not in ('pending','processing','completed','failed','review_required') then
    raise exception 'INVALID: Unsupported cash transfer status.';
  end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  select * into p from public.matmove_cash_ride_payments where booking_id=p_booking_id for update;
  if not found then raise exception 'CASH_LEDGER_MISSING: Cash payment record not found.'; end if;
  select * into l from public.matmove_cash_ride_legs where booking_id=p_booking_id and leg_kind=p_leg_kind for update;
  if not found then raise exception 'NOT_FOUND: Cash transfer leg not found.'; end if;
  if l.status='completed' then
    if p_provider_transfer_id is distinct from l.provider_transfer_id then raise exception 'CASH_RECEIPT_CONFLICT: A completed cash leg cannot be replaced.'; end if;
    return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',p.status,'bookingStatus',b.status);
  end if;
  if l.status in ('review_required','failed') then
    return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',p.status,'bookingStatus',b.status);
  end if;
  if l.provider_transfer_id is not null and p_provider_transfer_id is distinct from l.provider_transfer_id then
    raise exception 'CASH_PROVIDER_ID_CONFLICT: Provider transfer ID cannot be replaced.';
  end if;
  if p_provider_status='completed' and (
    nullif(btrim(p_provider_transfer_id),'') is null
    or p_verified_amount_minor is distinct from l.amount_minor
    or p_verified_currency is distinct from l.currency
    or p_verified_source_account is distinct from l.source_account_ref
    or p_verified_destination_account is distinct from l.destination_account_ref
    or p_verified_reference is distinct from l.request_key
  ) then
    raise exception 'CASH_RECEIPT_MISMATCH: Provider receipt does not match the exact stored cash leg.';
  end if;
  update public.matmove_cash_ride_legs set provider_transfer_id=coalesce(provider_transfer_id,p_provider_transfer_id),
    status=p_provider_status,
    verified_amount_minor=case when p_provider_status='completed' then p_verified_amount_minor else verified_amount_minor end,
    verified_currency=case when p_provider_status='completed' then p_verified_currency else verified_currency end,
    verified_source_account_ref=case when p_provider_status='completed' then p_verified_source_account else verified_source_account_ref end,
    verified_destination_account_ref=case when p_provider_status='completed' then p_verified_destination_account else verified_destination_account_ref end,
    verified_reference=case when p_provider_status='completed' then p_verified_reference else verified_reference end,
    verified_at=case when p_provider_status='completed' then clock_timestamp() else verified_at end,
    error_code=p_error_code,updated_at=clock_timestamp()
  where id=l.id returning * into l;
  if p_provider_status='completed' then
    if p_verified_reference is distinct from l.request_key then raise exception 'CASH_RECEIPT_REFERENCE_MISMATCH: Provider receipt request reference does not match the original idempotency reference.'; end if;
    next_state:=case p_leg_kind when 'reserve' then 'fee_reserved' when 'capture' then 'settled' when 'refund' then 'refunded' end;
    update public.matmove_cash_ride_payments set status=next_state,updated_at=clock_timestamp()
      where booking_id=p_booking_id returning * into p;
    if p_leg_kind='reserve' then
      update public.bookings set status='pending',updated_at=clock_timestamp() where id=p_booking_id and status='cash_reserve_pending';
    elsif p_leg_kind='capture' then
      update public.bookings set status='completed',updated_at=clock_timestamp() where id=p_booking_id and status='in_progress';
    elsif p_leg_kind='refund' then
      update public.bookings set status='cancelled',updated_at=clock_timestamp()
      where id=p_booking_id and (
        status in ('cash_reserve_pending','pending','accepted')
        or (status='in_progress' and p.admin_return_requested_at is not null
          and p.driver_return_confirmed_at is not null and p.rider_return_confirmed_at is not null)
      );
    end if;
    insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,details)
    values(p_booking_id,case p_leg_kind when 'reserve' then 'reserve_verified' when 'capture' then 'capture_verified' else 'refund_verified' end,
      'system',jsonb_build_object('legKind',p_leg_kind,'providerTransferId',l.provider_transfer_id,'amountMinor',l.amount_minor,'currency','SLE'));
  elsif p_provider_status in ('failed','review_required') then
    update public.matmove_cash_ride_payments set status='review_required',updated_at=clock_timestamp() where booking_id=p_booking_id;
    update public.bookings set status='cash_review_required',updated_at=clock_timestamp()
      where id=p_booking_id and status in ('cash_reserve_pending','pending','pending_admin','accepted');
    insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,details)
    values(p_booking_id,'manual_review_opened','system',jsonb_build_object('legKind',p_leg_kind,'reasonCode',coalesce(p_error_code,'provider_not_verified')));
  end if;
  return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',next_state,'bookingStatus',b.status);
end;
$function$;

create table if not exists public.matmove_ride_admin_flags (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  flag_type text not null check(flag_type in ('payment_not_confirmed')),
  status text not null default 'open' check(status in ('open','resolved')),
  note text not null check(length(btrim(note)) between 3 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  check ((status='open' and resolved_by is null and resolved_at is null and resolution_note is null)
    or (status='resolved' and resolved_by is not null and resolved_at is not null
      and resolution_note is not null and length(btrim(resolution_note)) between 3 and 300))
);
create index if not exists matmove_ride_admin_flags_booking_status_idx
  on public.matmove_ride_admin_flags(booking_id,status,created_at desc);
create unique index if not exists matmove_ride_admin_flags_one_open_unpaid
  on public.matmove_ride_admin_flags(booking_id,flag_type) where status='open';
alter table public.matmove_ride_admin_flags enable row level security;
drop policy if exists matmove_ride_admin_flags_dispatch_read on public.matmove_ride_admin_flags;
create policy matmove_ride_admin_flags_dispatch_read on public.matmove_ride_admin_flags
  for select to authenticated using (public.matmove_dispatch_actor() is not null);
revoke all on public.matmove_ride_admin_flags from anon,authenticated;
grant select on public.matmove_ride_admin_flags to authenticated;

create or replace function public.matmove_admin_flag_unpaid_booking(
  p_booking_id uuid,p_note text,p_expected_actor uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  rp public.ride_payments%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  current_flag public.matmove_ride_admin_flags%rowtype;
  is_unpaid boolean:=false;
  payment_state text:='not_recorded';
begin
  actor:=public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then raise exception 'FORBIDDEN: Active Dispatch permission is required.'; end if;
  if p_booking_id is null or p_note is null or length(btrim(p_note)) not between 3 and 300 then
    raise exception 'INVALID: A booking and flag note (3–300 characters) are required.';
  end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if b.status not in ('pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress') then
    raise exception 'INVALID_STATE: Only unfinished requests can receive a payment follow-up flag.';
  end if;
  if b.payment_method='cash' then
    select * into cp from public.matmove_cash_ride_payments where booking_id=b.id;
    payment_state:=coalesce(cp.status,'not_recorded');
    is_unpaid:=not found or cp.status not in ('settled','refunded','cancelled');
  else
    select * into rp from public.ride_payments where booking_id=b.id;
    payment_state:=coalesce(rp.state,'not_recorded');
    is_unpaid:=not found or rp.state not in ('funded','releasing','released','refunding');
  end if;
  if not is_unpaid then raise exception 'PAYMENT_CONFIRMED: A payment is already recorded as funded or settled; use payment review instead.'; end if;
  select * into current_flag from public.matmove_ride_admin_flags
    where booking_id=b.id and flag_type='payment_not_confirmed' and status='open' for update;
  if found then
    update public.matmove_ride_admin_flags set note=btrim(p_note) where id=current_flag.id returning * into current_flag;
  else
    insert into public.matmove_ride_admin_flags(booking_id,flag_type,note,created_by)
      values(b.id,'payment_not_confirmed',btrim(p_note),actor) returning * into current_flag;
  end if;
  return jsonb_build_object('actor',actor,'flagId',current_flag.id,'bookingId',b.id,
    'flagType',current_flag.flag_type,'status',current_flag.status,'paymentStatus',payment_state);
end;
$function$;

create or replace function public.matmove_admin_resolve_ride_flag(
  p_flag_id uuid,p_note text,p_expected_actor uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare actor uuid;f public.matmove_ride_admin_flags%rowtype;
begin
  actor:=public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then raise exception 'FORBIDDEN: Active Dispatch permission is required.'; end if;
  if p_flag_id is null or p_note is null or length(btrim(p_note)) not between 3 and 300 then
    raise exception 'INVALID: A flag and resolution note (3–300 characters) are required.';
  end if;
  select * into f from public.matmove_ride_admin_flags where id=p_flag_id for update;
  if not found then raise exception 'NOT_FOUND: Payment flag not found.'; end if;
  if f.status='resolved' then
    return jsonb_build_object('actor',actor,'flagId',f.id,'bookingId',f.booking_id,'status','resolved');
  end if;
  update public.matmove_ride_admin_flags set status='resolved',resolved_by=actor,
    resolved_at=clock_timestamp(),resolution_note=btrim(p_note) where id=f.id returning * into f;
  return jsonb_build_object('actor',actor,'flagId',f.id,'bookingId',f.booking_id,'status',f.status);
end;
$function$;

-- Extend the private Admin trip review with payment, cash-handover, transfer,
-- investigation and Admin-flag details. Provider account IDs are deliberately omitted.
create or replace function public.matmove_admin_trip_review(p_booking uuid)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','public'
as $function$
declare actor uuid;b public.bookings%rowtype;r public.profiles%rowtype;d public.profiles%rowtype;
driver_gps jsonb;customer_gps jsonb;active_trip boolean;
begin
  actor:=public.matmove_dispatch_actor();
  select * into b from public.bookings where id=p_booking;
  if not found then raise exception 'NOT_FOUND: Trip not found.'; end if;
  select * into r from public.profiles where id=b.rider_id;
  select * into d from public.profiles where id=b.driver_id;
  active_trip:=b.driver_id is not null and b.status::text in ('accepted','in_progress');
  if active_trip then
    select jsonb_build_object('lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,'observedAt',p.observed_at,'receivedAt',p.received_at)
      into driver_gps from public.matmove_trip_positions p
      where p.booking_id=b.id and p.driver_id=b.driver_id
      and p.received_at>clock_timestamp()-interval '45 seconds' and p.observed_at>clock_timestamp()-interval '60 seconds';
    select jsonb_build_object('lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,'observedAt',p.observed_at,'receivedAt',p.received_at)
      into customer_gps from public.matmove_customer_trip_positions p
      where p.booking_id=b.id and p.customer_id=b.rider_id
      and p.received_at>clock_timestamp()-interval '45 seconds' and p.observed_at>clock_timestamp()-interval '60 seconds';
  end if;
  return jsonb_build_object(
    'actor',actor,'bookingId',b.id,'status',b.status,'serverTime',clock_timestamp(),
    'paymentMethod',b.payment_method,'pickup',b.pickup_location,'destination',b.destination_location,'fare',b.fare_amount::text,
    'serviceType',b.service_type,'vehicleType',to_jsonb(b)->>'vehicle_type',
    'passengerCount',coalesce(to_jsonb(b)->>'passenger_count','1'),'passengerName',to_jsonb(b)->>'passenger_name',
    'createdAt',b.created_at,'scheduledAt',to_jsonb(b)->>'scheduled_time','acceptedAt',to_jsonb(b)->>'accepted_at',
    'startedAt',to_jsonb(b)->>'started_at','completedAt',to_jsonb(b)->>'completed_at',
    'rider',jsonb_build_object('id',b.rider_id,'name',coalesce(nullif(to_jsonb(r)->>'full_name',''),to_jsonb(r)->>'email'),
      'email',to_jsonb(r)->>'email','phone',coalesce(nullif(to_jsonb(r)->>'phone',''),to_jsonb(r)->>'phone_number')),
    'driver',case when b.driver_id is null then null else jsonb_build_object('id',b.driver_id,
      'name',coalesce(nullif(to_jsonb(d)->>'full_name',''),to_jsonb(d)->>'email'),
      'email',to_jsonb(d)->>'email','phone',coalesce(nullif(to_jsonb(d)->>'phone',''),to_jsonb(d)->>'phone_number'),
      'vehicleType',to_jsonb(d)->>'vehicle_type','plate',to_jsonb(d)->>'plate_number') end,
    'pickupPin',case when b.matmove_pickup_lat is null then null else jsonb_build_object('lat',b.matmove_pickup_lat,'lng',b.matmove_pickup_lng) end,
    'destinationPin',case when b.matmove_destination_lat is null then null else jsonb_build_object('lat',b.matmove_destination_lat,'lng',b.matmove_destination_lng) end,
    'driverPosition',driver_gps,'customerPosition',customer_gps,'trackingActive',active_trip,
    'digitalPayment',(select jsonb_build_object('status',rp.state,'fare',rp.fare_minor::numeric/100,
      'driverShare',rp.driver_minor::numeric/100,'platformFee',rp.fee_minor::numeric/100)
      from public.ride_payments rp where rp.booking_id=b.id),
    'cashPayment',(select jsonb_build_object('status',cp.status,'fare',cp.fare_minor::numeric/100,
      'driverCash',cp.driver_cash_minor::numeric/100,'platformFee',cp.matmove_fee_minor::numeric/100,
      'driverCashConfirmed',cp.driver_cash_confirmed_at is not null,'riderCashConfirmed',cp.rider_cash_confirmed_at is not null,
      'adminReturnRequested',cp.admin_return_requested_at is not null,
      'adminReturnNote',cp.admin_return_note,
      'driverReturnConfirmed',cp.driver_return_confirmed_at is not null,
      'riderReturnConfirmed',cp.rider_return_confirmed_at is not null)
      from public.matmove_cash_ride_payments cp where cp.booking_id=b.id),
    'digitalTransfers',(select coalesce(jsonb_agg(jsonb_build_object('kind',t.kind,'status',t.status,
      'amount',t.amount_minor::numeric/100,'providerReference',t.provider_id,'error',t.error) order by t.updated_at),'[]'::jsonb)
      from public.ride_payment_transfers t where t.booking_id=b.id),
    'cashLegs',(select coalesce(jsonb_agg(jsonb_build_object('kind',l.leg_kind,'status',l.status,
      'amount',l.amount_minor::numeric/100,'providerReference',l.provider_transfer_id,'verifiedAt',l.verified_at,'error',l.error_code)
      order by l.updated_at),'[]'::jsonb) from public.matmove_cash_ride_legs l where l.booking_id=b.id),
    'investigations',(select coalesce(jsonb_agg(jsonb_build_object('reasonCode',i.reason_code,'status',i.status,
      'firstSeenAt',i.first_seen_at,'lastSeenAt',i.last_seen_at,'details',i.details) order by i.last_seen_at desc),'[]'::jsonb)
      from public.matmove_ride_investigation_tickets i where i.booking_id=b.id),
    'adminFlags',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'type',f.flag_type,'status',f.status,
      'note',f.note,'createdAt',f.created_at,'resolutionNote',f.resolution_note) order by f.created_at desc),'[]'::jsonb)
      from public.matmove_ride_admin_flags f where f.booking_id=b.id)
  );
end;
$function$;

revoke all on function public.matmove_admin_request_cash_return(uuid,bigint,uuid,text,uuid) from public,anon;
revoke all on function public.matmove_cash_ride_confirm_return(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.matmove_admin_flag_unpaid_booking(uuid,text,uuid) from public,anon;
revoke all on function public.matmove_admin_resolve_ride_flag(uuid,text,uuid) from public,anon;
revoke all on function public.matmove_admin_trip_review(uuid) from public,anon;
grant execute on function public.matmove_admin_request_cash_return(uuid,bigint,uuid,text,uuid) to authenticated;
grant execute on function public.matmove_cash_ride_confirm_return(uuid,uuid,text) to service_role;
grant execute on function public.matmove_admin_flag_unpaid_booking(uuid,text,uuid) to authenticated;
grant execute on function public.matmove_admin_resolve_ride_flag(uuid,text,uuid) to authenticated;
grant execute on function public.matmove_admin_trip_review(uuid) to authenticated;

notify pgrst, 'reload schema';
