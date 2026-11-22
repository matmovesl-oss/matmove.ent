begin;

do $patch$
declare
  v_definition text;
  v_revised text;
begin
  select pg_get_functiondef('public.matmove_admin_trip_review(uuid)'::regprocedure)
    into v_definition;

  if position('from public.matmove_ride_driver_assignments' in v_definition) > 0 then
    raise notice 'Driver assignment timeline is already installed.';
    return;
  end if;

  if position(' ) e;' in v_definition) = 0 then
    raise exception 'Expected Admin trip timeline boundary was not found; no function was changed.';
  end if;

  v_revised := replace(
    v_definition,
    ' ) e;',
    '  union all select a.assigned_at,jsonb_build_object(''label'',''Driver assignment #''||a.assignment_no||'': ''||a.assignment_status,''at'',a.assigned_at,''detail'',a.driver_id::text||coalesce('' · ''||a.reason,'''')) from public.matmove_ride_driver_assignments a where a.booking_id=b.id' || E'\n' ||
    '  union all select e.created_at,jsonb_build_object(''label'',''Booking event: ''||e.event_type,''at'',e.created_at,''detail'',e.details::text) from public.matmove_ride_booking_events e where e.booking_id=b.id and e.event_type <> ''driver_assigned''' || E'\n' ||
    ' ) e;'
  );

  if v_revised = v_definition then
    raise exception 'Admin trip timeline patch was not applied.';
  end if;

  execute v_revised;
end;
$patch$;

commit;
