begin;

create or replace function public.matmove_admin_trip_review(p_booking uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor uuid;b public.bookings%rowtype;r public.profiles%rowtype;d public.profiles%rowtype;rp public.ride_payments%rowtype;cp public.matmove_cash_ride_payments%rowtype;driver_gps jsonb;customer_gps jsonb;active_trip boolean;payment_data jsonb;cash_data jsonb;timeline_data jsonb;
begin
 actor:=public.matmove_dispatch_actor();select * into b from public.bookings where id=p_booking;if not found then raise exception 'NOT_FOUND: Trip not found.';end if;
 select * into r from public.profiles where id=b.rider_id;if b.driver_id is not null then select * into d from public.profiles where id=b.driver_id;end if;
 active_trip:=b.driver_id is not null and b.status::text in ('accepted','in_progress');
 if active_trip then
  select jsonb_build_object('lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,'observedAt',p.observed_at,'receivedAt',p.received_at) into driver_gps from public.matmove_trip_positions p where p.booking_id=b.id and p.driver_id=b.driver_id and p.received_at>clock_timestamp()-interval '45 seconds' and p.observed_at>clock_timestamp()-interval '60 seconds';
  select jsonb_build_object('lat',p.latitude,'lng',p.longitude,'accuracy',p.accuracy,'observedAt',p.observed_at,'receivedAt',p.received_at) into customer_gps from public.matmove_customer_trip_positions p where p.booking_id=b.id and p.customer_id=b.rider_id and p.received_at>clock_timestamp()-interval '45 seconds' and p.observed_at>clock_timestamp()-interval '60 seconds';
 end if;
 select * into rp from public.ride_payments where booking_id=b.id;
 if found then payment_data:=jsonb_build_object('state',rp.state,'fareMinor',rp.fare_minor::text,'driverMinor',rp.driver_minor::text,'feeMinor',rp.fee_minor::text,'createdAt',rp.created_at,'updatedAt',rp.updated_at,'transfers',coalesce((select jsonb_agg(jsonb_build_object('kind',t.kind,'status',t.status,'amountMinor',t.amount_minor::text,'providerId',t.provider_id,'attemptedAt',t.attempted_at,'updatedAt',t.updated_at,'error',t.error) order by t.updated_at) from public.ride_payment_transfers t where t.booking_id=b.id),'[]'::jsonb));end if;
 select * into cp from public.matmove_cash_ride_payments where booking_id=b.id;
 if found then cash_data:=jsonb_build_object('status',cp.status,'currency',cp.currency,'fareMinor',cp.fare_minor::text,'driverCashMinor',cp.driver_cash_minor::text,'matmoveFeeMinor',cp.matmove_fee_minor::text,'driverConfirmedAt',cp.driver_cash_confirmed_at,'customerConfirmedAt',cp.rider_cash_confirmed_at,'manualResolutionAt',cp.manual_resolution_at,'manualResolutionNote',cp.manual_resolution_note,'legs',coalesce((select jsonb_agg(jsonb_build_object('kind',l.leg_kind,'status',l.status,'amountMinor',l.amount_minor::text,'providerTransferId',l.provider_transfer_id,'attemptedAt',l.attempted_at,'verifiedAt',l.verified_at,'verifiedReference',l.verified_reference,'errorCode',l.error_code) order by l.created_at) from public.matmove_cash_ride_legs l where l.booking_id=b.id),'[]'::jsonb));end if;
 select coalesce(jsonb_agg(e.item order by e.at),'[]'::jsonb) into timeline_data from (
  select b.created_at at,jsonb_build_object('label','Request created','at',b.created_at,'detail',null) item
  union all select b.accepted_at,jsonb_build_object('label','Driver accepted','at',b.accepted_at,'detail',coalesce(to_jsonb(d)->>'full_name',b.driver_id::text)) where b.accepted_at is not null
  union all select b.started_at,jsonb_build_object('label','Trip started','at',b.started_at,'detail',null) where b.started_at is not null
  union all select b.completed_at,jsonb_build_object('label','Trip completed','at',b.completed_at,'detail',null) where b.completed_at is not null
  union all select a.created_at,jsonb_build_object('label','Admin dispatch action: '||a.action,'at',a.created_at,'detail',a.note) from public.matmove_dispatch_audit a where a.booking_id=b.id
  union all select t.updated_at,jsonb_build_object('label','Digital transfer: '||t.kind||' ('||t.status||')','at',t.updated_at,'detail',coalesce(t.error,t.provider_id)) from public.ride_payment_transfers t where t.booking_id=b.id
  union all select l.updated_at,jsonb_build_object('label','Cash leg: '||l.leg_kind||' ('||l.status||')','at',l.updated_at,'detail',coalesce(l.error_code,l.verified_reference,l.provider_transfer_id)) from public.matmove_cash_ride_legs l where l.booking_id=b.id
 ) e;
 return jsonb_build_object('actor',actor,'bookingId',b.id,'dispatchVersion',b.matmove_dispatch_version::text,'status',b.status,'serverTime',clock_timestamp(),'paymentMethod',b.payment_method,'pickup',b.pickup_location,'destination',b.destination_location,'fare',b.fare_amount::text,'serviceType',b.service_type,'vehicleType',b.vehicle_type,'passengerCount',coalesce(b.passenger_count,1),'passengerName',b.passenger_name,'createdAt',b.created_at,'scheduledAt',b.scheduled_time,'acceptedAt',b.accepted_at,'startedAt',b.started_at,'completedAt',b.completed_at,'rider',jsonb_build_object('id',b.rider_id,'name',coalesce(nullif(to_jsonb(r)->>'full_name',''),to_jsonb(r)->>'email'),'email',to_jsonb(r)->>'email','phone',coalesce(nullif(to_jsonb(r)->>'phone',''),to_jsonb(r)->>'phone_number')),'driver',case when b.driver_id is null then null else jsonb_build_object('id',b.driver_id,'name',coalesce(nullif(to_jsonb(d)->>'full_name',''),to_jsonb(d)->>'email'),'email',to_jsonb(d)->>'email','phone',coalesce(nullif(to_jsonb(d)->>'phone',''),to_jsonb(d)->>'phone_number'),'vehicleType',to_jsonb(d)->>'vehicle_type','plate',to_jsonb(d)->>'plate_number') end,'pickupPin',case when b.matmove_pickup_lat is null then null else jsonb_build_object('lat',b.matmove_pickup_lat,'lng',b.matmove_pickup_lng) end,'destinationPin',case when b.matmove_destination_lat is null then null else jsonb_build_object('lat',b.matmove_destination_lat,'lng',b.matmove_destination_lng) end,'driverPosition',driver_gps,'customerPosition',customer_gps,'trackingActive',active_trip,'payment',payment_data,'cashPayment',cash_data,'timeline',timeline_data);
end;$function$;
revoke all on function public.matmove_admin_trip_review(uuid) from public,anon;grant execute on function public.matmove_admin_trip_review(uuid) to authenticated;

create or replace function public.matmove_admin_flag_unpaid_ride(p_booking_id uuid,p_note text,p_expected_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor uuid;b public.bookings%rowtype;ticket_id uuid;
begin
 actor:=public.matmove_dispatch_actor();if actor is distinct from p_expected_actor then raise exception 'FORBIDDEN: Your signed-in Admin account changed.';end if;
 if p_booking_id is null or p_note is null or length(btrim(p_note)) not between 3 and 300 then raise exception 'INVALID: A booking and review note (3–300 characters) are required.';end if;
 select * into b from public.bookings where id=p_booking_id for update;if not found then raise exception 'NOT_FOUND: Booking not found.';end if;
 if b.status in ('completed','cancelled') then raise exception 'INVALID_STATE: A completed or cancelled request cannot be flagged as an active unpaid request.';end if;
 if exists(select 1 from public.ride_payments where booking_id=b.id) or exists(select 1 from public.matmove_cash_ride_payments where booking_id=b.id) then raise exception 'PAYMENT_LEDGER_EXISTS: This request has a payment ledger. Open its payment investigation instead of flagging it as unpaid.';end if;
 insert into public.matmove_ride_investigation_tickets(booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at)
 values(b.id,'admin_unpaid_payment_review',b.status,'open',clock_timestamp(),clock_timestamp(),jsonb_build_object('adminPaymentReview',true,'flaggedBy',actor,'flaggedAt',clock_timestamp(),'adminNote',btrim(p_note),'paymentMethod',b.payment_method,'driverAssigned',b.driver_id is not null),clock_timestamp())
 on conflict(booking_id) do update set reason_code='admin_unpaid_payment_review',source_status=excluded.source_status,status='open',last_seen_at=clock_timestamp(),details=public.matmove_ride_investigation_tickets.details||jsonb_build_object('adminPaymentReview',true,'flaggedBy',actor,'flaggedAt',clock_timestamp(),'adminNote',btrim(p_note),'paymentMethod',b.payment_method,'driverAssigned',b.driver_id is not null),updated_at=clock_timestamp()
 returning id into ticket_id;
 return jsonb_build_object('actor',actor,'bookingId',b.id,'ticketId',ticket_id,'flagged',true,'status','open');
end;$function$;
revoke all on function public.matmove_admin_flag_unpaid_ride(uuid,text,uuid) from public,anon;grant execute on function public.matmove_admin_flag_unpaid_ride(uuid,text,uuid) to authenticated;

do $migration$ declare v_definition text;v_updated text;begin
 v_definition:=pg_get_functiondef('public.matmove_ride_stale_request_sweep()'::regprocedure);
 v_updated:=replace(v_definition,'reason_code=excluded.reason_code,'||E'\n          details=excluded.details,','reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>''adminPaymentReview'',''false'')=''true'' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,'||E'\n          details=case when coalesce(public.matmove_ride_investigation_tickets.details->>''adminPaymentReview'',''false'')=''true'' then public.matmove_ride_investigation_tickets.details else excluded.details end,');
 if v_updated=v_definition and position('adminPaymentReview' in v_definition)=0 then raise exception 'Could not preserve Admin payment-review flags in stale sweep.';end if;
 execute v_updated;
end;$migration$;

create or replace function public.matmove_resolve_terminal_ride_investigation()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
 if new.status in ('completed','cancelled') then
  if not exists(select 1 from public.ride_payments rp where rp.booking_id=new.id and rp.state='refunding')
   and not exists(select 1 from public.matmove_cash_ride_payments cp where cp.booking_id=new.id and cp.status='refund_pending')
   and not exists(select 1 from public.matmove_cash_ride_payments cp where cp.booking_id=new.id and cp.driver_id is not null and cp.status in ('collection_pending','review_required')) then
   update public.matmove_ride_investigation_tickets set status='resolved',updated_at=clock_timestamp() where booking_id=new.id and status<>'resolved';
  end if;
 end if;return new;
end;$function$;
drop trigger if exists matmove_resolve_terminal_ride_investigation on public.bookings;
create trigger matmove_resolve_terminal_ride_investigation after update of status on public.bookings for each row when (new.status in ('completed','cancelled')) execute function public.matmove_resolve_terminal_ride_investigation();
