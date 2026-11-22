
drop trigger if exists z_matmove_travel_bookings_capacity_guard
on public.travel_bookings;

create or replace function public.matmove_guard_travel_booking()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  configured_capacity integer;
  configured_price_sle numeric(12,2);
  already_held bigint := 0;
  requested_seats integer;
  is_holding boolean;
begin
  if tg_op = 'UPDATE' then
    new.fare_amount := old.fare_amount;
    if new.passengers_count is not distinct from old.passengers_count
       and new.status is not distinct from old.status
       and new.is_paid is not distinct from old.is_paid then
      return new;
    end if;
  end if;

  is_holding := coalesce(new.is_paid, false)
    or new.status in ('pending_approval', 'approved', 'boarded', 'cancel_requested');

  if not is_holding then
    return new;
  end if;

  requested_seats := greatest(coalesce(new.passengers_count, 1), 1);
  if requested_seats > 3 then
    raise exception 'A single booking is limited to a maximum of 3 passengers.'
      using errcode = 'P0001';
  end if;

  select total_seats, price_sle
    into configured_capacity, configured_price_sle
  from public.travel_settings
  where id = 'bus_ghana'
  for update;

  if not found then
    raise exception 'Bus capacity and fare have not been configured.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    select coalesce(sum(greatest(coalesce(passengers_count, 1), 1)), 0)::bigint
      into already_held
    from public.travel_bookings
    where coalesce(is_paid, false)
       or status in ('pending_approval', 'approved', 'boarded', 'cancel_requested');
    new.fare_amount := configured_price_sle * requested_seats;
  else
    select coalesce(sum(greatest(coalesce(passengers_count, 1), 1)), 0)::bigint
      into already_held
    from public.travel_bookings
    where id <> new.id
      and (
        coalesce(is_paid, false)
        or status in ('pending_approval', 'approved', 'boarded', 'cancel_requested')
      );
  end if;

  if already_held + requested_seats > configured_capacity then
    raise exception 'The bus is at full capacity. Please select the next departure.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.matmove_get_travel_availability()
returns table(
  total_seats integer,
  price_usd numeric,
  price_sle numeric,
  held_seats bigint,
  available_seats bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
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
       or bookings.status in ('pending_approval', 'approved', 'boarded', 'cancel_requested')
  ) as holds
  where settings.id = 'bus_ghana';
$function$;
