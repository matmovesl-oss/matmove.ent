-- MatMove Travel + Events sync setup
-- Run this in the Supabase SQL Editor for the SAME project used by both apps.
-- Review the existing RLS policies before changing them. This migration deliberately
-- avoids broad client write grants and does not expose the travel passenger manifest.

begin;

create table if not exists public.travel_settings (
  id text primary key,
  total_seats integer not null default 50 check (total_seats > 0),
  price_usd numeric(12,2) not null default 100 check (price_usd >= 0),
  price_sle numeric(12,2) not null default 2400 check (price_sle >= 0),
  updated_at timestamptz not null default now()
);

insert into public.travel_settings (id, total_seats, price_usd, price_sle, updated_at)
values ('bus_ghana', 50, 100, 2400, now())
on conflict (id) do nothing;

-- Secure aggregate availability endpoint. Customers receive only prices and seat counts,
-- not other passengers' names, phone numbers, addresses or emergency contacts.
create or replace function public.matmove_get_travel_availability()
returns table (
  total_seats integer,
  price_usd numeric,
  price_sle numeric,
  held_seats bigint,
  available_seats bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    settings.total_seats,
    settings.price_usd,
    settings.price_sle,
    coalesce(holds.held_seats, 0)::bigint,
    greatest(settings.total_seats::bigint - coalesce(holds.held_seats, 0)::bigint, 0)::bigint
  from public.travel_settings as settings
  cross join lateral (
    select coalesce(sum(greatest(coalesce(bookings.passengers_count, 1), 1)), 0)::bigint as held_seats
    from public.travel_bookings as bookings
    where coalesce(bookings.is_paid, false)
       or bookings.status in ('pending_approval', 'approved', 'boarded')
  ) as holds
  where settings.id = 'bus_ghana';
$$;

revoke all on function public.matmove_get_travel_availability() from public, anon;
grant execute on function public.matmove_get_travel_availability() to authenticated;

-- Capacity and price are enforced by the database, not trusted from browser form values.
-- The settings row lock serializes seat-creating transactions so simultaneous requests
-- cannot all reserve the same final seat. Fare is snapshotted at INSERT and stays unchanged.
create or replace function public.matmove_guard_travel_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured_capacity integer;
  configured_price_sle numeric(12,2);
  already_held bigint := 0;
  requested_seats integer;
  is_holding boolean;
begin
  if tg_op = 'UPDATE' then
    -- Never allow a client-side update to rewrite the fare of an existing reservation.
    new.fare_amount := old.fare_amount;
    if new.passengers_count is not distinct from old.passengers_count
       and new.status is not distinct from old.status
       and new.is_paid is not distinct from old.is_paid then
      return new;
    end if;
  end if;

  is_holding := coalesce(new.is_paid, false)
    or new.status in ('pending_approval', 'approved', 'boarded');
  if not is_holding then
    return new;
  end if;

  requested_seats := greatest(coalesce(new.passengers_count, 1), 1);
  if requested_seats > 3 then
    raise exception 'A single MatMove travel booking is limited to 3 passengers.' using errcode = 'P0001';
  end if;

  select total_seats, price_sle
    into configured_capacity, configured_price_sle
  from public.travel_settings
  where id = 'bus_ghana'
  for update;

  if not found then
    raise exception 'MatMove bus capacity and fare have not been configured.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    select coalesce(sum(greatest(coalesce(passengers_count, 1), 1)), 0)::bigint
      into already_held
    from public.travel_bookings
    where coalesce(is_paid, false)
       or status in ('pending_approval', 'approved', 'boarded');
    new.fare_amount := configured_price_sle * requested_seats;
  else
    select coalesce(sum(greatest(coalesce(passengers_count, 1), 1)), 0)::bigint
      into already_held
    from public.travel_bookings
    where id <> new.id
      and (coalesce(is_paid, false) or status in ('pending_approval', 'approved', 'boarded'));
  end if;

  if already_held + requested_seats > configured_capacity then
    raise exception 'Not enough seats remain on this departure. Refresh availability and try again.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists matmove_guard_travel_booking on public.travel_bookings;
create trigger matmove_guard_travel_booking
before insert or update on public.travel_bookings
for each row execute function public.matmove_guard_travel_booking();

-- Prevent a capacity edit from reducing the bus below reservations already held.
create or replace function public.matmove_guard_travel_capacity_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  already_held bigint := 0;
begin
  if new.total_seats < old.total_seats then
    select coalesce(sum(greatest(coalesce(passengers_count, 1), 1)), 0)::bigint
      into already_held
    from public.travel_bookings
    where coalesce(is_paid, false)
       or status in ('pending_approval', 'approved', 'boarded');
    if new.total_seats < already_held then
      raise exception 'Capacity cannot be reduced below the current number of reserved or pending seats.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists matmove_guard_travel_capacity_change on public.travel_settings;
create trigger matmove_guard_travel_capacity_change
before update of total_seats on public.travel_settings
for each row execute function public.matmove_guard_travel_capacity_change();

-- Public, read-only flyers are intended for display to customers. Upload permission remains
-- governed by your existing Storage RLS policy for authorized admin/staff sessions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-flyers', 'event-flyers', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Realtime makes updates to seat capacity, fares, bookings, events and tickets visible without reload.
do $$
declare
  target_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target_table in array array['travel_settings','travel_bookings','platform_events','event_tickets'] loop
      if to_regclass('public.' || target_table) is not null
         and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = target_table
         ) then
        execute format('alter publication supabase_realtime add table public.%I', target_table);
      end if;
    end loop;
  end if;
end $$;

commit;

-- Verification
select * from public.travel_settings where id = 'bus_ghana';
select * from public.matmove_get_travel_availability();
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'event-flyers';
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('travel_settings','travel_bookings','platform_events','event_tickets')
order by tablename;

-- Required existing-policy checks (do not add open policies):
-- 1. travel_settings: admins may UPDATE; authenticated customers/admins may SELECT if needed.
--    Customer portal now reads pricing/capacity through matmove_get_travel_availability().
-- 2. travel_bookings: customers may INSERT and read/update only their own row; admin staff retain
--    the scoped manifest/approval permissions. The trigger enforces server-side fare and capacity.
-- 3. event-flyers: public SELECT; only authorized staff may INSERT/DELETE.
-- 4. platform_events: customers may SELECT active public events; staff may manage events.
-- 5. event_tickets: customers may create/read only their own tickets; staff may audit/check-in.
-- 6. Keep payment provider secrets on the server; never expose service-role or Monime secrets
--    through a VITE_ environment variable.
