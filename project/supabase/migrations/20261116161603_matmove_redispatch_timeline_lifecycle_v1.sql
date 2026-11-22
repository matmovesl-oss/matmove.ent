begin;

-- accepted_at represents the current acceptance of the booking, not only the
-- first lifetime acceptance. A replacement driver must not inherit the old
-- driver's timestamp after same-ID re-dispatch.
do $patch$
declare
  v_definition text;
  v_revised text;
begin
  select pg_get_functiondef('public.matmove_record_trip_timeline()'::regprocedure)
    into v_definition;

  if position('and old.accepted_at is null' in v_definition) = 0 then
    raise notice 'Booking accepted_at is already refreshed on every acceptance.';
    return;
  end if;

  v_revised := replace(v_definition, 'and old.accepted_at is null', '');
  if v_revised = v_definition then
    raise exception 'Could not update booking accepted_at semantics.';
  end if;
  execute v_revised;
end;
$patch$;

-- Close the active assignment when the booking reaches a terminal state.
-- Keep the row; never delete driver history.
create or replace function public.matmove_close_ride_driver_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_closed_status text;
begin
  if new.status::text = 'completed'
     and old.status::text is distinct from 'completed' then
    v_closed_status := 'completed';
  elsif new.status::text = 'cancelled'
     and old.status::text is distinct from 'cancelled' then
    v_closed_status := 'admin_removed';
  else
    return new;
  end if;

  update public.matmove_ride_driver_assignments
  set assignment_status = v_closed_status,
      ended_at = coalesce(new.completed_at,clock_timestamp()),
      reason = case when v_closed_status='completed'
        then coalesce(reason,'booking_completed')
        else coalesce(reason,'booking_cancelled') end
  where booking_id = new.id
    and assignment_status = 'assigned';

  if found then
    insert into public.matmove_ride_booking_events(
      booking_id,event_type,actor_id,actor_type,details
    ) values (
      new.id,
      case when v_closed_status='completed' then 'booking_completed' else 'booking_cancelled' end,
      null,
      'system',
      jsonb_build_object('status',new.status::text,'driverId',new.driver_id)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists matmove_close_ride_driver_assignment on public.bookings;
create trigger matmove_close_ride_driver_assignment
after update of status on public.bookings
for each row
when (new.status in ('completed','cancelled'))
execute function public.matmove_close_ride_driver_assignment();

revoke all on function public.matmove_close_ride_driver_assignment() from public, anon, authenticated;

commit;
