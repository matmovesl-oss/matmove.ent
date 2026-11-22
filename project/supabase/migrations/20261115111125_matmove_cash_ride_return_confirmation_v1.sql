begin;
alter table public.matmove_cash_ride_payments
 add column if not exists cash_return_status text not null default 'not_requested',
 add column if not exists cash_return_requested_at timestamptz,
 add column if not exists cash_return_requested_by uuid references auth.users(id),
 add column if not exists cash_return_note text,
 add column if not exists cash_return_driver_confirmed_at timestamptz,
 add column if not exists cash_return_driver_confirmed_by uuid references auth.users(id),
 add column if not exists cash_return_rider_confirmed_at timestamptz,
 add column if not exists cash_return_rider_confirmed_by uuid references auth.users(id);
do $constraint$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.matmove_cash_ride_payments'::regclass and conname='matmove_cash_ride_return_status_check') then
  alter table public.matmove_cash_ride_payments add constraint matmove_cash_ride_return_status_check
   check(cash_return_status in ('not_requested','requested','driver_confirmed','rider_confirmed','both_confirmed','refund_pending','refunded','disputed'));
 end if;
end;
$constraint$;

create or replace function public.matmove_admin_request_cash_return(p_booking_id uuid,p_note text,p_expected_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor uuid;b public.bookings%rowtype;cp public.matmove_cash_ride_payments%rowtype;
begin
 actor:=public.matmove_dispatch_actor();
 if actor is distinct from p_expected_actor then raise exception 'FORBIDDEN: Your signed-in Admin account changed.';end if;
 if p_booking_id is null or p_note is null or length(btrim(p_note)) not between 3 and 300 then raise exception 'INVALID: A booking and return-verification note (3–300 characters) are required.';end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.payment_method<>'cash' or b.status<>'in_progress' then raise exception 'INVALID_STATE: Only an in-progress cash ride can enter physical cash-return verification.';end if;
 select * into cp from public.matmove_cash_ride_payments where booking_id=b.id for update;
 if not found or cp.driver_id is null or cp.driver_id is distinct from b.driver_id then raise exception 'CASH_HANDOVER_REVIEW_REQUIRED: No assigned cash driver was verified for this request.';end if;
 if cp.status<>'collection_pending' then raise exception 'CASH_RECONCILIATION_REQUIRED: Cash collection is not in the pre-capture state. Reconcile its existing payment legs before requesting return.';end if;
 if cp.cash_return_status in ('requested','driver_confirmed','rider_confirmed') then
  return jsonb_build_object('bookingId',b.id,'returnStatus',cp.cash_return_status,'requested',true,'idempotent',true);
 end if;
 if cp.cash_return_status='both_confirmed' then
  return jsonb_build_object('bookingId',b.id,'returnStatus',cp.cash_return_status,'requested',true,'idempotent',true);
 end if;
 update public.matmove_cash_ride_payments set cash_return_status='requested',cash_return_requested_at=clock_timestamp(),cash_return_requested_by=actor,cash_return_note=btrim(p_note),cash_return_driver_confirmed_at=null,cash_return_driver_confirmed_by=null,cash_return_rider_confirmed_at=null,cash_return_rider_confirmed_by=null where booking_id=b.id returning * into cp;
 insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id,details)
 values(b.id,'cash_return_requested','admin',actor,jsonb_build_object('note',btrim(p_note),'fareMinor',cp.driver_cash_minor,'feeReserveMinor',cp.matmove_fee_minor));
 return jsonb_build_object('bookingId',b.id,'returnStatus',cp.cash_return_status,'requested',true,'driverId',cp.driver_id,'riderId',cp.rider_id);
end;$function$;
revoke all on function public.matmove_admin_request_cash_return(uuid,text,uuid) from public,anon;
grant execute on function public.matmove_admin_request_cash_return(uuid,text,uuid) to authenticated;

create or replace function public.matmove_cash_ride_confirm_return(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor uuid;b public.bookings%rowtype;cp public.matmove_cash_ride_payments%rowtype;actor_type text;
begin
 actor:=auth.uid();if actor is null then raise exception 'FORBIDDEN: Sign in before confirming a cash return.';end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found or b.payment_method<>'cash' or b.status<>'in_progress' then raise exception 'INVALID_STATE: This cash return is no longer awaiting confirmation.';end if;
 select * into cp from public.matmove_cash_ride_payments where booking_id=b.id for update;
 if not found or cp.driver_id is null then raise exception 'CASH_LEDGER_MISSING: Assigned cash payment record not found.';end if;
 if actor=cp.driver_id and actor=b.driver_id then actor_type:='driver';
 elsif actor=cp.rider_id and actor=b.rider_id then actor_type:='rider';
 else raise exception 'FORBIDDEN: Only the assigned driver and requesting customer can confirm this physical cash return.';end if;
 if cp.cash_return_status='both_confirmed' then
  return jsonb_build_object('bookingId',b.id,'returnStatus','both_confirmed','driverConfirmed',true,'riderConfirmed',true,'idempotent',true);
 end if;
 if cp.cash_return_status not in ('requested','driver_confirmed','rider_confirmed') then raise exception 'INVALID_STATE: Admin has not requested a physical cash-return confirmation.';end if;
 if actor_type='driver' and cp.cash_return_driver_confirmed_at is null then
  update public.matmove_cash_ride_payments set cash_return_driver_confirmed_at=clock_timestamp(),cash_return_driver_confirmed_by=actor,cash_return_status=case when cash_return_rider_confirmed_at is not null then 'both_confirmed' else 'driver_confirmed' end where booking_id=b.id returning * into cp;
 elsif actor_type='rider' and cp.cash_return_rider_confirmed_at is null then
  update public.matmove_cash_ride_payments set cash_return_rider_confirmed_at=clock_timestamp(),cash_return_rider_confirmed_by=actor,cash_return_status=case when cash_return_driver_confirmed_at is not null then 'both_confirmed' else 'rider_confirmed' end where booking_id=b.id returning * into cp;
 end if;
 insert into public.matmove_cash_ride_audit_events(booking_id,event_type,actor_type,actor_profile_id,details)
 values(b.id,actor_type||'_cash_return_confirmed',actor_type,actor,jsonb_build_object('returnStatus',cp.cash_return_status));
 return jsonb_build_object('bookingId',b.id,'returnStatus',cp.cash_return_status,'driverConfirmed',cp.cash_return_driver_confirmed_at is not null,'riderConfirmed',cp.cash_return_rider_confirmed_at is not null);
end;$function$;
revoke all on function public.matmove_cash_ride_confirm_return(uuid) from public,anon;
grant execute on function public.matmove_cash_ride_confirm_return(uuid) to authenticated;

create or replace function public.matmove_cash_ride_return_status(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor uuid;b public.bookings%rowtype;cp public.matmove_cash_ride_payments%rowtype;
begin
 actor:=auth.uid();if actor is null then raise exception 'FORBIDDEN: Sign in first.';end if;
 select * into b from public.bookings where id=p_booking_id;
 if not found or b.payment_method<>'cash' then raise exception 'NOT_FOUND: Cash booking not found.';end if;
 select * into cp from public.matmove_cash_ride_payments where booking_id=b.id;
 if not found or actor not in (cp.rider_id,cp.driver_id) then raise exception 'FORBIDDEN: This is not your cash booking.';end if;
 return jsonb_build_object('bookingId',b.id,'returnStatus',cp.cash_return_status,'requestedAt',cp.cash_return_requested_at,'note',cp.cash_return_note,'driverConfirmed',cp.cash_return_driver_confirmed_at is not null,'riderConfirmed',cp.cash_return_rider_confirmed_at is not null,'driverConfirmedAt',cp.cash_return_driver_confirmed_at,'riderConfirmedAt',cp.cash_return_rider_confirmed_at);
end;$function$;
revoke all on function public.matmove_cash_ride_return_status(uuid) from public,anon;
grant execute on function public.matmove_cash_ride_return_status(uuid) to authenticated;

-- Let Admin cancellation proceed for driver-linked cash only after both parties confirm the physical fare was returned.
do $patch$
declare v_definition text;v_updated text;
begin
 v_definition:=pg_get_functiondef('public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure);
 v_updated:=replace(v_definition,
  'or (b.status=''in_progress'' and b.payment_method=''cash'') then',
  'or (b.status=''in_progress'' and b.payment_method=''cash'' and not exists(select 1 from public.matmove_cash_ride_payments cpr where cpr.booking_id=b.id and cpr.cash_return_status=''both_confirmed'')) then'
 );
 v_updated:=replace(v_updated,
  'if cp.driver_id is not null then',
  'if cp.driver_id is not null and cp.cash_return_status is distinct from ''both_confirmed'' then'
 );
 v_updated:=replace(v_updated,
  '    if cp.status in (''reserve_ready'',''cancelled'') then',
  '    if cp.driver_id is not null and cp.cash_return_status=''both_confirmed'' and cp.status=''collection_pending'' then' || E'\n      update public.matmove_cash_ride_payments set status=''fee_reserved'' where booking_id=b.id returning * into cp;' || E'\n    end if;' || E'\n    if cp.status in (''reserve_ready'',''cancelled'') then'
 );
 v_updated:=replace(v_updated,
  'update public.matmove_cash_ride_payments set status=''refund_pending'',updated_at=clock_timestamp()',
  'update public.matmove_cash_ride_payments set status=''refund_pending'',cash_return_status=case when cash_return_status=''both_confirmed'' then ''refund_pending'' else cash_return_status end,updated_at=clock_timestamp()'
 );
 if v_updated=v_definition or position('cash_return_status' in v_updated)=0 or position('both_confirmed' in v_updated)=0 then
  raise exception 'Admin cash cancellation guard could not be safely extended for dual-confirmed cash return.';
 end if;
 execute v_updated;
end;$patch$;

-- Include return state in the Dispatch review payload without exposing account identifiers.
do $patch$
declare v_definition text;v_updated text;
begin
 v_definition:=pg_get_functiondef('public.matmove_admin_trip_review(uuid)'::regprocedure);
 v_updated:=replace(v_definition,
  '''manualResolutionNote'',cp.manual_resolution_note,',
  '''manualResolutionNote'',cp.manual_resolution_note,''returnStatus'',cp.cash_return_status,''returnRequestedAt'',cp.cash_return_requested_at,''returnNote'',cp.cash_return_note,''returnDriverConfirmedAt'',cp.cash_return_driver_confirmed_at,''returnRiderConfirmedAt'',cp.cash_return_rider_confirmed_at,'
 );
 if v_updated=v_definition and position('returnStatus' in v_definition)=0 then raise exception 'Admin trip review could not be extended with cash return status.';end if;
 execute v_updated;
end;$patch$;

-- Mark the return ledger refunded only after the cash fee refund is provider-verified.
create or replace function public.matmove_cash_ride_return_refund_status_sync()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if new.status='refunded' and new.cash_return_status='refund_pending' then
  update public.matmove_cash_ride_payments set cash_return_status='refunded' where booking_id=new.booking_id;
 end if;
 return new;
end;$function$;
drop trigger if exists matmove_cash_ride_return_refund_status_sync on public.matmove_cash_ride_payments;
create trigger matmove_cash_ride_return_refund_status_sync after update of status on public.matmove_cash_ride_payments for each row when (new.status='refunded') execute function public.matmove_cash_ride_return_refund_status_sync();

commit;