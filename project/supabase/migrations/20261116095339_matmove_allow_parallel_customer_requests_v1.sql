begin;

do $patch$
declare
  v_definition text;
  v_old text := $old$
  if exists (
    select 1 from public.bookings
    where rider_id = u
      and status::text in ('pending','pending_admin','cash_reserve_pending')
  ) then
    raise exception 'CONFLICT: Resolve your pending request before creating another.';
  end if;

$old$;
  v_updated text;
begin
  v_definition := pg_get_functiondef('public.matmove_create_customer_trip(uuid,jsonb)'::regprocedure);
  if position('Resolve your pending request before creating another.' in v_definition) > 0 then
    v_updated := replace(v_definition, v_old, '');
    if v_updated = v_definition then
      raise exception 'Could not safely remove the pending-booking creation guard.';
    end if;
    execute v_updated;
  end if;
end;
$patch$;

commit;
