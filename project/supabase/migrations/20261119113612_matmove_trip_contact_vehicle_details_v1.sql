-- Extend the authorized trip contact card with the driver's verified vehicle category.
-- The booking vehicle_type remains the requested category; this separate field is the driver's actual registered category.
begin;
do $patch$
declare
  v_definition text;
  v_old text := $old$'phone',coalesce(nullif(btrim(dp.phone),''),nullif(btrim(dp.phone_number),''),'')$old$;
  v_new text := $new$'phone',coalesce(nullif(btrim(dp.phone),''),nullif(btrim(dp.phone_number),''),''),
      'vehicle_type',nullif(btrim(dp.vehicle_type),'')$new$;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.matmove_trip_contact_cards(uuid[])'::regprocedure);
  if position($field$'vehicle_type'$field$ in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'Could not safely locate the driver contact-card phone field; no function was changed.';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$patch$;
notify pgrst, 'reload schema';
commit;