-- Read-only. Run separately after ACTIVE_TRIP_LOCATION_SETUP.sql succeeds.
select
 (select count(*)=4 from pg_attribute where attrelid=to_regclass('public.bookings') and attname in ('matmove_pickup_lat','matmove_pickup_lng','matmove_destination_lat','matmove_destination_lng') and not attisdropped) as trip_pins_ready,
 to_regprocedure('public.matmove_trip_location(uuid,text,double precision,double precision,double precision,timestamptz,uuid)') is not null as private_tracking_rpc_ready,
 to_regclass('public.matmove_trip_sharing') is not null as sharing_sessions_ready,
 (select count(*)=2 and bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.matmove_trip_positions'),to_regclass('public.matmove_trip_sharing'))) as tracking_rls_enabled,
 case when to_regclass('public.matmove_trip_positions') is null or to_regclass('public.matmove_trip_sharing') is null then false else
 not has_table_privilege('authenticated','public.matmove_trip_positions','SELECT') and not has_table_privilege('authenticated','public.matmove_trip_positions','INSERT')
 and not has_table_privilege('authenticated','public.matmove_trip_sharing','SELECT') and not has_table_privilege('authenticated','public.matmove_trip_sharing','UPDATE')
 and not has_table_privilege('anon','public.matmove_trip_positions','SELECT') end as direct_browser_tracking_blocked,
 exists(select 1 from pg_trigger where tgrelid=to_regclass('public.bookings') and tgname='matmove_clear_closed_trip_position' and not tgisinternal) as closed_trip_cleanup_ready;