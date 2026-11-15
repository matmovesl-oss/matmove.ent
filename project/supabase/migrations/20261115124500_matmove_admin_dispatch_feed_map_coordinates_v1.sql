begin;

-- Include validated pickup and destination coordinates in the dispatch feed so
-- every request card can render its own route preview, including cash requests.
do $patch$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
        'pickup',b.pickup_location,
        'destination',b.destination_location,
$old$;
  v_new text := $new$
        'pickupPin',case
          when b.matmove_pickup_lat between -90 and 90
            and b.matmove_pickup_lng between -180 and 180
          then jsonb_build_object('lat',b.matmove_pickup_lat,'lng',b.matmove_pickup_lng)
          else null
        end,
        'destinationPin',case
          when b.matmove_destination_lat between -90 and 90
            and b.matmove_destination_lng between -180 and 180
          then jsonb_build_object('lat',b.matmove_destination_lat,'lng',b.matmove_destination_lng)
          else null
        end,
        'pickup',b.pickup_location,
        'destination',b.destination_location,
$new$;
begin
  v_definition := pg_get_functiondef('public.matmove_admin_dispatch_feed()'::regprocedure);
  if position('''pickupPin''' in v_definition)>0
     and position('''destinationPin''' in v_definition)>0 then
    return;
  end if;
  v_updated := replace(v_definition,v_old,v_new);
  if v_updated=v_definition then
    raise exception 'Could not safely add map coordinates to the Admin dispatch feed.';
  end if;
  execute v_updated;
end;
$patch$;

commit;
