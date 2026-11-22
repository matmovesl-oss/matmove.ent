begin;

do $patch$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(
    'public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    'if b.status not in (''pending'',''pending_admin'',''cash_reserve_pending'',''accepted'',''in_progress'')',
    'if b.status not in (''pending'',''pending_admin'',''cash_reserve_pending'',''cash_review_required'',''accepted'',''in_progress'')'
  );
  if v_updated = v_definition
     and position('cash_review_required' in v_definition) = 0 then
    raise exception 'Admin cancellation status allowlist could not be safely extended.';
  end if;
  execute v_updated;
end;
$patch$;

do $patch$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(
    'public.matmove_cash_ride_record_leg(uuid,text,text,text,bigint,text,text,text,text,text)'::regprocedure
  );
  v_updated := replace(
    v_definition,
    'where id=p_booking_id and status in (''cash_reserve_pending'',''pending'',''accepted'');',
    'where id=p_booking_id and (status in (''cash_reserve_pending'',''pending'',''accepted'') or (status=''in_progress'' and exists(select 1 from public.matmove_cash_ride_payments cpr where cpr.booking_id=p_booking_id and cpr.status=''refunded'' and cpr.cash_return_status=''refunded'')));'
  );
  if v_updated = v_definition
     and position('cpr.cash_return_status=''refunded''' in v_definition) = 0 then
    raise exception 'Verified in-progress cash refund cancellation guard could not be safely extended.';
  end if;
  execute v_updated;
end;
$patch$;

commit;