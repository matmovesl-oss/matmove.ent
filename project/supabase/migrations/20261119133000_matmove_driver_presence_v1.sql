begin;

create table if not exists public.matmove_driver_presence (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  vehicle_type text not null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matmove_driver_presence_latitude_chk check (latitude is null or latitude between -90 and 90),
  constraint matmove_driver_presence_longitude_chk check (longitude is null or longitude between -180 and 180),
  constraint matmove_driver_presence_accuracy_chk check (accuracy_m is null or accuracy_m between 0 and 150)
);

create index if not exists matmove_driver_presence_online_fresh_idx
  on public.matmove_driver_presence (is_online, last_seen_at desc)
  where is_online = true;

alter table public.matmove_driver_presence enable row level security;
revoke all on public.matmove_driver_presence from anon, authenticated;
grant select on public.matmove_driver_presence to authenticated;
drop policy if exists matmove_driver_presence_driver_read on public.matmove_driver_presence;
create policy matmove_driver_presence_driver_read on public.matmove_driver_presence
for select to authenticated using (driver_id = auth.uid());

create or replace function public.matmove_set_driver_presence(
  p_action text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_busy boolean;
begin
  if v_actor is null then raise exception 'AUTH: Sign in to manage driver availability.'; end if;
  if p_action not in ('online','heartbeat','offline') then raise exception 'INVALID: Unknown availability action.'; end if;
  select * into v_profile from public.profiles where id=v_actor for update;
  if not found or v_profile.role <> 'driver' then raise exception 'FORBIDDEN: Driver account required.'; end if;

  if p_action='offline' then
    update public.matmove_driver_presence set is_online=false,last_seen_at=now(),updated_at=now()
      where driver_id=v_actor;
    return jsonb_build_object('online',false,'serverTime',now());
  end if;

  if v_profile.kyc_status::text <> 'approved' or coalesce(v_profile.is_wallet_frozen,false) then
    raise exception 'FORBIDDEN: Approved, unfrozen driver account required.';
  end if;
  if p_latitude is null or p_longitude is null or p_accuracy_m is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or p_accuracy_m < 0 or p_accuracy_m > 150 then
    raise exception 'INVALID_LOCATION: A fresh GPS fix with accuracy of 150 metres or better is required.';
  end if;
  if not exists(select 1 from public.wallets w where w.user_id=v_actor and coalesce(w.is_frozen,false)=false) then
    raise exception 'FORBIDDEN: An active, unfrozen driver wallet is required.';
  end if;
  select exists(select 1 from public.bookings b where b.driver_id=v_actor and b.status in ('accepted','in_progress')) into v_busy;
  insert into public.matmove_driver_presence(driver_id,is_online,latitude,longitude,accuracy_m,vehicle_type,last_seen_at,updated_at)
  values(v_actor,not v_busy,p_latitude,p_longitude,p_accuracy_m,v_profile.vehicle_type,now(),now())
  on conflict(driver_id) do update set
    is_online=not v_busy,latitude=excluded.latitude,longitude=excluded.longitude,
    accuracy_m=excluded.accuracy_m,vehicle_type=excluded.vehicle_type,
    last_seen_at=now(),updated_at=now();
  return jsonb_build_object('online',not v_busy,'busy',v_busy,'serverTime',now());
end;
$fn$;
revoke all on function public.matmove_set_driver_presence(text,double precision,double precision,double precision) from public,anon;
grant execute on function public.matmove_set_driver_presence(text,double precision,double precision,double precision) to authenticated;

create or replace function public.matmove_driver_presence_snapshot()
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $fn$
declare v_actor uuid:=auth.uid(); v_row public.matmove_driver_presence%rowtype;
begin
 if v_actor is null then raise exception 'AUTH: Sign in to read driver availability.'; end if;
 select * into v_row from public.matmove_driver_presence where driver_id=v_actor;
 if not found then return jsonb_build_object('online',false,'fresh',false,'serverTime',now()); end if;
 return jsonb_build_object('online',v_row.is_online,'fresh',v_row.is_online and v_row.last_seen_at>now()-interval '45 seconds',
  'lastSeenAt',v_row.last_seen_at,'serverTime',now());
end;
$fn$;
revoke all on function public.matmove_driver_presence_snapshot() from public,anon;
grant execute on function public.matmove_driver_presence_snapshot() to authenticated;

commit;
