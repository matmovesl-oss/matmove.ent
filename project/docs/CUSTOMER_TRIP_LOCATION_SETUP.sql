-- Optional customer GPS sharing. Existing driver GPS and money flows are unchanged.
begin;
create table if not exists public.matmove_customer_trip_positions(
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 customer_id uuid not null references auth.users(id),latitude double precision not null,longitude double precision not null,accuracy double precision not null,observed_at timestamptz not null,received_at timestamptz not null default clock_timestamp()
);
create table if not exists public.matmove_customer_trip_sharing(
 booking_id uuid primary key references public.bookings(id) on delete cascade,
 customer_id uuid not null references auth.users(id),share_key uuid not null,enabled boolean not null default false
);
alter table public.matmove_customer_trip_positions enable row level security;
alter table public.matmove_customer_trip_sharing enable row level security;
revoke all on public.matmove_customer_trip_positions,public.matmove_customer_trip_sharing from public,anon,authenticated,service_role;
create or replace function public.matmove_customer_trip_location(p_booking uuid,p_action text default 'read',p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_observed timestamptz default null,p_share uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare uid uuid:=auth.uid();b public.bookings%rowtype;p public.matmove_customer_trip_positions%rowtype;fresh boolean:=false;role_name text;lease public.matmove_customer_trip_sharing%rowtype;
begin
 if uid is null then raise exception 'AUTH: Sign in to continue.';end if;
 role_name:=public.matmove_preferences_role(uid);
 if exists(select 1 from public.matmove_staff_access where id=uid and is_active=true and removed_at is null) then raise exception 'FORBIDDEN: Trip participants only.';end if;
 if p_action is null or p_action not in ('read','start','publish','clear') then raise exception 'INVALID: Unsupported location action.';end if;
 if p_action<>'publish' and (p_lat is not null or p_lng is not null or p_accuracy is not null or p_observed is not null) then raise exception 'INVALID: Read and clear do not accept coordinates.';end if;
 select * into b from public.bookings where id=p_booking for update;
 if not found then raise exception 'NOT_FOUND: Trip not found.';end if;
 if p_action='read' and p_share is not null then raise exception 'INVALID: Read does not accept a sharing key.';end if;
 if p_action='clear' then
  if uid is distinct from b.rider_id and not exists(select 1 from public.matmove_customer_trip_sharing where booking_id=b.id and customer_id=uid) then raise exception 'FORBIDDEN: Only the sharing customer can clear GPS.';end if;
  if p_share is null then raise exception 'INVALID: A sharing session is required.';end if;
  update public.matmove_customer_trip_sharing set enabled=false where booking_id=b.id and customer_id=uid and share_key=p_share;
  if found then delete from public.matmove_customer_trip_positions where booking_id=b.id and customer_id=uid;end if;
  return jsonb_build_object('bookingId',b.id,'viewerId',uid,'cleared',true);
 end if;
 if b.driver_id is null or coalesce(b.status,'') not in ('accepted','in_progress') or (uid is distinct from b.rider_id and uid is distinct from b.driver_id)
 then raise exception 'FORBIDDEN: Location is private to the assigned active trip.';end if;
 if p_action in ('start','publish') then
  if uid is distinct from b.rider_id or role_name not in ('rider','merchant') then raise exception 'FORBIDDEN: Only the trip customer can share GPS.';end if;
  if not exists(select 1 from public.profiles where id=uid and kyc_status::text='approved' and not coalesce(is_wallet_frozen,false))
  or exists(select 1 from public.wallets where user_id=uid and is_frozen=true) then raise exception 'FORBIDDEN: Customer verification and unfrozen access are required.';end if;
  if p_action='start' then
   if p_share is not null then raise exception 'INVALID: A sharing session is created by the server.';end if;
   insert into public.matmove_customer_trip_sharing(booking_id,customer_id,share_key,enabled) values(b.id,uid,gen_random_uuid(),true)
   on conflict(booking_id) do update set customer_id=excluded.customer_id,share_key=excluded.share_key,enabled=true returning * into lease;
   delete from public.matmove_customer_trip_positions where booking_id=b.id;
  else
  select * into lease from public.matmove_customer_trip_sharing where booking_id=b.id and customer_id=uid and share_key=p_share and enabled=true;
  if not found then raise exception 'FORBIDDEN: Location sharing stopped or this sharing session expired.';end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_observed is null or not(p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy between 0 and 150)
   or p_observed<clock_timestamp()-interval '60 seconds' or p_observed>clock_timestamp()+interval '15 seconds' then raise exception 'INVALID: A recent, accurate GPS reading is required.';end if;
  insert into public.matmove_customer_trip_positions(booking_id,customer_id,latitude,longitude,accuracy,observed_at,received_at)
  values(b.id,uid,p_lat,p_lng,p_accuracy,p_observed,clock_timestamp())
  on conflict(booking_id) do update set customer_id=excluded.customer_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,observed_at=excluded.observed_at,received_at=excluded.received_at
  where public.matmove_customer_trip_positions.customer_id is distinct from excluded.customer_id or excluded.observed_at>public.matmove_customer_trip_positions.observed_at;
  end if;
 end if;
 select * into p from public.matmove_customer_trip_positions where booking_id=b.id and customer_id=b.rider_id;
 fresh:=p.received_at>clock_timestamp()-interval '45 seconds' and p.observed_at>clock_timestamp()-interval '60 seconds';
 return jsonb_build_object('bookingId',b.id,'viewerId',uid,'riderId',b.rider_id,'driverId',b.driver_id,'status',b.status,
  'pickup',case when b.matmove_pickup_lat is null then null else jsonb_build_object('lat',b.matmove_pickup_lat,'lng',b.matmove_pickup_lng) end,
  'destination',case when b.matmove_destination_lat is null then null else jsonb_build_object('lat',b.matmove_destination_lat,'lng',b.matmove_destination_lng) end,
  'position',case when fresh then jsonb_build_object('lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,'observedAt',p.observed_at,'receivedAt',p.received_at) else null end,
  'locationState',case when fresh then 'fresh' when p.booking_id is null then 'waiting' else 'stale' end,'serverTime',clock_timestamp()) || case when p_action='start' then jsonb_build_object('shareKey',lease.share_key) else '{}'::jsonb end;
end;
$fn$;

create or replace function public.matmove_clear_customer_trip_position()
returns trigger language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if new.status::text not in ('accepted','in_progress') or new.driver_id is distinct from old.driver_id or new.rider_id is distinct from old.rider_id then
  delete from public.matmove_customer_trip_positions where booking_id=new.id;
  delete from public.matmove_customer_trip_sharing where booking_id=new.id;
 end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_clear_customer_trip_position on public.bookings;
create trigger matmove_clear_customer_trip_position after update of status,driver_id,rider_id on public.bookings for each row execute function public.matmove_clear_customer_trip_position();
revoke all on function public.matmove_clear_customer_trip_position() from public,anon,authenticated,service_role;
revoke all on function public.matmove_customer_trip_location(uuid,text,double precision,double precision,double precision,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.matmove_customer_trip_location(uuid,text,double precision,double precision,double precision,timestamptz,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
select to_regprocedure('public.matmove_customer_trip_location(uuid,text,double precision,double precision,double precision,timestamptz,uuid)') is not null as customer_tracking_ready;
