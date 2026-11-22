-- MatMove production lockdown: make booking identity/system timestamps server-owned.
-- The browser may create its own booking and update only the narrowly guarded
-- editable fields; it must never select or rewrite primary keys or timestamps.

create or replace function public.matmove_guard_booking_system_fields()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.id := gen_random_uuid();
      new.created_at := clock_timestamp();
      new.updated_at := new.created_at;
    elsif tg_op = 'UPDATE' then
      if new.id is distinct from old.id then
        raise exception 'FORBIDDEN: Booking ID is immutable.';
      end if;
      if new.created_at is distinct from old.created_at then
        raise exception 'FORBIDDEN: Booking creation time is immutable.';
      end if;
      new.updated_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists "00_matmove_booking_system_fields" on public.bookings;
create trigger "00_matmove_booking_system_fields"
before insert or update on public.bookings
for each row
execute function public.matmove_guard_booking_system_fields();

create or replace function public.matmove_guard_travel_booking_system_fields()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.id := gen_random_uuid();
      new.created_at := clock_timestamp();
    elsif tg_op = 'UPDATE' then
      if new.id is distinct from old.id then
        raise exception 'FORBIDDEN: Travel booking ID is immutable.';
      end if;
      if new.created_at is distinct from old.created_at then
        raise exception 'FORBIDDEN: Travel booking creation time is immutable.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists "00_matmove_travel_booking_system_fields" on public.travel_bookings;
create trigger "00_matmove_travel_booking_system_fields"
before insert or update on public.travel_bookings
for each row
execute function public.matmove_guard_travel_booking_system_fields();

revoke execute on function public.matmove_guard_booking_system_fields()
  from public, anon, authenticated;
revoke execute on function public.matmove_guard_travel_booking_system_fields()
  from public, anon, authenticated;
revoke execute on function public.matmove_guard_travel_booking_write_v1()
  from public, anon, authenticated;
