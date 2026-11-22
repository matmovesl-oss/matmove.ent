do $patch$
declare v_definition text;v_updated text;
begin
 v_definition:=pg_get_functiondef('public.matmove_admin_trip_review(uuid)'::regprocedure);
 v_updated:=replace(v_definition,
  'from public.matmove_cash_ride_legs l where l.booking_id=b.id'||E'\n ) e;',
  'from public.matmove_cash_ride_legs l where l.booking_id=b.id'||E'\n  union all select a.created_at,jsonb_build_object(''label'',''Cash return: ''||a.event_type,''at'',a.created_at,''detail'',a.details::text) from public.matmove_cash_ride_audit_events a where a.booking_id=b.id and a.event_type like ''%cash_return%'''||E'\n ) e;'
 );
 if v_updated=v_definition and position('Cash return:' in v_definition)=0 then raise exception 'Could not append physical cash return events to the Admin timeline.';end if;
 execute v_updated;
end;$patch$;