-- Draft-only production cash ride state machine.
-- Adds an explicit cash payment method and keeps cash bookings out of driver
-- discovery until the separate 15% fee reserve is independently verified.
-- This migration is for the Customer Draft PR only; do not apply to Production
-- until the Monime restricted holding account has been provisioned and tested.
begin;

alter table public.bookings
  add column if not exists payment_method text not null default 'digital';

alter table public.bookings
  drop constraint if exists bookings_payment_method_check;
alter table public.bookings
  add constraint bookings_payment_method_check
  check (payment_method in ('digital','cash'));

alter table public.bookings
  drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check
  check (status in (
    'pending',
    'pending_admin',
    'cash_reserve_pending',
    'cash_review_required',
    'accepted',
    'in_progress',
    'completed',
    'cancelled'
  ));

create table if not exists public.matmove_cash_ride_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  fee_hold_account_id text,
  fee_revenue_account_id text,
  provider_environment text not null default 'live'
    check (provider_environment in ('test','live')),
  updated_at timestamptz not null default clock_timestamp(),
  constraint matmove_cash_ride_settings_account_shape
    check (
      (fee_hold_account_id is null or fee_hold_account_id ~ '^fac-[A-Za-z0-9_-]+$')
      and
      (fee_revenue_account_id is null or fee_revenue_account_id ~ '^fac-[A-Za-z0-9_-]+$')
    ),
  constraint matmove_cash_ride_settings_accounts_distinct
    check (
      fee_hold_account_id is null
      or fee_revenue_account_id is null
      or fee_hold_account_id <> fee_revenue_account_id
    ),
  constraint matmove_cash_ride_settings_enabled_requires_accounts
    check (
      not enabled
      or (
        fee_hold_account_id is not null
        and fee_revenue_account_id is not null
        and fee_hold_account_id <> fee_revenue_account_id
      )
    )
);

insert into public.matmove_cash_ride_settings(singleton,enabled)
values (true,false)
on conflict (singleton) do nothing;

alter table public.matmove_cash_ride_settings enable row level security;
revoke all on table public.matmove_cash_ride_settings from public, anon, authenticated;
grant select on table public.matmove_cash_ride_settings to service_role;

comment on table public.matmove_cash_ride_settings is
  'Private cash-ride reserve configuration. Disabled by default until Monime provisions and verifies a dedicated restricted fee-holding account.';

create or replace function public.matmove_cash_ride_booking_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog','public'
as $function$
declare
  v_cash_status text;
  v_reserve_status text;
begin
  if tg_op = 'INSERT' then
    if new.payment_method = 'cash'
       and (
         new.service_type is distinct from 'ride'
         or new.status is distinct from 'cash_reserve_pending'
         or new.driver_id is not null
       ) then
      raise exception 'CASH_BOOKING_INVALID: Cash payment is only available for an unassigned ride awaiting fee reservation.';
    end if;
    return new;
  end if;

  if new.payment_method is distinct from old.payment_method then
    raise exception 'PAYMENT_METHOD_IMMUTABLE: A booking payment method cannot be changed after creation.';
  end if;

  if old.payment_method = 'cash' and new.fare_amount is distinct from old.fare_amount then
    raise exception 'CASH_FARE_IMMUTABLE: The quoted cash fare cannot change after the MatMove fee snapshot is created.';
  end if;

  if new.payment_method <> 'cash' then
    return new;
  end if;

  if new.service_type is distinct from 'ride' then
    raise exception 'CASH_BOOKING_INVALID: Cash collection is available for ride bookings only.';
  end if;

  select p.status into v_cash_status
  from public.matmove_cash_ride_payments p
  where p.booking_id = old.id
  for key share;

  if not found then
    raise exception 'CASH_LEDGER_MISSING: Cash ride payment record is missing.';
  end if;

  select l.status into v_reserve_status
  from public.matmove_cash_ride_legs l
  where l.booking_id = old.id and l.leg_kind = 'reserve'
  for key share;

  if new.driver_id is distinct from old.driver_id and new.driver_id is not null then
    if v_cash_status <> 'fee_reserved' or v_reserve_status <> 'completed' then
      raise exception 'CASH_FEE_NOT_RESERVED: A cash ride cannot be assigned before the exact 15 percent fee reserve is verified.';
    end if;
  end if;

  if new.status in ('pending','pending_admin','accepted')
     and (v_cash_status <> 'fee_reserved' or v_reserve_status <> 'completed') then
    raise exception 'CASH_FEE_NOT_RESERVED: A cash ride cannot be dispatched or accepted before the fee reserve is verified.';
  end if;

  if new.status = 'cash_review_required' and v_cash_status <> 'review_required' then
    raise exception 'CASH_REVIEW_STATE_INVALID: Booking review status requires a quarantined cash ledger.';
  end if;

  if new.status = 'in_progress'
     and v_cash_status not in ('collection_pending','capture_pending') then
    raise exception 'CASH_RIDE_NOT_READY: A cash ride cannot start before the verified fee reserve and assigned driver are recorded.';
  end if;

  if new.status = 'completed' then
    if v_cash_status <> 'settled'
       or not exists (
         select 1 from public.matmove_cash_ride_legs l
         where l.booking_id = old.id
           and l.leg_kind = 'capture'
           and l.status = 'completed'
       ) then
      raise exception 'CASH_CAPTURE_NOT_VERIFIED: A cash ride cannot complete until the fee capture is independently verified.';
    end if;
  end if;

  if new.status = 'cancelled'
     and v_cash_status not in ('refunded','cancelled') then
    raise exception 'CASH_REFUND_NOT_VERIFIED: A reserved cash fee must be refunded before the booking can be cancelled.';
  end if;

  return new;
end;
$function$;

drop trigger if exists matmove_cash_ride_booking_guard on public.bookings;
create trigger matmove_cash_ride_booking_guard
before insert or update on public.bookings
for each row execute function public.matmove_cash_ride_booking_guard();

revoke all on function public.matmove_cash_ride_booking_guard()
  from public, anon, authenticated, service_role;

-- Extend the customer trip creation RPC without breaking existing 11-key
-- digital requests. Cash requests add payment_method='cash', are limited to
-- rides, and start in a non-dispatchable state. The reserve must finish before
-- this RPC's booking can be changed to pending.
create or replace function public.matmove_create_customer_trip(
  p_request uuid,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  u uuid := auth.uid();
  role_name text;
  prior public.matmove_customer_trip_requests%rowtype;
  b public.bookings%rowtype;
  seats integer;
  fare numeric;
  fare_minor bigint;
  driver_minor bigint;
  fee_minor bigint;
  service text;
  vehicle text;
  scheduled timestamptz;
  passenger text;
  payment_method text;
  settings_row public.matmove_cash_ride_settings%rowtype;
begin
  if u is null then
    raise exception 'AUTH: Sign in to request a trip.';
  end if;

  role_name := public.matmove_preferences_role(u);
  if role_name is null
     or role_name not in ('rider','merchant')
     or exists (
       select 1 from public.matmove_staff_access
       where id = u and is_active and removed_at is null
     ) then
    raise exception 'FORBIDDEN: Customer booking access required.';
  end if;

  if p_request is null
     or p_details is null
     or jsonb_typeof(p_details) <> 'object'
     or (select count(*) from jsonb_object_keys(p_details)) not in (11,12)
     or exists (
       select 1 from jsonb_object_keys(p_details) k
       where k not in (
         'service_type','vehicle_type','pickup_location',
         'destination_location','fare_amount','scheduled_time',
         'passenger_count','passenger_name','pickup_pin',
         'destination_pin','client_version','payment_method'
       )
     )
     or p_details->>'client_version' is distinct from '1' then
    raise exception 'INVALID: Review the complete trip details.';
  end if;

  payment_method := coalesce(nullif(p_details->>'payment_method',''),'digital');
  if payment_method not in ('digital','cash') then
    raise exception 'INVALID: Choose a supported ride payment method.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(u::text,87192819));

  select * into prior
  from public.matmove_customer_trip_requests
  where id = p_request;

  if found then
    if prior.customer_id <> u or prior.details <> p_details then
      raise exception 'CONFLICT: Original request details do not match.';
    end if;

    select * into b
    from public.bookings
    where id = prior.booking_id and rider_id = u;

    if not found then
      raise exception 'CONFLICT: Original request needs support review.';
    end if;

    return to_jsonb(b);
  end if;

  if exists (
    select 1 from public.bookings
    where rider_id = u
      and status::text in ('pending','pending_admin','cash_reserve_pending')
  ) then
    raise exception 'CONFLICT: Resolve your pending request before creating another.';
  end if;

  service := p_details->>'service_type';
  vehicle := p_details->>'vehicle_type';

  if service not in ('ride','delivery','scheduled')
     or service is null
     or vehicle not in ('car','bike','keke','van')
     or vehicle is null then
    raise exception 'INVALID: Choose a service and vehicle.';
  end if;

  if payment_method = 'cash' then
    if service <> 'ride' or role_name <> 'rider' then
      raise exception 'CASH_RIDE_ONLY: Physical cash collection is currently restricted to rider ride bookings.';
    end if;

    select * into settings_row
    from public.matmove_cash_ride_settings
    where singleton = true;

    if not found or not settings_row.enabled then
      raise exception 'CASH_NOT_CONFIGURED: Cash rides are not enabled until the restricted Monime fee-holding account is configured and verified.';
    end if;
  end if;

  if coalesce(p_details->>'fare_amount','') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then
    raise exception 'INVALID: Review the fare.';
  end if;

  fare := (p_details->>'fare_amount')::numeric;
  if fare <= 0 or fare > 1000000 then
    raise exception 'INVALID: Review the fare.';
  end if;

  fare_minor := round(fare * 100)::bigint;
  driver_minor := round(fare_minor::numeric * 0.85)::bigint;
  fee_minor := fare_minor - driver_minor;

  if payment_method = 'cash' and fee_minor <= 0 then
    raise exception 'INVALID_FARE: Fare is too small to reserve the MatMove cash fee.';
  end if;

  if coalesce(p_details->>'passenger_count','') !~ '^[1-3]$' then
    raise exception 'INVALID: Choose one to three passengers.';
  end if;

  seats := (p_details->>'passenger_count')::integer;
  passenger := nullif(btrim(p_details->>'passenger_name'),'');
  if passenger is not null and length(passenger) not between 2 and 120 then
    raise exception 'INVALID: Check the passenger name.';
  end if;

  if nullif(btrim(p_details->>'pickup_location'),'') is null
     or length(p_details->>'pickup_location') > 1000
     or nullif(btrim(p_details->>'destination_location'),'') is null
     or length(p_details->>'destination_location') > 1000 then
    raise exception 'INVALID: Confirm both addresses.';
  end if;

  if jsonb_typeof(p_details->'pickup_pin') is distinct from 'object'
     or jsonb_typeof(p_details->'destination_pin') is distinct from 'object' then
    raise exception 'INVALID: Confirm both map pins.';
  end if;

  if not (
    (p_details#>>'{pickup_pin,lat}')::float8 between -90 and 90
    and (p_details#>>'{pickup_pin,lng}')::float8 between -180 and 180
    and (p_details#>>'{destination_pin,lat}')::float8 between -90 and 90
    and (p_details#>>'{destination_pin,lng}')::float8 between -180 and 180
  )
  or p_details#>>'{pickup_pin,lat}' is null
  or p_details#>>'{pickup_pin,lng}' is null
  or p_details#>>'{destination_pin,lat}' is null
  or p_details#>>'{destination_pin,lng}' is null then
    raise exception 'INVALID: Confirm valid map pins.';
  end if;

  scheduled := nullif(p_details->>'scheduled_time','')::timestamptz;
  if service = 'scheduled' and (scheduled is null or scheduled <= clock_timestamp()) then
    raise exception 'INVALID: Select a future scheduled time.';
  end if;
  if service <> 'scheduled' and scheduled is not null then
    raise exception 'INVALID: Only scheduled trips accept a schedule.';
  end if;

  b := jsonb_populate_record(
    null::public.bookings,
    jsonb_build_object(
      'id',p_request,
      'rider_id',u,
      'service_type',service,
      'vehicle_type',vehicle,
      'pickup_location',btrim(p_details->>'pickup_location'),
      'destination_location',btrim(p_details->>'destination_location'),
      'fare_amount',fare,
      'scheduled_time',scheduled,
      'status',
        case
          when payment_method = 'cash' then 'cash_reserve_pending'
          when role_name = 'merchant' or service = 'scheduled' then 'pending_admin'
          else 'pending'
        end,
      'payment_method',payment_method,
      'passenger_count',seats,
      'passenger_name',passenger,
      'matmove_pickup_lat',(p_details#>>'{pickup_pin,lat}')::float8,
      'matmove_pickup_lng',(p_details#>>'{pickup_pin,lng}')::float8,
      'matmove_destination_lat',(p_details#>>'{destination_pin,lat}')::float8,
      'matmove_destination_lng',(p_details#>>'{destination_pin,lng}')::float8
    )
  );

  insert into public.bookings(
    id,rider_id,service_type,vehicle_type,pickup_location,
    destination_location,fare_amount,scheduled_time,status,
    payment_method,passenger_count,passenger_name,
    matmove_pickup_lat,matmove_pickup_lng,
    matmove_destination_lat,matmove_destination_lng
  )
  values(
    b.id,b.rider_id,b.service_type,b.vehicle_type,b.pickup_location,
    b.destination_location,b.fare_amount,b.scheduled_time,b.status,
    b.payment_method,b.passenger_count,b.passenger_name,
    b.matmove_pickup_lat,b.matmove_pickup_lng,
    b.matmove_destination_lat,b.matmove_destination_lng
  )
  returning * into b;

  if payment_method = 'cash' then
    insert into public.matmove_cash_ride_payments(
      booking_id,rider_id,driver_id,fare_minor,
      driver_cash_minor,matmove_fee_minor,currency,status
    )
    values(
      b.id,u,null,fare_minor,driver_minor,fee_minor,'SLE','reserve_ready'
    );

    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,actor_profile_id,details
    )
    values(
      b.id,'cash_payment_created','rider',u,
      jsonb_build_object(
        'fareMinor',fare_minor,
        'driverCashMinor',driver_minor,
        'matmoveFeeMinor',fee_minor,
        'currency','SLE'
      )
    );
  end if;

  insert into public.matmove_customer_trip_requests(id,customer_id,details,booking_id)
  values(p_request,u,p_details,b.id);

  return to_jsonb(b);
end;
$function$;

revoke all on function public.matmove_create_customer_trip(uuid,jsonb)
  from public, anon;
grant execute on function public.matmove_create_customer_trip(uuid,jsonb)
  to authenticated;

-- Service-role-only RPCs are the only way to advance cash reserve/settlement
-- state. They do not call Monime; the server worker does that after a claim.
create or replace function public.matmove_cash_ride_leg_insert_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_payment public.matmove_cash_ride_payments%rowtype;
  v_wallet_account text;
  v_reserve public.matmove_cash_ride_legs%rowtype;
  v_settings public.matmove_cash_ride_settings%rowtype;
begin
  select * into v_payment
  from public.matmove_cash_ride_payments p
  where p.booking_id = new.booking_id
  for update;

  if not found or v_payment.matmove_fee_minor <= 0
     or new.amount_minor is distinct from v_payment.matmove_fee_minor then
    raise exception 'CASH_LEG_AMOUNT_MISMATCH: Cash reserve, capture and refund legs must equal the locked MatMove fee.';
  end if;

  select * into v_settings
  from public.matmove_cash_ride_settings
  where singleton = true
  for key share;

  if not found or not v_settings.enabled
     or v_settings.fee_hold_account_id is null
     or v_settings.fee_revenue_account_id is null then
    raise exception 'CASH_NOT_CONFIGURED: Restricted fee-holding account is not configured.';
  end if;

  if new.leg_kind = 'reserve' then
    select coalesce(w.monime_account_id,w.metadata->>'monime_account_id')
      into v_wallet_account
    from public.wallets w
    where w.user_id = v_payment.rider_id
      and w.currency = 'SLE'
    for key share;

    if not found
       or nullif(btrim(v_wallet_account), '') is null
       or new.source_account_ref is distinct from v_wallet_account
       or new.destination_account_ref is distinct from v_settings.fee_hold_account_id then
      raise exception 'CASH_RESERVE_ACCOUNT_MISMATCH: Reserve must debit the rider SLE account and credit the configured restricted cash-fee holding account.';
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

      if new.source_account_ref is distinct from v_settings.fee_hold_account_id
         or new.destination_account_ref is distinct from v_settings.fee_revenue_account_id
         or new.source_account_ref is distinct from v_reserve.destination_account_ref then
        raise exception 'CASH_CAPTURE_ACCOUNT_MISMATCH: Capture must move the fee from the exact restricted holding account to the configured MatMove fee account.';
      end if;
    elsif new.leg_kind = 'refund' then
      if new.source_account_ref is distinct from v_settings.fee_hold_account_id
         or new.source_account_ref is distinct from v_reserve.destination_account_ref
         or new.destination_account_ref is distinct from v_reserve.source_account_ref then
        raise exception 'CASH_REFUND_ACCOUNT_MISMATCH: Refund must reverse the original verified reserve from the restricted holding account.';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.matmove_cash_ride_prepare_leg(
  p_booking_id uuid,
  p_leg_kind text,
  p_actor_id uuid,
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
  reserve public.matmove_cash_ride_legs%rowtype;
  wallet_account text;
  source_ref text;
  destination_ref text;
  request_ref text;
  existing public.matmove_cash_ride_legs%rowtype;
begin
  if p_booking_id is null or p_leg_kind not in ('reserve','capture','refund') then
    raise exception 'INVALID: A valid cash ride and transfer leg are required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' or b.service_type <> 'ride' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments
  where booking_id=p_booking_id for update;
  if not found or p.matmove_fee_minor <= 0 then
    raise exception 'CASH_LEDGER_MISSING: Cash payment record not found.';
  end if;

  select * into cfg from public.matmove_cash_ride_settings
  where singleton=true for share;
  if not found or not cfg.enabled
     or cfg.fee_hold_account_id is null
     or cfg.fee_revenue_account_id is null
     or p_environment is distinct from cfg.provider_environment then
    raise exception 'CASH_NOT_CONFIGURED: Restricted fee-holding account is not configured.';
  end if;


  if p_leg_kind = 'reserve' and p.status = 'fee_reserved' then
    select * into existing
    from public.matmove_cash_ride_legs
    where booking_id=p_booking_id and leg_kind='reserve'
    for key share;
    if found and existing.status='completed' then
      return to_jsonb(existing);
    end if;
  elsif p_leg_kind = 'capture' and p.status = 'settled' then
    select * into existing
    from public.matmove_cash_ride_legs
    where booking_id=p_booking_id and leg_kind='capture'
    for key share;
    if found and existing.status='completed' then
      return to_jsonb(existing);
    end if;
  elsif p_leg_kind = 'refund' and p.status = 'refunded' then
    select * into existing
    from public.matmove_cash_ride_legs
    where booking_id=p_booking_id and leg_kind='refund'
    for key share;
    if found and existing.status='completed' then
      return to_jsonb(existing);
    end if;
  end if;

  if p_leg_kind='reserve' then
    if p_actor_id is distinct from p.rider_id
       or b.status <> 'cash_reserve_pending'
       or p.status not in ('reserve_ready','reserve_pending') then
      raise exception 'FORBIDDEN: Only the rider can reserve the cash-ride MatMove fee.';
    end if;

    if not exists (
      select 1 from public.profiles
      where id=p.rider_id and role='rider'
        and not coalesce(is_wallet_frozen,false)
    ) or exists (
      select 1 from public.wallets
      where user_id=p.rider_id and currency='SLE' and coalesce(is_frozen,false)
    ) then
      raise exception 'WALLET_FROZEN: Rider SLE wallet is frozen.';
    end if;

    select coalesce(w.monime_account_id,w.metadata->>'monime_account_id')
      into wallet_account
    from public.wallets w
    where w.user_id=p.rider_id and w.currency='SLE'
    for key share;

    if not found or nullif(btrim(wallet_account),'') is null then
      raise exception 'WALLET_NOT_READY: Rider SLE Monime account is not linked.';
    end if;

    if exists (
      select 1 from public.wallets w
      where w.id <> (
        select id from public.wallets where user_id=p.rider_id and currency='SLE'
      )
      and (
        w.monime_account_id=wallet_account
        or w.metadata->>'monime_account_id'=wallet_account
      )
    ) then
      raise exception 'ACCOUNT_LINK_CONFLICT: Rider Monime account is linked to another wallet.';
    end if;

    source_ref := wallet_account;
    destination_ref := cfg.fee_hold_account_id;

  elsif p_leg_kind='capture' then
    if p_actor_id is null
       or p_actor_id not in (p.rider_id,p.driver_id)
       or b.status <> 'in_progress'
       or p.status <> 'capture_pending'
       or not (
         (p.driver_cash_confirmed_at is not null and p.rider_cash_confirmed_at is not null)
         or p.manual_resolution_at is not null
       ) then
      raise exception 'CASH_COLLECTION_NOT_CONFIRMED: Both parties must confirm physical cash collection before fee capture.';
    end if;

    select * into reserve from public.matmove_cash_ride_legs
    where booking_id=p_booking_id and leg_kind='reserve' for key share;
    if not found or reserve.status <> 'completed'
       or reserve.destination_account_ref <> cfg.fee_hold_account_id then
      raise exception 'CASH_RESERVE_NOT_VERIFIED: Fee reserve is not verified in the restricted holding account.';
    end if;

    source_ref := cfg.fee_hold_account_id;
    destination_ref := cfg.fee_revenue_account_id;

  else
    if p_actor_id is null
       or p.status <> 'refund_pending'
       or b.status not in ('cash_reserve_pending','pending','accepted')
       or not (
         (p_actor_id=p.rider_id and b.status in ('cash_reserve_pending','pending'))
         or (p_actor_id=p.driver_id and b.status='accepted' and b.started_at is null)
       ) then
      raise exception 'INVALID_STATE: Cash fee refund is not eligible.';
    end if;

    select * into reserve from public.matmove_cash_ride_legs
    where booking_id=p_booking_id and leg_kind='reserve' for key share;
    if not found or reserve.status <> 'completed' then
      raise exception 'CASH_RESERVE_NOT_VERIFIED: Only an exactly verified fee reserve can be refunded.';
    end if;

    source_ref := reserve.destination_account_ref;
    destination_ref := reserve.source_account_ref;
  end if;

  request_ref := 'matmove-cash:'||p_booking_id::text||':'||p_leg_kind;

  select * into existing from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind=p_leg_kind for update;

  if found then
    if existing.amount_minor <> p.matmove_fee_minor
       or existing.source_account_ref <> source_ref
       or existing.destination_account_ref <> destination_ref
       or existing.request_key <> request_ref then
      raise exception 'CASH_LEG_CONFLICT: Existing cash transfer request does not match the current booking.';
    end if;
    return to_jsonb(existing);
  end if;

  insert into public.matmove_cash_ride_legs(
    booking_id,leg_kind,amount_minor,currency,
    source_account_ref,destination_account_ref,request_key,status
  )
  values(
    p_booking_id,p_leg_kind,p.matmove_fee_minor,'SLE',
    source_ref,destination_ref,request_ref,'ready'
  )
  returning * into existing;

  update public.matmove_cash_ride_payments
  set status=case p_leg_kind
    when 'reserve' then 'reserve_pending'
    when 'capture' then 'capture_pending'
    else 'refund_pending'
  end
  where booking_id=p_booking_id;

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,actor_profile_id,details
  )
  values(
    p_booking_id,
    case p_leg_kind when 'reserve' then 'reserve_requested'
      when 'capture' then 'capture_requested' else 'refund_requested' end,
    'system',null,
    jsonb_build_object('legKind',p_leg_kind,'amountMinor',p.matmove_fee_minor,'currency','SLE')
  );

  return to_jsonb(existing);
end;
$function$;

create or replace function public.matmove_cash_ride_claim_leg(
  p_booking_id uuid,
  p_leg_kind text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  l public.matmove_cash_ride_legs%rowtype;
begin
  select * into l from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind=p_leg_kind
  for update;

  if not found then
    raise exception 'NOT_FOUND: Cash transfer leg not found.';
  end if;

  if l.status='ready' and l.attempted_at is null then
    update public.matmove_cash_ride_legs
    set status='processing',attempted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=l.id returning * into l;
    return jsonb_build_object('leg',to_jsonb(l),'canCreate',true,'canLookup',false);
  end if;

  if l.status in ('pending','processing') and l.provider_transfer_id is not null then
    return jsonb_build_object('leg',to_jsonb(l),'canCreate',false,'canLookup',true);
  end if;

  if l.status='processing'
     and l.provider_transfer_id is null
     and l.attempted_at < clock_timestamp()-interval '2 minutes' then
    update public.matmove_cash_ride_legs
    set status='review_required',error_code='uncertain_post',updated_at=clock_timestamp()
    where id=l.id returning * into l;

    update public.matmove_cash_ride_payments
    set status='review_required',updated_at=clock_timestamp()
    where booking_id=p_booking_id;

    update public.bookings
    set status='cash_review_required',updated_at=clock_timestamp()
    where id=p_booking_id and status in ('cash_reserve_pending','pending','pending_admin','accepted');

    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,details
    ) values(
      p_booking_id,'manual_review_opened','system',
      jsonb_build_object('legKind',p_leg_kind,'reasonCode','uncertain_post')
    );

    return jsonb_build_object('leg',to_jsonb(l),'canCreate',false,'canLookup',false);
  end if;

  return jsonb_build_object('leg',to_jsonb(l),'canCreate',false,'canLookup',false);
end;
$function$;

create or replace function public.matmove_cash_ride_record_leg(
  p_booking_id uuid,
  p_leg_kind text,
  p_provider_transfer_id text,
  p_provider_status text,
  p_verified_amount_minor bigint default null,
  p_verified_currency text default null,
  p_verified_source_account text default null,
  p_verified_destination_account text default null,
  p_verified_reference text default null,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
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

  select * into l from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind=p_leg_kind for update;
  if not found then raise exception 'NOT_FOUND: Cash transfer leg not found.'; end if;

  if l.status='completed' then
    if p_provider_transfer_id is distinct from l.provider_transfer_id then
      raise exception 'CASH_RECEIPT_CONFLICT: A completed cash leg cannot be replaced.';
    end if;
    return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',p.status,'bookingStatus',b.status);
  end if;

  if l.status in ('review_required','failed') then
    return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',p.status,'bookingStatus',b.status);
  end if;

  if l.provider_transfer_id is not null
     and p_provider_transfer_id is distinct from l.provider_transfer_id then
    raise exception 'CASH_PROVIDER_ID_CONFLICT: Provider transfer ID cannot be replaced.';
  end if;

  update public.matmove_cash_ride_legs
  set provider_transfer_id=coalesce(provider_transfer_id,p_provider_transfer_id),
      status=p_provider_status,
      verified_amount_minor=case when p_provider_status='completed' then p_verified_amount_minor else verified_amount_minor end,
      verified_currency=case when p_provider_status='completed' then p_verified_currency else verified_currency end,
      verified_source_account_ref=case when p_provider_status='completed' then p_verified_source_account else verified_source_account_ref end,
      verified_destination_account_ref=case when p_provider_status='completed' then p_verified_destination_account else verified_destination_account_ref end,
      verified_reference=case when p_provider_status='completed' then p_verified_reference else verified_reference end,
      verified_at=case when p_provider_status='completed' then clock_timestamp() else verified_at end,
      error_code=p_error_code,
      updated_at=clock_timestamp()
  where id=l.id returning * into l;

  if p_provider_status='completed' then
    if p_verified_reference is distinct from l.request_key then
      raise exception 'CASH_RECEIPT_REFERENCE_MISMATCH: Provider receipt request reference does not match the original idempotency reference.';
    end if;

    next_state := case p_leg_kind
      when 'reserve' then 'fee_reserved'
      when 'capture' then 'settled'
      when 'refund' then 'refunded'
    end;

    update public.matmove_cash_ride_payments
    set status=next_state,updated_at=clock_timestamp()
    where booking_id=p_booking_id;

    if p_leg_kind='reserve' then
      update public.bookings
      set status='pending',updated_at=clock_timestamp()
      where id=p_booking_id and status='cash_reserve_pending';
    elsif p_leg_kind='capture' then
      update public.bookings
      set status='completed',updated_at=clock_timestamp()
      where id=p_booking_id and status='in_progress';
    elsif p_leg_kind='refund' then
      update public.bookings
      set status='cancelled',updated_at=clock_timestamp()
      where id=p_booking_id and status in ('cash_reserve_pending','pending','accepted');
    end if;

    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,details
    ) values (
      p_booking_id,
      case p_leg_kind when 'reserve' then 'reserve_verified'
        when 'capture' then 'capture_verified' else 'refund_verified' end,
      'system',
      jsonb_build_object('legKind',p_leg_kind,'providerTransferId',l.provider_transfer_id,'amountMinor',l.amount_minor,'currency','SLE')
    );

  elsif p_provider_status in ('failed','review_required') then
    update public.matmove_cash_ride_payments
    set status='review_required',updated_at=clock_timestamp()
    where booking_id=p_booking_id;

    update public.bookings
    set status='cash_review_required',updated_at=clock_timestamp()
    where id=p_booking_id and status in ('cash_reserve_pending','pending','pending_admin','accepted');

    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,details
    ) values (
      p_booking_id,'manual_review_opened','system',
      jsonb_build_object('legKind',p_leg_kind,'reasonCode',coalesce(p_error_code,'provider_not_verified'))
    );
  end if;

  return jsonb_build_object('leg',to_jsonb(l),'paymentStatus',next_state,'bookingStatus',b.status);
end;
$function$;

create or replace function public.matmove_cash_ride_assign_driver(
  p_booking_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
  eligibility jsonb;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments
  where booking_id=p_booking_id for update;
  if not found or p.status <> 'fee_reserved' or b.status <> 'pending' then
    raise exception 'CASH_FEE_NOT_RESERVED: Cash fee must be reserved before driver acceptance.';
  end if;

  select * into reserve from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind='reserve' for key share;
  if not found or reserve.status <> 'completed' then
    raise exception 'CASH_FEE_NOT_RESERVED: Verified fee reserve is required.';
  end if;

  if p_driver_id is null or p_driver_id=p.rider_id then
    raise exception 'FORBIDDEN: Choose a different approved driver.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver_id::text,0));
  eligibility := public.matmove_dispatch_driver_status(p_driver_id,p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %',eligibility->>'reason';
  end if;

  if b.driver_id is not null and b.driver_id is distinct from p_driver_id then
    raise exception 'CONFLICT: Another driver is already assigned.';
  end if;

  update public.bookings
  set driver_id=p_driver_id,status='accepted',updated_at=clock_timestamp()
  where id=p_booking_id
  returning * into b;

  update public.matmove_cash_ride_payments
  set driver_id=p_driver_id,updated_at=clock_timestamp()
  where booking_id=p_booking_id
  returning * into p;

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,actor_profile_id,details
  ) values (
    p_booking_id,'driver_assigned','driver',p_driver_id,
    jsonb_build_object('driverId',p_driver_id)
  );

  return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(p));
end;
$function$;

create or replace function public.matmove_cash_ride_start(
  p_booking_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments where booking_id=p_booking_id for update;
  if not found or b.driver_id is distinct from p_driver_id
     or p.driver_id is distinct from p_driver_id
     or b.status <> 'accepted'
     or p.status <> 'fee_reserved' then
    raise exception 'INVALID_STATE: Assigned cash-ride driver and verified fee reserve are required.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id=p_driver_id and role='driver'
      and kyc_status='approved'
      and not coalesce(is_wallet_frozen,false)
  ) or exists (
    select 1 from public.wallets
    where user_id=p_driver_id and coalesce(is_frozen,false)
  ) then
    raise exception 'FORBIDDEN: Driver approval and unfrozen wallets are required.';
  end if;

  update public.matmove_cash_ride_payments
  set status='collection_pending',updated_at=clock_timestamp()
  where booking_id=p_booking_id;

  update public.bookings
  set status='in_progress',updated_at=clock_timestamp()
  where id=p_booking_id
  returning * into b;

  return jsonb_build_object('booking',to_jsonb(b),'paymentStatus','collection_pending');
end;
$function$;

create or replace function public.matmove_cash_ride_confirm_collection(
  p_booking_id uuid,
  p_actor_id uuid,
  p_actor_type text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
begin
  if p_actor_type not in ('rider','driver') or p_actor_id is null then
    raise exception 'INVALID: A valid rider or driver confirmation is required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments where booking_id=p_booking_id for update;
  if not found then raise exception 'CASH_LEDGER_MISSING: Cash payment record not found.'; end if;

  if p.status='settled'
     and p.driver_cash_confirmed_at is not null
     and p.rider_cash_confirmed_at is not null then
    return jsonb_build_object(
      'paymentStatus','settled',
      'driverConfirmed',true,
      'riderConfirmed',true,
      'captureReady',false,
      'settled',true
    );
  end if;

  if b.status <> 'in_progress' or p.status not in ('collection_pending','capture_pending') then
    raise exception 'INVALID_STATE: Cash collection confirmation is not available.';
  end if;

  if p_actor_type='rider' then
    if p_actor_id is distinct from p.rider_id then
      raise exception 'FORBIDDEN: Only the booking rider can confirm cash collection.';
    end if;
    if p.rider_cash_confirmed_at is null then
      update public.matmove_cash_ride_payments
      set rider_cash_confirmed_at=clock_timestamp(),
          rider_cash_confirmed_by=p_actor_id,
          updated_at=clock_timestamp()
      where booking_id=p_booking_id returning * into p;

      insert into public.matmove_cash_ride_audit_events(
        booking_id,event_type,actor_type,actor_profile_id
      ) values(p_booking_id,'rider_cash_confirmed','rider',p_actor_id);
    end if;
  else
    if p_actor_id is distinct from p.driver_id or p_actor_id is distinct from b.driver_id then
      raise exception 'FORBIDDEN: Only the assigned driver can confirm physical cash collection.';
    end if;
    if p.driver_cash_confirmed_at is null then
      update public.matmove_cash_ride_payments
      set driver_cash_confirmed_at=clock_timestamp(),
          driver_cash_confirmed_by=p_actor_id,
          updated_at=clock_timestamp()
      where booking_id=p_booking_id returning * into p;

      insert into public.matmove_cash_ride_audit_events(
        booking_id,event_type,actor_type,actor_profile_id
      ) values(p_booking_id,'driver_cash_confirmed','driver',p_actor_id);
    end if;
  end if;

  if p.driver_cash_confirmed_at is not null and p.rider_cash_confirmed_at is not null then
    update public.matmove_cash_ride_payments
    set status='capture_pending',updated_at=clock_timestamp()
    where booking_id=p_booking_id returning * into p;
  end if;

  return jsonb_build_object(
    'paymentStatus',p.status,
    'driverConfirmed',p.driver_cash_confirmed_at is not null,
    'riderConfirmed',p.rider_cash_confirmed_at is not null,
    'captureReady',p.status='capture_pending'
  );
end;
$function$;

create or replace function public.matmove_cash_ride_cancel(
  p_booking_id uuid,
  p_actor_id uuid,
  p_actor_type text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
begin
  if p_actor_id is null or p_actor_type not in ('rider','driver') then
    raise exception 'INVALID: A valid rider or driver is required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments where booking_id=p_booking_id for update;
  if not found then raise exception 'CASH_LEDGER_MISSING: Cash payment record not found.'; end if;

  if p_actor_type='rider' then
    if p_actor_id is distinct from p.rider_id or b.status not in ('cash_reserve_pending','pending') then
      raise exception 'FORBIDDEN: Riders may cancel cash requests only before driver acceptance.';
    end if;
  else
    if p_actor_id is distinct from p.driver_id
       or b.driver_id is distinct from p_actor_id
       or b.status <> 'accepted'
       or b.started_at is not null then
      raise exception 'FORBIDDEN: Only the assigned driver may cancel before starting a cash ride.';
    end if;
  end if;

  if p.status='reserve_ready' then
    update public.matmove_cash_ride_payments
    set status='cancelled',updated_at=clock_timestamp()
    where booking_id=p_booking_id;
    update public.bookings
    set status='cancelled',updated_at=clock_timestamp()
    where id=p_booking_id;
    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,actor_profile_id
    ) values(p_booking_id,'payment_cancelled',p_actor_type,p_actor_id);
    return jsonb_build_object('cancelled',true,'refundRequired',false);
  end if;

  if p.status='reserve_pending' and exists (
    select 1 from public.matmove_cash_ride_legs l
    where l.booking_id=p_booking_id and l.leg_kind='reserve'
      and l.status='ready' and l.attempted_at is null
  ) then
    update public.matmove_cash_ride_legs
    set status='failed',error_code='cancelled_before_attempt',updated_at=clock_timestamp()
    where booking_id=p_booking_id and leg_kind='reserve'
      and status='ready' and attempted_at is null;
    update public.matmove_cash_ride_payments
    set status='cancelled',updated_at=clock_timestamp()
    where booking_id=p_booking_id;
    update public.bookings set status='cancelled',updated_at=clock_timestamp()
    where id=p_booking_id;
    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,actor_profile_id
    ) values(p_booking_id,'payment_cancelled',p_actor_type,p_actor_id);
    return jsonb_build_object('cancelled',true,'refundRequired',false);
  end if;

  if p.status='fee_reserved' then
    update public.matmove_cash_ride_payments
    set status='refund_pending',updated_at=clock_timestamp()
    where booking_id=p_booking_id;
    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,actor_profile_id
    ) values(p_booking_id,'refund_requested',p_actor_type,p_actor_id);
    return jsonb_build_object('cancelled',false,'refundRequired',true);
  end if;

  -- Unknown, pending or partially confirmed provider activity is quarantined.
  update public.matmove_cash_ride_payments
  set status='review_required',updated_at=clock_timestamp()
  where booking_id=p_booking_id;

  update public.bookings
  set status='cash_review_required',updated_at=clock_timestamp()
  where id=p_booking_id and status in ('cash_reserve_pending','pending','pending_admin','accepted');

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,actor_profile_id,details
  ) values(
    p_booking_id,'manual_review_opened',p_actor_type,p_actor_id,
    jsonb_build_object('reasonCode','cash_cancel_during_uncertain_payment')
  );

  return jsonb_build_object('cancelled',false,'refundRequired',false,'reviewRequired',true);
end;
$function$;

-- Every cash state RPC is internal to the server. Browser clients cannot
-- call it directly or mutate any cash row.
revoke all on function public.matmove_cash_ride_prepare_leg(uuid,text,uuid,text)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_claim_leg(uuid,text)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_record_leg(uuid,text,text,text,bigint,text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_assign_driver(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_start(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_confirm_collection(uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.matmove_cash_ride_cancel(uuid,uuid,text)
  from public,anon,authenticated;

grant execute on function public.matmove_cash_ride_prepare_leg(uuid,text,uuid,text) to service_role;
grant execute on function public.matmove_cash_ride_claim_leg(uuid,text) to service_role;
grant execute on function public.matmove_cash_ride_record_leg(uuid,text,text,text,bigint,text,text,text,text,text) to service_role;
grant execute on function public.matmove_cash_ride_assign_driver(uuid,uuid) to service_role;
grant execute on function public.matmove_cash_ride_start(uuid,uuid) to service_role;
grant execute on function public.matmove_cash_ride_confirm_collection(uuid,uuid,text) to service_role;
grant execute on function public.matmove_cash_ride_cancel(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
