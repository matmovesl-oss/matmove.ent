-- MatMove cash ride: rider digitally pays the 15% platform fee;
-- driver receives the full fare in physical cash.
-- This migration is intended for the reviewed feature branch only.
begin;

alter table public.bookings
  add column if not exists payment_method text not null default 'digital';

alter table public.bookings
  alter column payment_method set default 'digital',
  alter column payment_method set not null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_payment_method_check'
  ) then
    alter table public.bookings
      add constraint bookings_payment_method_check
      check (payment_method in ('digital','cash'));
  end if;
end;
$constraint$;

create table if not exists public.ride_cash_fee_payments (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  rider_id uuid not null references public.profiles(id) on delete restrict,
  fare_minor bigint not null check (fare_minor > 0),
  fee_minor bigint not null check (fee_minor > 0),
  cash_due_minor bigint not null check (cash_due_minor > 0),
  vehicle_type text not null,
  payer_account text not null,
  fee_account text not null,
  state text not null default 'funding'
    check (state in ('funding','paid','refunding','refunded','failed','review_required')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (fare_minor = cash_due_minor),
  check (fee_minor < fare_minor),
  check (payer_account <> fee_account),
  check (payer_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (fee_account ~ '^fac-[A-Za-z0-9_-]+$')
);

create table if not exists public.ride_cash_fee_transfers (
  booking_id uuid not null references public.ride_cash_fee_payments(booking_id) on delete restrict,
  kind text not null check (kind in ('fee','refund')),
  amount_minor bigint not null check (amount_minor > 0),
  source_account text not null,
  destination_account text not null,
  request_key text not null default gen_random_uuid()::text,
  provider_id text,
  status text not null default 'ready'
    check (status in ('ready','pending','processing','completed','failed','review_required')),
  attempted_at timestamptz,
  error text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (booking_id,kind),
  unique (request_key),
  unique (provider_id),
  check (source_account <> destination_account),
  check (source_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (destination_account ~ '^fac-[A-Za-z0-9_-]+$')
);

create index if not exists ride_cash_fee_payments_state_updated_idx
  on public.ride_cash_fee_payments(state,updated_at);

create index if not exists ride_cash_fee_transfers_status_updated_idx
  on public.ride_cash_fee_transfers(status,updated_at);

alter table public.ride_cash_fee_payments enable row level security;
alter table public.ride_cash_fee_transfers enable row level security;

revoke all on table public.ride_cash_fee_payments from public,anon,authenticated;
revoke all on table public.ride_cash_fee_transfers from public,anon,authenticated;
grant select,insert,update on table public.ride_cash_fee_payments to service_role;
grant select,insert,update on table public.ride_cash_fee_transfers to service_role;

-- Cash cannot be introduced by a direct browser INSERT or changed after creation.
-- The guarded trip-creation RPC runs with its owner privileges and may set it.
create or replace function public.matmove_guard_cash_payment_method()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.payment_method = 'cash'
      and current_user not in ('postgres','service_role') then
      raise exception 'FORBIDDEN: Cash payment must be created through the protected trip request flow.';
    end if;
  elsif tg_op = 'UPDATE' and new.payment_method is distinct from old.payment_method then
    raise exception 'LOCKED: A trip payment method cannot be changed after the booking is created.';
  end if;
  return new;
end;
$function$;

drop trigger if exists matmove_guard_cash_payment_method on public.bookings;
create trigger matmove_guard_cash_payment_method
before insert or update of payment_method on public.bookings
for each row execute function public.matmove_guard_cash_payment_method();

-- Replace the secure customer booking RPC to accept an optional payment_method.
-- Legacy 11-key callers remain valid and default to digital.
create or replace function public.matmove_create_customer_trip(
  p_request uuid,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  u uuid := auth.uid();
  role_name text;
  prior public.matmove_customer_trip_requests%rowtype;
  b public.bookings%rowtype;
  seats integer;
  fare numeric;
  service text;
  vehicle text;
  scheduled timestamptz;
  passenger text;
  payment_method text;
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
      select 1
      from jsonb_object_keys(p_details) k
      where k not in (
        'service_type','vehicle_type','pickup_location','destination_location',
        'fare_amount','scheduled_time','passenger_count','passenger_name',
        'pickup_pin','destination_pin','client_version','payment_method'
      )
    )
    or p_details->>'client_version' is distinct from '1'
    or ((select count(*) from jsonb_object_keys(p_details)) = 12
      and not (p_details ? 'payment_method')) then
    raise exception 'INVALID: Review the complete trip details.';
  end if;

  payment_method := coalesce(nullif(btrim(p_details->>'payment_method'),''),'digital');
  if payment_method not in ('digital','cash') then
    raise exception 'INVALID: Choose a supported payment method.';
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
    where rider_id = u and status::text in ('pending','pending_admin')
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

  if payment_method = 'cash'
    and (role_name <> 'rider' or service <> 'ride'
      or nullif(p_details->>'scheduled_time','') is not null) then
    raise exception 'INVALID: Cash payment is currently available for immediate Rider trips only.';
  end if;

  if coalesce(p_details->>'fare_amount','') !~ '^[0-9]{1,7}([.][0-9]{1,2})?$' then
    raise exception 'INVALID: Review the fare.';
  end if;

  fare := (p_details->>'fare_amount')::numeric;
  if fare <= 0 or fare > 1000000 then
    raise exception 'INVALID: Review the fare.';
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
    ((p_details#>>'{pickup_pin,lat}')::float8 between -90 and 90)
    and ((p_details#>>'{pickup_pin,lng}')::float8 between -180 and 180)
    and ((p_details#>>'{destination_pin,lat}')::float8 between -90 and 90)
    and ((p_details#>>'{destination_pin,lng}')::float8 between -180 and 180)
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
      'status',case when role_name='merchant' or service='scheduled' then 'pending_admin' else 'pending' end,
      'passenger_count',seats,
      'passenger_name',passenger,
      'payment_method',payment_method,
      'matmove_pickup_lat',(p_details#>>'{pickup_pin,lat}')::float8,
      'matmove_pickup_lng',(p_details#>>'{pickup_pin,lng}')::float8,
      'matmove_destination_lat',(p_details#>>'{destination_pin,lat}')::float8,
      'matmove_destination_lng',(p_details#>>'{destination_pin,lng}')::float8
    )
  );

  insert into public.bookings(
    id,rider_id,service_type,vehicle_type,pickup_location,destination_location,
    fare_amount,scheduled_time,status,passenger_count,passenger_name,payment_method,
    matmove_pickup_lat,matmove_pickup_lng,matmove_destination_lat,matmove_destination_lng
  )
  values(
    b.id,b.rider_id,b.service_type,b.vehicle_type,b.pickup_location,b.destination_location,
    b.fare_amount,b.scheduled_time,b.status,b.passenger_count,b.passenger_name,b.payment_method,
    b.matmove_pickup_lat,b.matmove_pickup_lng,b.matmove_destination_lat,b.matmove_destination_lng
  )
  returning * into b;

  insert into public.matmove_customer_trip_requests(id,customer_id,details,booking_id)
  values(p_request,u,p_details,b.id);

  return to_jsonb(b);
end;
$function$;

revoke all on function public.matmove_create_customer_trip(uuid,jsonb) from public,anon;
grant execute on function public.matmove_create_customer_trip(uuid,jsonb) to authenticated,service_role;

-- Called only by the trusted MatMove server after authenticating the rider.
create or replace function public.matmove_prepare_cash_ride_fee(
  p_booking_id uuid,
  p_rider_id uuid,
  p_payer_account text,
  p_fee_account text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  pr public.profiles%rowtype;
  payment public.ride_cash_fee_payments%rowtype;
  transfer public.ride_cash_fee_transfers%rowtype;
  fare bigint;
  fee bigint;
  wallet_count integer;
  wallet_account text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: Trusted server required.';
  end if;

  if p_booking_id is null or p_rider_id is null
    or p_payer_account !~ '^fac-[A-Za-z0-9_-]+$'
    or p_fee_account !~ '^fac-[A-Za-z0-9_-]+$'
    or p_payer_account = p_fee_account then
    raise exception 'INVALID: Cash fee account details are invalid.';
  end if;

  select * into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found or b.rider_id is distinct from p_rider_id then
    raise exception 'FORBIDDEN: This cash trip does not belong to the signed-in customer.';
  end if;

  if b.payment_method <> 'cash'
    or b.service_type <> 'ride'
    or b.scheduled_time is not null
    or b.status not in ('pending','pending_admin') then
    raise exception 'INVALID_STATE: This booking is not eligible for cash payment.';
  end if;

  if exists (select 1 from public.ride_payments where booking_id = b.id) then
    raise exception 'CONFLICT: A digital escrow payment already exists for this booking.';
  end if;

  select * into pr from public.profiles where id = p_rider_id;
  if not found
    or pr.role::text not in ('rider','merchant')
    or (pr.role::text = 'merchant' and pr.kyc_status::text <> 'approved')
    or coalesce(pr.is_wallet_frozen,false)
    or exists (
      select 1 from public.matmove_staff_access
      where id = p_rider_id and is_active and removed_at is null
    )
    or exists (
      select 1 from public.user_roles
      where profile_id = p_rider_id
        and (role is null or role::text not in ('rider','driver','merchant'))
    )
    or (
      exists (select 1 from public.user_roles where profile_id = p_rider_id)
      and not exists (
        select 1 from public.user_roles
        where profile_id = p_rider_id and role::text = pr.role::text
      )
    ) then
    raise exception 'FORBIDDEN: Customer role, approval or account status is not eligible for cash payment.';
  end if;

  select count(*),max(coalesce(monime_account_id,metadata->>'monime_account_id'))
  into wallet_count,wallet_account
  from public.wallets
  where user_id = p_rider_id and currency = 'SLE';

  if wallet_count <> 1
    or wallet_account is distinct from p_payer_account
    or exists (
      select 1 from public.wallets
      where user_id = p_rider_id and currency = 'SLE'
        and coalesce(is_frozen,false)
    ) then
    raise exception 'ACCOUNT_CHANGED: The customer SLE wallet is not uniquely linked or is frozen.';
  end if;

  if b.fare_amount is null or b.fare_amount <= 0
    or b.fare_amount::numeric * 100 <> trunc(b.fare_amount::numeric * 100)
    or b.fare_amount::numeric > 10000000000 then
    raise exception 'INVALID_FARE: A valid SLE fare is required.';
  end if;

  fare := (b.fare_amount::numeric * 100)::bigint;
  -- Reuse the exact digital ride calculation: driver share is 85%,
  -- and the MatMove fee is the remainder (15%, rounded in minor units).
  fee := fare - round(fare::numeric * 85 / 100)::bigint;

  if fee <= 0 or fee >= fare then
    raise exception 'INVALID_FARE: The MatMove fee is outside the supported range.';
  end if;

  select * into payment
  from public.ride_cash_fee_payments
  where booking_id = b.id
  for update;

  if found then
    if payment.rider_id <> p_rider_id
      or payment.fare_minor <> fare
      or payment.fee_minor <> fee
      or payment.cash_due_minor <> fare
      or payment.vehicle_type <> b.vehicle_type
      or payment.payer_account <> p_payer_account
      or payment.fee_account <> p_fee_account then
      raise exception 'CONFLICT: Cash payment details changed. Contact MatMove support.';
    end if;
    if payment.state in ('failed','refunded','review_required') then
      raise exception 'CASH_PAYMENT_REVIEW: This cash payment requires cancellation or support review.';
    end if;
  else
    insert into public.ride_cash_fee_payments(
      booking_id,rider_id,fare_minor,fee_minor,cash_due_minor,
      vehicle_type,payer_account,fee_account,state
    )
    values(b.id,p_rider_id,fare,fee,fare,b.vehicle_type,p_payer_account,p_fee_account,'funding')
    returning * into payment;
  end if;

  select * into transfer
  from public.ride_cash_fee_transfers
  where booking_id = b.id and kind = 'fee'
  for update;

  if not found then
    insert into public.ride_cash_fee_transfers(
      booking_id,kind,amount_minor,source_account,destination_account
    )
    values(b.id,'fee',fee,p_payer_account,p_fee_account)
    returning * into transfer;
  end if;

  return to_jsonb(payment) || jsonb_build_object('transfer',to_jsonb(transfer));
end;
$function$;

create or replace function public.matmove_claim_cash_ride_transfer(
  p_booking_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  t public.ride_cash_fee_transfers%rowtype;
  can_create boolean := false;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: Trusted server required.';
  end if;
  if p_booking_id is null or p_kind not in ('fee','refund') then
    raise exception 'INVALID: Cash transfer request is invalid.';
  end if;

  perform 1
  from public.ride_cash_fee_payments
  where booking_id = p_booking_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: Cash payment record not found.';
  end if;

  select * into t
  from public.ride_cash_fee_transfers
  where booking_id = p_booking_id and kind = p_kind
  for update;

  if not found then
    raise exception 'NOT_FOUND: Cash transfer leg not found.';
  end if;

  if t.status in ('completed','failed','review_required') then
    return to_jsonb(t) || jsonb_build_object('can_create',false);
  end if;

  if t.provider_id is not null then
    return to_jsonb(t) || jsonb_build_object('can_create',false);
  end if;

  if t.status = 'ready' and t.attempted_at is null then
    can_create := true;
    update public.ride_cash_fee_transfers
    set status = 'pending',
        attempted_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where booking_id = p_booking_id and kind = p_kind
    returning * into t;
  elsif t.status = 'pending'
    and t.attempted_at < clock_timestamp() - interval '2 minutes' then
    update public.ride_cash_fee_transfers
    set status = 'review_required',
        error = 'Uncertain transfer attempt. Reconcile with Monime before retrying.',
        updated_at = clock_timestamp()
    where booking_id = p_booking_id and kind = p_kind
    returning * into t;

    update public.ride_cash_fee_payments
    set state = 'review_required',updated_at = clock_timestamp()
    where booking_id = p_booking_id;
  end if;

  return to_jsonb(t) || jsonb_build_object('can_create',can_create);
end;
$function$;

create or replace function public.matmove_record_cash_ride_transfer(
  p_booking_id uuid,
  p_kind text,
  p_provider_id text,
  p_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  t public.ride_cash_fee_transfers%rowtype;
  safe_error text := left(coalesce(p_error,''),500);
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: Trusted server required.';
  end if;

  if p_status not in ('pending','processing','completed','failed','review_required')
    or (p_status = 'completed' and (p_provider_id is null or length(p_provider_id) not between 1 and 160))
    or (p_provider_id is not null and length(p_provider_id) not between 1 and 160) then
    raise exception 'INVALID_STATE: Invalid provider receipt or transfer status.';
  end if;

  select * into t
  from public.ride_cash_fee_transfers
  where booking_id = p_booking_id and kind = p_kind
  for update;

  if not found then
    raise exception 'NOT_FOUND: Cash transfer leg not found.';
  end if;

  if t.provider_id is not null and p_provider_id is distinct from t.provider_id then
    raise exception 'ACCOUNT_CHANGED: Cash transfer ID changed.';
  end if;

  if t.status in ('completed','failed','review_required')
    or (t.status = 'processing' and p_status = 'pending') then
    return to_jsonb(t);
  end if;

  update public.ride_cash_fee_transfers
  set provider_id = coalesce(provider_id,p_provider_id),
      status = p_status,
      error = nullif(safe_error,''),
      updated_at = clock_timestamp()
  where booking_id = p_booking_id and kind = p_kind
  returning * into t;

  if p_kind = 'fee' then
    update public.ride_cash_fee_payments
    set state = case
      when p_status = 'completed' then 'paid'
      when p_status = 'failed' then 'failed'
      when p_status = 'review_required' then 'review_required'
      else 'funding'
    end,
    updated_at = clock_timestamp()
    where booking_id = p_booking_id;
  else
    update public.ride_cash_fee_payments
    set state = case
      when p_status = 'completed' then 'refunded'
      when p_status in ('failed','review_required') then 'review_required'
      else 'refunding'
    end,
    updated_at = clock_timestamp()
    where booking_id = p_booking_id;

    if p_status = 'completed' then
      update public.bookings
      set status = 'cancelled',updated_at = clock_timestamp()
      where id = p_booking_id and status in ('pending','pending_admin','accepted');
    end if;
  end if;

  return to_jsonb(t);
end;
$function$;

create or replace function public.matmove_prepare_cash_ride_action(
  p_booking_id uuid,
  p_actor_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  pr public.profiles%rowtype;
  payment public.ride_cash_fee_payments%rowtype;
  fee_transfer public.ride_cash_fee_transfers%rowtype;
  refund_transfer public.ride_cash_fee_transfers%rowtype;
  driver_status jsonb;
  is_rider boolean;
  is_driver boolean;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: Trusted server required.';
  end if;
  if p_booking_id is null or p_actor_id is null
    or p_action not in ('accept','start','complete','cancel') then
    raise exception 'INVALID: Cash trip action is invalid.';
  end if;

  select * into b from public.bookings
  where id = p_booking_id for update;

  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if b.payment_method <> 'cash' then
    raise exception 'INVALID_STATE: This booking does not use cash payment.';
  end if;

  select * into pr from public.profiles where id = p_actor_id;
  if not found then raise exception 'FORBIDDEN: Account profile not found.'; end if;

  is_rider := b.rider_id = p_actor_id;
  is_driver := b.driver_id = p_actor_id and pr.role::text = 'driver';

  select * into payment
  from public.ride_cash_fee_payments
  where booking_id = b.id
  for update;

  if p_action = 'accept' then
    if pr.role::text <> 'driver' or is_rider
      or (b.driver_id is not null and b.driver_id <> p_actor_id) then
      raise exception 'FORBIDDEN: Assigned driver account required.';
    end if;
    if b.status not in ('pending','pending_admin') then
      raise exception 'INVALID_STATE: This cash trip is no longer waiting for acceptance.';
    end if;
    if not found or payment.state <> 'paid' then
      raise exception 'PAYMENT_PENDING: MatMove fee must be verified before a driver can accept this cash trip.';
    end if;
    select * into fee_transfer from public.ride_cash_fee_transfers
    where booking_id = b.id and kind = 'fee';
    if not found or fee_transfer.status <> 'completed' or fee_transfer.provider_id is null then
      raise exception 'PAYMENT_PENDING: MatMove fee transfer receipt is not confirmed.';
    end if;

    driver_status := public.matmove_dispatch_driver_status(p_actor_id,b.id);
    if driver_status->>'eligible' is distinct from 'true' then
      raise exception 'FORBIDDEN: Driver is not eligible for this ride. %',driver_status->>'reason';
    end if;

    update public.bookings
    set driver_id = p_actor_id,status = 'accepted',
        accepted_at = coalesce(accepted_at,clock_timestamp()),
        updated_at = clock_timestamp()
    where id = b.id
    returning * into b;

  elsif p_action = 'start' then
    if not is_driver or b.driver_id is distinct from p_actor_id then
      raise exception 'FORBIDDEN: Assigned driver account required.';
    end if;
    if not found or payment.state <> 'paid' then
      raise exception 'PAYMENT_PENDING: MatMove fee is not confirmed.';
    end if;
    if b.status = 'in_progress' then
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',to_jsonb(payment),'applied',true);
    end if;
    if b.status <> 'accepted' then
      raise exception 'INVALID_STATE: The assigned cash ride must be accepted before it starts.';
    end if;
    if pr.kyc_status::text <> 'approved' or coalesce(pr.is_wallet_frozen,false)
      or exists(select 1 from public.wallets where user_id = p_actor_id and is_frozen) then
      raise exception 'FORBIDDEN: Driver approval and an unfrozen account are required.';
    end if;
    update public.bookings
    set status = 'in_progress',started_at = coalesce(started_at,clock_timestamp()),
        updated_at = clock_timestamp()
    where id = b.id
    returning * into b;

  elsif p_action = 'complete' then
    if not is_rider then
      raise exception 'FORBIDDEN: Only the customer who booked this cash ride can confirm arrival.';
    end if;
    if not found or payment.state <> 'paid' then
      raise exception 'PAYMENT_PENDING: MatMove fee is not confirmed.';
    end if;
    if b.status = 'completed' then
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',to_jsonb(payment),'applied',true);
    end if;
    if b.status <> 'in_progress' then
      raise exception 'INVALID_STATE: Only a started cash trip can be completed.';
    end if;
    update public.bookings
    set status = 'completed',completed_at = coalesce(completed_at,clock_timestamp()),
        updated_at = clock_timestamp()
    where id = b.id
    returning * into b;

  elsif p_action = 'cancel' then
    if not is_rider and not is_driver then
      raise exception 'FORBIDDEN: Only the rider or assigned driver can cancel this cash trip.';
    end if;
    if b.status not in ('pending','pending_admin','accepted') then
      raise exception 'INVALID_STATE: Only an unstarted cash trip can be cancelled.';
    end if;
    if b.status = 'accepted' and is_rider then
      raise exception 'INVALID_STATE: Rider cancellation after driver acceptance is unavailable until the agreed cancellation-fee policy is enabled.';
    end if;

    if not found then
      update public.bookings
      set status = 'cancelled',updated_at = clock_timestamp()
      where id = b.id returning * into b;
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',null,'refundRequired',false,'applied',true);
    end if;

    if payment.state = 'failed' or payment.state = 'refunded' then
      update public.bookings
      set status = 'cancelled',updated_at = clock_timestamp()
      where id = b.id returning * into b;
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',to_jsonb(payment),'refundRequired',false,'applied',true);
    end if;

    select * into fee_transfer from public.ride_cash_fee_transfers
    where booking_id = b.id and kind = 'fee'
    for update;

    if payment.state = 'funding'
      and found
      and fee_transfer.status = 'ready'
      and fee_transfer.attempted_at is null then
      update public.ride_cash_fee_transfers
      set status = 'failed',error = 'Cancelled before the fee transfer was attempted.',
          updated_at = clock_timestamp()
      where booking_id = b.id and kind = 'fee';
      update public.ride_cash_fee_payments
      set state = 'failed',updated_at = clock_timestamp()
      where booking_id = b.id;
      update public.bookings
      set status = 'cancelled',updated_at = clock_timestamp()
      where id = b.id returning * into b;
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',null,'refundRequired',false,'applied',true);
    end if;

    if payment.state = 'paid' then
      if not found or fee_transfer.status <> 'completed' then
        raise exception 'PAYMENT_PENDING: Fee receipt is not confirmed; check payment status before cancellation.';
      end if;
      select * into refund_transfer from public.ride_cash_fee_transfers
      where booking_id = b.id and kind = 'refund'
      for update;
      if not found then
        insert into public.ride_cash_fee_transfers(
          booking_id,kind,amount_minor,source_account,destination_account
        )
        values(b.id,'refund',payment.fee_minor,payment.fee_account,payment.payer_account)
        returning * into refund_transfer;
      end if;
      update public.ride_cash_fee_payments
      set state = 'refunding',updated_at = clock_timestamp()
      where booking_id = b.id
      returning * into payment;
      return jsonb_build_object(
        'booking',to_jsonb(b),'cashPayment',to_jsonb(payment),
        'refundRequired',true,'applied',true
      );
    end if;

    if payment.state = 'refunding' then
      return jsonb_build_object('booking',to_jsonb(b),'cashPayment',to_jsonb(payment),'refundRequired',true,'applied',true);
    end if;

    raise exception 'PAYMENT_PENDING: Cash fee payment requires reconciliation before this trip can be cancelled.';
  end if;

  return jsonb_build_object('booking',to_jsonb(b),'cashPayment',to_jsonb(payment),'applied',true);
end;
$function$;

-- Drivers cannot see or accept a cash request until the digital fee transfer is confirmed.
create or replace function public.matmove_driver_radar_visible(
  p_rider uuid,
  p_driver uuid,
  p_status text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  uid uuid := auth.uid();
  pr public.profiles%rowtype;
begin
  if uid is null then return false; end if;
  select * into pr from public.profiles where id = uid;

  if not found
    or pr.role::text is distinct from 'driver'
    or exists (
      select 1 from public.matmove_staff_access
      where id = uid and is_active = true and removed_at is null
    )
    or exists (
      select 1 from public.user_roles
      where profile_id = uid
        and (role is null or role::text not in ('rider','driver','merchant'))
    )
    or (
      exists(select 1 from public.user_roles where profile_id = uid)
      and not exists(select 1 from public.user_roles where profile_id = uid and role::text = 'driver')
    ) then
    return false;
  end if;

  if p_driver = uid then
    return not exists (
      select 1
      from public.bookings b
      where b.rider_id = p_rider
        and b.driver_id = uid
        and b.status = p_status
        and b.payment_method = 'cash'
        and not exists (
          select 1 from public.ride_cash_fee_payments cp
          where cp.booking_id = b.id and cp.state = 'paid'
        )
    );
  end if;

  return coalesce(
    p_driver is null
    and p_rider is not null
    and p_rider is distinct from uid
    and p_status in ('pending','pending_admin')
    and pr.kyc_status::text = 'approved'
    and not coalesce((to_jsonb(pr)->>'is_wallet_frozen')::boolean,false)
    and exists(select 1 from public.wallets where user_id = uid and currency = 'SLE')
    and not exists(select 1 from public.wallets where user_id = uid and is_frozen = true)
    and not public.matmove_dispatch_driver_busy(uid,null)
    and not exists (
      select 1
      from public.bookings b
      where b.rider_id = p_rider
        and b.driver_id is null
        and b.status = p_status
        and b.payment_method = 'cash'
        and not exists (
          select 1 from public.ride_cash_fee_payments cp
          where cp.booking_id = b.id and cp.state = 'paid'
        )
    ),
    false
  );
end;
$function$;

create or replace function public.matmove_admin_dispatch_change(
  p_booking_id uuid,
  p_expected bigint,
  p_action text,
  p_driver uuid,
  p_request_id uuid,
  p_note text,
  p_expected_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  prior jsonb;
  receipt public.matmove_dispatch_audit%rowtype;
  chosen uuid;
  driver_status jsonb;
  cash_state text;
begin
  actor := public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then
    raise exception 'FORBIDDEN: Your signed-in account changed.';
  end if;

  if p_booking_id is null or p_request_id is null or p_expected is null
    or p_action is null or p_action not in ('assign','unassign','cancel')
    or p_note is null or length(btrim(p_note)) not between 3 and 300
    or (p_action = 'assign' and p_driver is null)
    or (p_action <> 'assign' and p_driver is not null) then
    raise exception 'INVALID: Select a valid action and enter a dispatch note (3–300 characters).';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  perform public.matmove_dispatch_actor();

  select * into receipt from public.matmove_dispatch_audit where request_id = p_request_id;
  if found then
    if receipt.actor_id <> actor or receipt.booking_id <> b.id
      or receipt.action <> p_action or receipt.driver_id is distinct from p_driver
      or receipt.expected_version <> p_expected or receipt.note <> btrim(p_note) then
      raise exception 'CONFLICT: This request key was already used for another dispatch action.';
    end if;
    return jsonb_build_object('actor',actor,'applied',true,'requestId',receipt.request_id,'bookingId',b.id,'action',receipt.action,'version',receipt.new_version::text);
  end if;

  if b.matmove_dispatch_version is distinct from p_expected then
    raise exception 'CONFLICT: Booking changed. Refresh Dispatch before continuing.';
  end if;
  if b.status is null or b.status not in ('pending','pending_admin') then
    raise exception 'CONFLICT: Only pending requests can be changed here.';
  end if;
  if exists(select 1 from public.ride_payments where booking_id = b.id) then
    raise exception 'PAYMENT_STARTED: Payment processing has started. Use the customer cancellation/refund flow; Dispatch cannot cancel or reassign this request.';
  end if;

  select state into cash_state
  from public.ride_cash_fee_payments
  where booking_id = b.id;

  if cash_state in ('funding','refunding','review_required','refunded') then
    raise exception 'PAYMENT_STARTED: Cash fee is processing or requires review. Dispatch cannot reassign or cancel this request.';
  end if;
  if p_action = 'assign' and b.payment_method = 'cash' and cash_state is distinct from 'paid' then
    raise exception 'PAYMENT_PENDING: The rider MatMove fee must be confirmed before this cash ride can be assigned.';
  end if;
  if p_action = 'cancel' and b.payment_method = 'cash' and cash_state = 'paid' then
    raise exception 'CASH_REFUND_REQUIRED: Use the customer or assigned-driver cancellation flow so MatMove can verify the fee refund.';
  end if;

  prior := jsonb_build_object('driverId',b.driver_id,'status',b.status,'fare',b.fare_amount::text);
  select driver_id into chosen
  from public.matmove_ride_fare_offers
  where booking_id = b.id and status = 'accepted';

  if p_action = 'assign' then
    if b.rider_id is null or b.fare_amount is null or b.fare_amount <= 0
      or b.fare_amount * 100 <> round(b.fare_amount * 100) then
      raise exception 'INVALID: A valid customer and fare are required before assignment.';
    end if;
    if p_driver = b.rider_id then raise exception 'INVALID: A customer cannot drive their own request.'; end if;
    if b.driver_id is not null and b.driver_id is distinct from p_driver then
      raise exception 'CONFLICT: Unassign the existing driver first.';
    end if;
    if chosen is not null and chosen is distinct from p_driver then
      raise exception 'CONFLICT: The customer agreed a fare with another driver.';
    end if;
    if exists (
      select 1 from public.matmove_ride_fare_offers
      where booking_id = b.id and status = 'pending'
        and expires_at > now() and fare_version = b.matmove_fare_version
    ) then
      raise exception 'CONFLICT: Resolve the pending fare offers before manual assignment.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver::text,0));
    driver_status := public.matmove_dispatch_driver_status(p_driver,b.id);
    if driver_status->>'eligible' is distinct from 'true' then
      if driver_status->>'reasonCode' = 'busy' then
        raise exception 'CONFLICT: This driver already has an assigned active request or unresolved payment.';
      end if;
      raise exception 'FORBIDDEN: The driver needs current approval, consistent driver membership and an unfrozen SLE wallet. %',driver_status->>'reason';
    end if;

    update public.bookings
    set driver_id = p_driver,updated_at = clock_timestamp()
    where id = b.id returning * into b;

  elsif p_action = 'unassign' then
    if chosen is not null then
      raise exception 'CONFLICT: The agreed driver is locked. The customer can cancel and create a new request.';
    end if;
    update public.bookings
    set driver_id = null,updated_at = clock_timestamp()
    where id = b.id returning * into b;

  else
    update public.bookings
    set status = 'cancelled',updated_at = clock_timestamp()
    where id = b.id returning * into b;
  end if;

  insert into public.matmove_dispatch_audit(
    request_id,actor_id,booking_id,action,driver_id,expected_version,new_version,
    note,before_record,after_record
  )
  values(
    p_request_id,actor,b.id,p_action,p_driver,p_expected,b.matmove_dispatch_version,
    btrim(p_note),prior,
    jsonb_build_object('driverId',b.driver_id,'status',b.status,'fare',b.fare_amount::text)
  );

  return jsonb_build_object('actor',actor,'applied',true,'requestId',p_request_id,
    'bookingId',b.id,'action',p_action,'version',b.matmove_dispatch_version::text);
end;
$function$;

create or replace function public.matmove_admin_dispatch_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid;
  requests jsonb;
  drivers jsonb;
begin
  actor := public.matmove_dispatch_actor();

  select coalesce(jsonb_agg(x.row order by x.created_at desc,x.id),'[]'::jsonb)
  into requests
  from (
    select
      b.id,
      b.created_at,
      jsonb_build_object(
        'id',b.id,
        'version',b.matmove_dispatch_version::text,
        'status',b.status,
        'fare',b.fare_amount::text,
        'serviceType',b.service_type,
        'vehicleType',b.vehicle_type,
        'paymentMethod',b.payment_method,
        'cashFeeState',cp.state,
        'cashFeeMinor',cp.fee_minor,
        'cashDueMinor',cp.cash_due_minor,
        'cashFeeTransferId',ft.provider_id,
        'cashFeeTransferStatus',ft.status,
        'pickup',b.pickup_location,
        'destination',b.destination_location,
        'scheduledTime',b.scheduled_time,
        'createdAt',b.created_at,
        'riderId',b.rider_id,
        'driverId',b.driver_id,
        'riderLabel',coalesce(nullif(to_jsonb(r)->>'full_name',''),nullif(to_jsonb(r)->>'email',''),nullif(to_jsonb(r)->>'phone_number',''),nullif(to_jsonb(r)->>'phone',''),b.rider_id::text),
        'driverLabel',coalesce(nullif(to_jsonb(d)->>'full_name',''),nullif(to_jsonb(d)->>'email',''),nullif(to_jsonb(d)->>'phone_number',''),nullif(to_jsonb(d)->>'phone',''),b.driver_id::text),
        'paymentStarted',
          exists(select 1 from public.ride_payments where booking_id=b.id)
          or cp.state in ('funding','refunding','review_required','refunded'),
        'cashPaymentPaid',cp.state = 'paid',
        'pendingOffers',(select count(*)::text from public.matmove_ride_fare_offers where booking_id=b.id and status='pending' and expires_at>now() and fare_version=b.matmove_fare_version),
        'agreedDriverId',(select driver_id from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted')
      ) row
    from public.bookings b
    left join public.profiles r on r.id=b.rider_id
    left join public.profiles d on d.id=b.driver_id
    left join public.ride_cash_fee_payments cp on cp.booking_id=b.id
    left join public.ride_cash_fee_transfers ft on ft.booking_id=b.id and ft.kind='fee'
    order by b.created_at desc,b.id
    limit 2000
  ) x;

  select coalesce(jsonb_agg(x.details order by (x.details->>'eligible')::boolean desc,x.details->>'label',x.id),'[]'::jsonb)
  into drivers
  from (
    select p.id,public.matmove_dispatch_driver_status(p.id,null) details
    from public.profiles p
    where p.role::text='driver'
      or exists(select 1 from public.user_roles where profile_id=p.id and role::text='driver')
  ) x;

  return jsonb_build_object(
    'actor',actor,'bookings',requests,'drivers',drivers,
    'generatedAt',clock_timestamp(),'limit',2000
  );
end;
$function$;

create or replace function public.matmove_admin_trip_review(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  r public.profiles%rowtype;
  d public.profiles%rowtype;
  driver_gps jsonb;
  customer_gps jsonb;
  active_trip boolean;
  cash_payment jsonb;
begin
  actor := public.matmove_dispatch_actor();
  select * into b from public.bookings where id = p_booking;
  if not found then raise exception 'NOT_FOUND: Trip not found.'; end if;

  select * into r from public.profiles where id = b.rider_id;
  select * into d from public.profiles where id = b.driver_id;
  active_trip := b.driver_id is not null and b.status::text in ('accepted','in_progress');

  if active_trip then
    select jsonb_build_object(
      'lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,
      'observedAt',p.observed_at,'receivedAt',p.received_at
    ) into driver_gps
    from public.matmove_trip_positions p
    where p.booking_id=b.id and p.driver_id=b.driver_id
      and p.received_at > clock_timestamp()-interval '45 seconds'
      and p.observed_at > clock_timestamp()-interval '60 seconds';

    select jsonb_build_object(
      'lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,
      'observedAt',p.observed_at,'receivedAt',p.received_at
    ) into customer_gps
    from public.matmove_customer_trip_positions p
    where p.booking_id=b.id and p.customer_id=b.rider_id
      and p.received_at > clock_timestamp()-interval '45 seconds'
      and p.observed_at > clock_timestamp()-interval '60 seconds';
  end if;

  if b.payment_method = 'cash' then
    select jsonb_build_object(
      'state',cp.state,
      'fareMinor',cp.fare_minor,
      'feeMinor',cp.fee_minor,
      'cashDueMinor',cp.cash_due_minor,
      'feeTransferId',ft.provider_id,
      'feeTransferStatus',ft.status,
      'refundTransferId',rt.provider_id,
      'refundTransferStatus',rt.status
    ) into cash_payment
    from public.ride_cash_fee_payments cp
    left join public.ride_cash_fee_transfers ft
      on ft.booking_id=cp.booking_id and ft.kind='fee'
    left join public.ride_cash_fee_transfers rt
      on rt.booking_id=cp.booking_id and rt.kind='refund'
    where cp.booking_id=b.id;
  end if;

  return jsonb_build_object(
    'actor',actor,'bookingId',b.id,'status',b.status,'serverTime',clock_timestamp(),
    'pickup',b.pickup_location,'destination',b.destination_location,'fare',b.fare_amount::text,
    'serviceType',b.service_type,'vehicleType',b.vehicle_type,
    'paymentMethod',b.payment_method,'cashPayment',cash_payment,
    'passengerCount',coalesce(b.passenger_count::text,'1'),'passengerName',b.passenger_name,
    'createdAt',b.created_at,'scheduledAt',b.scheduled_time,
    'acceptedAt',b.accepted_at,'startedAt',b.started_at,'completedAt',b.completed_at,
    'rider',jsonb_build_object(
      'id',b.rider_id,'name',coalesce(nullif(to_jsonb(r)->>'full_name',''),to_jsonb(r)->>'email'),
      'email',to_jsonb(r)->>'email',
      'phone',coalesce(nullif(to_jsonb(r)->>'phone',''),to_jsonb(r)->>'phone_number')
    ),
    'driver',case when b.driver_id is null then null else jsonb_build_object(
      'id',b.driver_id,'name',coalesce(nullif(to_jsonb(d)->>'full_name',''),to_jsonb(d)->>'email'),
      'email',to_jsonb(d)->>'email',
      'phone',coalesce(nullif(to_jsonb(d)->>'phone',''),to_jsonb(d)->>'phone_number'),
      'vehicleType',to_jsonb(d)->>'vehicle_type','plate',to_jsonb(d)->>'plate_number'
    ) end,
    'pickupPin',case when b.matmove_pickup_lat is null then null else jsonb_build_object('lat',b.matmove_pickup_lat,'lng',b.matmove_pickup_lng) end,
    'destinationPin',case when b.matmove_destination_lat is null then null else jsonb_build_object('lat',b.matmove_destination_lat,'lng',b.matmove_destination_lng) end,
    'driverPosition',driver_gps,'customerPosition',customer_gps,'trackingActive',active_trip
  );
end;
$function$;

-- Extend eligibility for cash bookings without requiring a driver Monime account.
create or replace function public.matmove_dispatch_driver_status(p_driver uuid,p_booking uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  p public.profiles%rowtype;
  code text := 'ready';
  reason text := 'Ready for manual assignment';
begin
  select * into p from public.profiles where id=p_driver;
  if not found then code:='missing_profile';reason:='Driver profile is missing';
  elsif p.role::text is distinct from 'driver' then code:='wrong_role';reason:='Customer profile is not a driver';
  elsif exists(select 1 from public.matmove_staff_access where id=p_driver and is_active=true and removed_at is null)
    or exists(select 1 from public.user_roles where profile_id=p_driver and (role is null or role::text not in ('rider','driver','merchant')))
    or (exists(select 1 from public.user_roles where profile_id=p_driver) and not exists(select 1 from public.user_roles where profile_id=p_driver and role::text='driver'))
    then code:='role_conflict';reason:='Driver membership conflicts with this profile or active staff access';
  elsif p.kyc_status::text is distinct from 'approved' then code:='approval_required';reason:='Driver KYC needs current Admin approval';
  elsif coalesce((to_jsonb(p)->>'is_wallet_frozen')::boolean,false)
    or exists(select 1 from public.wallets where user_id=p_driver and is_frozen=true)
    then code:='wallet_frozen';reason:='Wallet is frozen; contact the authorized reviewer';
  elsif not exists(select 1 from public.wallets where user_id=p_driver and currency='SLE')
    then code:='wallet_missing';reason:='Driver needs an SLE wallet before assignment';
  elsif p_booking is not null and exists(
    select 1 from public.bookings b
    where b.id=p_booking and b.payment_method='cash'
      and not exists(select 1 from public.ride_cash_fee_payments cp where cp.booking_id=b.id and cp.state='paid')
  ) then code:='cash_fee_unpaid';reason:='Customer MatMove fee must be confirmed before cash assignment';
  elsif public.matmove_dispatch_driver_busy(p_driver,p_booking)
    then code:='busy';reason:='Driver already has an active assignment or unresolved payment';
  end if;

  return jsonb_build_object(
    'id',p_driver,
    'label',coalesce(nullif(to_jsonb(p)->>'full_name',''),nullif(to_jsonb(p)->>'email',''),p_driver::text),
    'eligible',code='ready','reasonCode',code,'reason',reason
  );
end;
$function$;

revoke all on function public.matmove_prepare_cash_ride_fee(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.matmove_claim_cash_ride_transfer(uuid,text) from public,anon,authenticated;
revoke all on function public.matmove_record_cash_ride_transfer(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.matmove_prepare_cash_ride_action(uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.matmove_prepare_cash_ride_fee(uuid,uuid,text,text) to service_role;
grant execute on function public.matmove_claim_cash_ride_transfer(uuid,text) to service_role;
grant execute on function public.matmove_record_cash_ride_transfer(uuid,text,text,text,text) to service_role;
grant execute on function public.matmove_prepare_cash_ride_action(uuid,uuid,text) to service_role;

-- Preserve existing RPC entry points while making the private service functions callable
-- by the signed-in Dispatch and Admin surfaces.
grant execute on function public.matmove_admin_dispatch_change(uuid,bigint,text,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.matmove_admin_dispatch_feed() to authenticated;
grant execute on function public.matmove_admin_trip_review(uuid) to authenticated;
grant execute on function public.matmove_driver_radar_visible(uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
