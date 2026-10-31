-- Additive trip history and passenger details; no money or status changes.
begin;
create or replace function public.matmove_driver_radar_visible(p_rider uuid,p_driver uuid,p_status text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare uid uuid:=auth.uid();p public.profiles%rowtype;
begin
 if uid is null then return false;end if;
 select * into p from public.profiles where id=uid;
 if not found or p.role::text is distinct from 'driver'
 or exists(select 1 from public.matmove_staff_access where id=uid and is_active=true and removed_at is null)
 or exists(select 1 from public.user_roles where profile_id=uid and (role is null or role::text not in ('rider','driver','merchant')))
 or (exists(select 1 from public.user_roles where profile_id=uid) and not exists(select 1 from public.user_roles where profile_id=uid and role::text='driver')) then return false;end if;
 -- A driver may still inspect their own assigned trip if approval is revoked;
 -- existing mutation/payment RPCs remain responsible for current authorization.
 if p_driver=uid then return true;end if;
 return coalesce(p_driver is null and p_rider is not null and p_rider is distinct from uid and p_status in ('pending','pending_admin')
  and p.kyc_status::text='approved' and not coalesce((to_jsonb(p)->>'is_wallet_frozen')::boolean,false)
  and exists(select 1 from public.wallets where user_id=uid and currency='SLE')
  and not exists(select 1 from public.wallets where user_id=uid and is_frozen=true)
  and not public.matmove_dispatch_driver_busy(uid,null),false);
end;
$fn$;
revoke all on function public.matmove_driver_radar_visible(uuid,uuid,text) from public,anon;
grant execute on function public.matmove_driver_radar_visible(uuid,uuid,text) to authenticated;


alter table public.bookings add column if not exists passenger_count integer not null default 1;
alter table public.bookings add column if not exists passenger_name text;
do $capacity$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass and conname='matmove_passenger_count_check') then
  alter table public.bookings add constraint matmove_passenger_count_check check(passenger_count between 1 and 3);
 end if;
end $capacity$;
create or replace function public.matmove_guard_passengers()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin
 if new.passenger_name is not null and (length(btrim(new.passenger_name))>120 or length(btrim(new.passenger_name))<2) then raise exception 'INVALID: Passenger name must contain 2 to 120 characters.';end if;
 if tg_op='UPDATE' and (new.passenger_count is distinct from old.passenger_count or new.passenger_name is distinct from old.passenger_name) and old.status::text not in ('pending','pending_admin') then raise exception 'LOCKED: Passenger details cannot change after acceptance.';end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_guard_passengers on public.bookings;
create trigger matmove_guard_passengers before insert or update on public.bookings for each row execute function public.matmove_guard_passengers();
revoke all on function public.matmove_guard_passengers() from public,anon,authenticated,service_role;
create table if not exists public.matmove_customer_trip_requests(
 id uuid primary key,customer_id uuid not null references auth.users(id),details jsonb not null,
 booking_id uuid not null unique references public.bookings(id),created_at timestamptz not null default now()
);
alter table public.matmove_customer_trip_requests enable row level security;
revoke all on public.matmove_customer_trip_requests from public,anon,authenticated,service_role;
create or replace function public.matmove_create_customer_trip(p_request uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare u uuid:=auth.uid();role_name text;prior public.matmove_customer_trip_requests%rowtype;b public.bookings%rowtype;seats integer;fare numeric;service text;vehicle text;scheduled timestamptz;passenger text;
begin
 if u is null then raise exception 'AUTH: Sign in to request a trip.';end if;
 role_name:=public.matmove_preferences_role(u);
 if role_name is null or role_name not in ('rider','merchant') or exists(select 1 from public.matmove_staff_access where id=u and is_active and removed_at is null) then raise exception 'FORBIDDEN: Customer booking access required.';end if;
 if p_request is null or p_details is null or jsonb_typeof(p_details)<>'object' or (select count(*) from jsonb_object_keys(p_details))<>11
 or exists(select 1 from jsonb_object_keys(p_details) k where k not in ('service_type','vehicle_type','pickup_location','destination_location','fare_amount','scheduled_time','passenger_count','passenger_name','pickup_pin','destination_pin','client_version'))
 or p_details->>'client_version' is distinct from '1' then raise exception 'INVALID: Review the complete trip details.';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,87192819));
 select * into prior from public.matmove_customer_trip_requests where id=p_request;
 if found then
  if prior.customer_id<>u or prior.details<>p_details then raise exception 'CONFLICT: Original request details do not match.';end if;
  select * into b from public.bookings where id=prior.booking_id and rider_id=u;
  if not found then raise exception 'CONFLICT: Original request needs support review.';end if;
  return to_jsonb(b);
 end if;
 if exists(select 1 from public.bookings where rider_id=u and status::text in ('pending','pending_admin')) then raise exception 'CONFLICT: Resolve your pending request before creating another.';end if;
 service:=p_details->>'service_type';vehicle:=p_details->>'vehicle_type';
 if service not in ('ride','delivery','scheduled') or service is null or vehicle not in ('car','bike','keke','van') or vehicle is null then raise exception 'INVALID: Choose a service and vehicle.';end if;
 if coalesce(p_details->>'fare_amount','') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then raise exception 'INVALID: Review the fare.';end if;
 fare:=(p_details->>'fare_amount')::numeric;if fare<=0 or fare>1000000 then raise exception 'INVALID: Review the fare.';end if;
 if coalesce(p_details->>'passenger_count','') !~ '^[1-3]$' then raise exception 'INVALID: Choose one to three passengers.';end if;seats:=(p_details->>'passenger_count')::integer;
 passenger:=nullif(btrim(p_details->>'passenger_name'),'');
 if passenger is not null and length(passenger) not between 2 and 120 then raise exception 'INVALID: Check the passenger name.';end if;
 if nullif(btrim(p_details->>'pickup_location'),'') is null or length(p_details->>'pickup_location')>1000 or nullif(btrim(p_details->>'destination_location'),'') is null or length(p_details->>'destination_location')>1000 then raise exception 'INVALID: Confirm both addresses.';end if;
 if jsonb_typeof(p_details->'pickup_pin') is distinct from 'object' or jsonb_typeof(p_details->'destination_pin') is distinct from 'object' then raise exception 'INVALID: Confirm both map pins.';end if;
 if not (((p_details#>>'{pickup_pin,lat}')::float8 between -90 and 90) and ((p_details#>>'{pickup_pin,lng}')::float8 between -180 and 180) and ((p_details#>>'{destination_pin,lat}')::float8 between -90 and 90) and ((p_details#>>'{destination_pin,lng}')::float8 between -180 and 180))
 or p_details#>>'{pickup_pin,lat}' is null or p_details#>>'{pickup_pin,lng}' is null or p_details#>>'{destination_pin,lat}' is null or p_details#>>'{destination_pin,lng}' is null then raise exception 'INVALID: Confirm valid map pins.';end if;
 scheduled:=nullif(p_details->>'scheduled_time','')::timestamptz;
 if service='scheduled' and (scheduled is null or scheduled<=clock_timestamp()) then raise exception 'INVALID: Select a future scheduled time.';end if;
 if service<>'scheduled' and scheduled is not null then raise exception 'INVALID: Only scheduled trips accept a schedule.';end if;
 b:=jsonb_populate_record(null::public.bookings,jsonb_build_object('id',p_request,'rider_id',u,'service_type',service,'vehicle_type',vehicle,'pickup_location',btrim(p_details->>'pickup_location'),'destination_location',btrim(p_details->>'destination_location'),'fare_amount',fare,'scheduled_time',scheduled,'status',case when role_name='merchant' or service='scheduled' then 'pending_admin' else 'pending' end,'passenger_count',seats,'passenger_name',passenger,'matmove_pickup_lat',(p_details#>>'{pickup_pin,lat}')::float8,'matmove_pickup_lng',(p_details#>>'{pickup_pin,lng}')::float8,'matmove_destination_lat',(p_details#>>'{destination_pin,lat}')::float8,'matmove_destination_lng',(p_details#>>'{destination_pin,lng}')::float8));
 insert into public.bookings(id,rider_id,service_type,vehicle_type,pickup_location,destination_location,fare_amount,scheduled_time,status,passenger_count,passenger_name,matmove_pickup_lat,matmove_pickup_lng,matmove_destination_lat,matmove_destination_lng)
 values(b.id,b.rider_id,b.service_type,b.vehicle_type,b.pickup_location,b.destination_location,b.fare_amount,b.scheduled_time,b.status,b.passenger_count,b.passenger_name,b.matmove_pickup_lat,b.matmove_pickup_lng,b.matmove_destination_lat,b.matmove_destination_lng) returning * into b;
 insert into public.matmove_customer_trip_requests(id,customer_id,details,booking_id) values(p_request,u,p_details,b.id);
 return to_jsonb(b);
end;
$fn$;
revoke all on function public.matmove_create_customer_trip(uuid,jsonb) from public,anon,service_role;
grant execute on function public.matmove_create_customer_trip(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
select to_regprocedure('public.matmove_driver_radar_visible(uuid,uuid,text)') is not null as driver_history_rule_ready,
 exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass and conname='matmove_passenger_count_check') as three_passenger_limit_ready;
