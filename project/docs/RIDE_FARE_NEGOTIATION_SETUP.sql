
-- MatMove fare negotiation: additive, no new Vercel API and no replacement of payment RPCs.
-- Run the COMPLETE file in the shared Supabase SQL Editor after PORTAL_HOME_SETUP.sql.
begin;

alter table public.bookings add column if not exists matmove_fare_version bigint not null default 1;
create table if not exists public.matmove_ride_fare_offers (
  id uuid primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  amount_minor bigint not null check(amount_minor between 1 and 100000000),
  base_fare_minor bigint not null,
  fare_version bigint not null,
  agreed_version bigint,
  status text not null default 'pending' check(status in ('pending','accepted','declined','withdrawn','superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '5 minutes'),
  decided_at timestamptz
);
create index if not exists matmove_ride_fare_offers_booking on public.matmove_ride_fare_offers(booking_id,created_at desc);
create unique index if not exists matmove_ride_fare_one_agreement on public.matmove_ride_fare_offers(booking_id) where status='accepted';
alter table public.matmove_ride_fare_offers enable row level security;
revoke all on public.matmove_ride_fare_offers from public,anon,authenticated;

create or replace function public.matmove_fare_actor(p_user_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_role text;
begin
  v_role:=public.matmove_preferences_role(p_user_id);
  if exists(select 1 from public.profiles where id=p_user_id and coalesce(is_wallet_frozen,false)) or exists(select 1 from public.wallets where user_id=p_user_id and coalesce(is_frozen,false)) then raise exception 'FORBIDDEN: Wallet is frozen. Contact support.'; end if;
  if v_role in ('driver','merchant') and not exists(select 1 from public.profiles where id=p_user_id and kyc_status::text='approved') then raise exception 'FORBIDDEN: Approval is required before negotiating fares.'; end if;
  return v_role;
end;
$fn$;

-- Used under a booking row lock; all offers expire according to database time.
create or replace function public.matmove_propose_ride_fare(p_user_id uuid,p_booking_id uuid,p_request_id uuid,p_amount_minor bigint,p_fare_version bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; o public.matmove_ride_fare_offers%rowtype; v_role text;
begin
  v_role:=public.matmove_fare_actor(p_user_id);
  if v_role<>'driver' then raise exception 'FORBIDDEN: Only drivers can propose a fare.'; end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
  if b.rider_id=p_user_id then raise exception 'FORBIDDEN: You cannot drive your own request.'; end if;
  if p_request_id is null or p_amount_minor is null or p_amount_minor not between 1 and 100000000 then raise exception 'INVALID_FARE: Enter a valid fare up to SLE 1,000,000.'; end if;
  select * into o from public.matmove_ride_fare_offers where id=p_request_id;
  if found then
    if o.driver_id<>p_user_id or o.booking_id<>p_booking_id or o.amount_minor<>p_amount_minor or o.fare_version is distinct from p_fare_version then raise exception 'CONFLICT: Request key was already used for a different offer.'; end if;
    return to_jsonb(o);
  end if;
  if b.status is null or b.status not in ('pending','pending_admin') or b.driver_id is not null or exists(select 1 from public.ride_payments where booking_id=b.id) then raise exception 'INVALID_STATE: This request can no longer be negotiated.'; end if;
  if b.service_type is null or b.service_type not in ('ride','delivery') then raise exception 'INVALID_STATE: Negotiation is available for ride and delivery requests.'; end if;
  if b.matmove_fare_version is distinct from p_fare_version then raise exception 'CONFLICT: Fare changed. Refresh the request first.'; end if;
  if exists(select 1 from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted') then raise exception 'INVALID_STATE: The customer has already chosen a driver and fare.'; end if;
  if (select count(*) from public.matmove_ride_fare_offers where booking_id=b.id)>=200 then raise exception 'LIMIT: This request has reached its offer limit.'; end if;
  if (select count(*) from public.matmove_ride_fare_offers where booking_id=b.id and driver_id=p_user_id)>=10 then raise exception 'LIMIT: Offer limit reached for this request.'; end if;
  if b.fare_amount is null or b.fare_amount<=0 or b.fare_amount*100<>round(b.fare_amount*100) then raise exception 'INVALID_FARE: Request fare needs correction.'; end if;
  update public.matmove_ride_fare_offers set status='superseded',decided_at=now() where booking_id=b.id and driver_id=p_user_id and status='pending';
  insert into public.matmove_ride_fare_offers(id,booking_id,driver_id,amount_minor,base_fare_minor,fare_version)
  values(p_request_id,b.id,p_user_id,p_amount_minor,(b.fare_amount*100)::bigint,b.matmove_fare_version) returning * into o;
  return to_jsonb(o);
end;
$fn$;

create or replace function public.matmove_decide_ride_fare(p_user_id uuid,p_offer_id uuid,p_decision text,p_fare_version bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; o public.matmove_ride_fare_offers%rowtype; v_booking uuid; v_role text;
begin
  v_role:=public.matmove_fare_actor(p_user_id);
  select booking_id into v_booking from public.matmove_ride_fare_offers where id=p_offer_id;
  if not found then raise exception 'NOT_FOUND: Offer not found.'; end if;
  select * into b from public.bookings where id=v_booking for update;
  if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
  select * into o from public.matmove_ride_fare_offers where id=p_offer_id for update;
  if p_decision is null or p_decision not in ('accept','decline','withdraw') then raise exception 'INVALID_STATE: Choose a valid offer action.'; end if;
  if p_decision='withdraw' then
    if o.driver_id<>p_user_id or v_role<>'driver' then raise exception 'FORBIDDEN: This is another driver''s offer.'; end if;
  elsif b.rider_id is distinct from p_user_id or v_role not in ('rider','merchant') then raise exception 'FORBIDDEN: Only the customer can decide this offer.';
  end if;
  if (o.status='accepted' and p_decision='accept') or (o.status='declined' and p_decision='decline') or (o.status='withdrawn' and p_decision='withdraw') then return to_jsonb(o); end if;
  if b.status is null or b.status not in ('pending','pending_admin') or b.driver_id is not null or exists(select 1 from public.ride_payments where booking_id=b.id) then raise exception 'INVALID_STATE: Payment or driver acceptance has already started.'; end if;
  if o.status<>'pending' or o.expires_at<=now() or o.fare_version<>b.matmove_fare_version or b.matmove_fare_version is distinct from p_fare_version then raise exception 'CONFLICT: Offer expired or changed. Refresh the request.'; end if;
  if p_decision='accept' then
    -- A driver may have been frozen or deactivated since making this offer.
    if not exists(select 1 from public.profiles p where p.id=o.driver_id and p.role::text='driver' and p.kyc_status::text='approved' and not coalesce(p.is_wallet_frozen,false)) or exists(select 1 from public.wallets where user_id=o.driver_id and coalesce(is_frozen,false)) then raise exception 'FORBIDDEN: This driver is no longer available.'; end if;
    if exists(select 1 from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted') then raise exception 'CONFLICT: Another offer is already accepted.'; end if;
    update public.bookings set fare_amount=o.amount_minor::numeric/100,updated_at=now() where id=b.id returning * into b;
    update public.matmove_ride_fare_offers set status='superseded',decided_at=now() where booking_id=b.id and status='pending' and id<>o.id;
    update public.matmove_ride_fare_offers set status='accepted',agreed_version=b.matmove_fare_version,decided_at=now() where id=o.id returning * into o;
  else
    update public.matmove_ride_fare_offers set status=case when p_decision='withdraw' then 'withdrawn' else 'declined' end,decided_at=now() where id=o.id returning * into o;
  end if;
  return to_jsonb(o);
end;
$fn$;

create or replace function public.matmove_read_ride_fares(p_user_id uuid,p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; v_role text; v_owner boolean; v_offers jsonb;
begin
  -- Reading does not require wallet approval; mutation RPCs enforce it separately.
  v_role:=public.matmove_preferences_role(p_user_id);
  select * into b from public.bookings where id=p_booking_id;
  if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
  v_owner:=b.rider_id is not distinct from p_user_id;
  if not v_owner and (v_role='driver' and (b.driver_id=p_user_id or (b.status in ('pending','pending_admin') and b.driver_id is null and exists(select 1 from public.profiles where id=p_user_id and kyc_status::text='approved')))) is not true then raise exception 'FORBIDDEN: Request access denied.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'driverId',o.driver_id,'driverName',coalesce(nullif(p.full_name,''),'Driver'),
    'amountMinor',o.amount_minor,'fareVersion',o.fare_version,'agreedVersion',o.agreed_version,
    'status',case when o.status='pending' and (o.expires_at<=now() or o.fare_version<>b.matmove_fare_version) then 'expired' else o.status end,
    'expiresAt',o.expires_at,'createdAt',o.created_at
  ) order by o.created_at desc,o.id),'[]'::jsonb) into v_offers
  from public.matmove_ride_fare_offers o join public.profiles p on p.id=o.driver_id
  where o.booking_id=b.id and (v_owner or o.driver_id=p_user_id)
    and (o.status in ('pending','accepted') or o.created_at>now()-interval '1 day');
  return jsonb_build_object('bookingId',b.id,'viewerId',p_user_id,'fareMinor',round(b.fare_amount*100),'fareVersion',b.matmove_fare_version,'bookingStatus',b.status,
    'paymentStarted',exists(select 1 from public.ride_payments where booking_id=b.id),
    'selectedDriverId',(select driver_id from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted'),
    'serverTime',now(),'offers',v_offers);
end;
$fn$;

-- Browser writes may create a request, but cannot rewrite an existing fare.
-- SECURITY INVOKER keeps the true database caller visible to this guard.
create or replace function public.matmove_guard_booking_fare()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $fn$
begin
  if jsonb_build_array(to_jsonb(new)->'rider_id',to_jsonb(new)->'pickup_location',to_jsonb(new)->'destination_location',to_jsonb(new)->'service_type',to_jsonb(new)->'vehicle_type',to_jsonb(new)->'scheduled_time') is distinct from jsonb_build_array(to_jsonb(old)->'rider_id',to_jsonb(old)->'pickup_location',to_jsonb(old)->'destination_location',to_jsonb(old)->'service_type',to_jsonb(old)->'vehicle_type',to_jsonb(old)->'scheduled_time') then
    if exists(select 1 from public.matmove_ride_fare_offers where booking_id=old.id) then
      raise exception 'INVALID_STATE: Request details are locked while fare offers exist. Cancel and create a new request to change the route.';
    end if;
  end if;
  if new.fare_amount is distinct from old.fare_amount then
    if current_user in ('authenticated','anon') then raise exception 'FORBIDDEN: Use the customer offer-confirmation function to change a fare.'; end if;
    if exists(select 1 from public.ride_payments where booking_id=old.id) then raise exception 'INVALID_STATE: Payment has started. The fare is locked.'; end if;
    new.matmove_fare_version:=old.matmove_fare_version+1;
  else new.matmove_fare_version:=old.matmove_fare_version;
  end if;
  -- The trusted payment function assigns the driver; browser assignment is denied.
  if new.driver_id is distinct from old.driver_id and current_user in ('authenticated','anon') then raise exception 'FORBIDDEN: Accept the request through the payment API.'; end if;
  return new;
end;
$fn$;
drop trigger if exists matmove_guard_booking_fare on public.bookings;
create trigger matmove_guard_booking_fare before update on public.bookings for each row execute function public.matmove_guard_booking_fare();

create or replace function public.matmove_guard_ride_payment_fare()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; o public.matmove_ride_fare_offers%rowtype;
begin
  select * into b from public.bookings where id=new.booking_id for update;
  if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
  if b.rider_id is null or new.driver_id is null or new.payer_id is distinct from b.rider_id or new.fare_minor::numeric is distinct from b.fare_amount*100 then raise exception 'INVALID_FARE: Payment does not match the customer''s current fare.'; end if;
  if b.driver_id is not null and b.driver_id is distinct from new.driver_id then raise exception 'FORBIDDEN: Request has another driver.'; end if;
  select * into o from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted';
  if found then
    if o.driver_id is distinct from new.driver_id or o.amount_minor is distinct from new.fare_minor or o.agreed_version is distinct from b.matmove_fare_version then raise exception 'INVALID_FARE: Only the chosen driver may accept the agreed fare.'; end if;
  elsif exists(select 1 from public.matmove_ride_fare_offers where booking_id=b.id and driver_id=new.driver_id and status='pending' and expires_at>now() and fare_version=b.matmove_fare_version) then
    raise exception 'INVALID_STATE: Withdraw your offer before accepting the original fare, or wait for customer confirmation.';
  end if;
  return new;
end;
$fn$;
drop trigger if exists matmove_guard_ride_payment_fare on public.ride_payments;
create trigger matmove_guard_ride_payment_fare before insert on public.ride_payments for each row execute function public.matmove_guard_ride_payment_fare();

revoke all on function public.matmove_fare_actor(uuid) from public,anon,authenticated;
revoke all on function public.matmove_guard_booking_fare() from public,anon,authenticated;
revoke all on function public.matmove_guard_ride_payment_fare() from public,anon,authenticated;
revoke all on function public.matmove_propose_ride_fare(uuid,uuid,uuid,bigint,bigint) from public,anon;
revoke all on function public.matmove_decide_ride_fare(uuid,uuid,text,bigint) from public,anon;
revoke all on function public.matmove_read_ride_fares(uuid,uuid) from public,anon;
grant execute on function public.matmove_propose_ride_fare(uuid,uuid,uuid,bigint,bigint) to authenticated;
grant execute on function public.matmove_decide_ride_fare(uuid,uuid,text,bigint) to authenticated;
grant execute on function public.matmove_read_ride_fares(uuid,uuid) to authenticated;
-- Existing money RPCs remain server-only, including any legacy overloads.
do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('prepare_ride_payment','claim_ride_transfer','record_ride_transfer','finalize_ride_payment') loop
    execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end;
$permissions$;
-- Payment rows are written by trusted server RPCs, never by a browser.
revoke insert,update,delete on public.ride_payments from anon,authenticated;
notify pgrst,'reload schema';
commit;
