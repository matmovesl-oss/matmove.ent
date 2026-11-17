-- Close stale cash dispatch after an unresolved physical-return confirmation.
-- This is a quarantine only: it does not capture, refund, settle or alter either
-- party's original confirmation. The original cash reserve and all receipts remain.
begin;

create or replace function public.matmove_quarantine_stale_cash_handover_review()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  stale_row record;
  quarantined_count integer := 0;
begin
  -- A driver or customer must not leave an assigned cash request in live
  -- dispatch forever after a one-sided physical-return confirmation.
  -- Only quarantine once the return request itself has been waiting 24 hours,
  -- while the cash ledger is still collection_pending and no capture/refund
  -- provider operation has ever been attempted or recorded.
  for stale_row in
    select
      b.id,
      cp.cash_return_status,
      cp.cash_return_requested_at,
      cp.cash_return_note,
      cp.cash_return_driver_confirmed_at,
      cp.cash_return_rider_confirmed_at,
      cp.driver_cash_confirmed_at,
      cp.rider_cash_confirmed_at,
      cp.currency,
      cp.driver_cash_minor,
      cp.matmove_fee_minor
    from public.bookings b
    join public.matmove_cash_ride_payments cp on cp.booking_id=b.id
    where b.payment_method='cash'
      and b.service_type='ride'
      and b.status='in_progress'
      and cp.status='collection_pending'
      and cp.cash_return_status in ('requested','driver_confirmed','rider_confirmed')
      and cp.cash_return_requested_at < pg_catalog.clock_timestamp() - interval '24 hours'
      and (
        cp.cash_return_driver_confirmed_at is null
        or cp.cash_return_rider_confirmed_at is null
      )
      and not exists (
        select 1
        from public.matmove_cash_ride_legs l
        where l.booking_id=b.id
          and l.leg_kind in ('capture','refund')
          and (
            l.attempted_at is not null
            or l.provider_transfer_id is not null
            or l.status in ('pending','processing','completed','review_required')
          )
      )
    order by cp.cash_return_requested_at
    limit 200
    for update of b,cp skip locked
  loop
    -- The booking guard requires the ledger to enter review_required before
    -- the booking can leave in_progress. Do not touch the return status,
    -- confirmation timestamps, manual-resolution fields or cash legs.
    update public.matmove_cash_ride_payments
    set status='review_required',
        updated_at=pg_catalog.clock_timestamp()
    where booking_id=stale_row.id
      and status='collection_pending';

    if not found then
      continue;
    end if;

    update public.bookings
    set status='cash_review_required',
        updated_at=pg_catalog.clock_timestamp()
    where id=stale_row.id
      and payment_method='cash'
      and status='in_progress';

    if not found then
      raise exception 'CASH_REVIEW_STATE_INVALID: Booking could not be safely moved out of live dispatch.';
    end if;

    insert into public.matmove_cash_ride_audit_events(
      booking_id,event_type,actor_type,actor_profile_id,details
    ) values (
      stale_row.id,'manual_review_opened','system',null,
      pg_catalog.jsonb_build_object(
        'reasonCode','cash_handover_confirmation_stale',
        'cashReturnStatus',stale_row.cash_return_status,
        'cashReturnRequestedAt',stale_row.cash_return_requested_at,
        'cashReturnNote',stale_row.cash_return_note,
        'driverReturnConfirmed',stale_row.cash_return_driver_confirmed_at is not null,
        'riderReturnConfirmed',stale_row.cash_return_rider_confirmed_at is not null,
        'driverCashConfirmed',stale_row.driver_cash_confirmed_at is not null,
        'riderCashConfirmed',stale_row.rider_cash_confirmed_at is not null,
        'driverCashMinor',stale_row.driver_cash_minor::text,
        'feeReserveMinor',stale_row.matmove_fee_minor::text,
        'currency',stale_row.currency,
        'cashDispatchClosedForReview',true,
        'moneyMovement',false
      )
    );

    insert into public.matmove_ride_investigation_tickets(
      booking_id,reason_code,source_status,status,
      first_seen_at,last_seen_at,details,updated_at
    ) values (
      stale_row.id,
      'cash_handover_confirmation_stale',
      'cash_review_required',
      'open',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp(),
      pg_catalog.jsonb_build_object(
        'paymentMethod','cash',
        'driverAssigned',true,
        'cashDispatchClosedForReview',true,
        'cashReturnStatus',stale_row.cash_return_status,
        'cashReturnRequestedAt',stale_row.cash_return_requested_at,
        'cashReturnNote',stale_row.cash_return_note,
        'driverReturnConfirmed',stale_row.cash_return_driver_confirmed_at is not null,
        'riderReturnConfirmed',stale_row.cash_return_rider_confirmed_at is not null,
        'driverCashConfirmed',stale_row.driver_cash_confirmed_at is not null,
        'riderCashConfirmed',stale_row.rider_cash_confirmed_at is not null,
        'driverCashMinor',stale_row.driver_cash_minor::text,
        'feeReserveMinor',stale_row.matmove_fee_minor::text,
        'currency',stale_row.currency,
        'moneyMovement',false,
        'resolutionRequired',true
      ),
      pg_catalog.clock_timestamp()
    )
    on conflict(booking_id) do update
      set reason_code='cash_handover_confirmation_stale',
          source_status='cash_review_required',
          status='open',
          last_seen_at=pg_catalog.clock_timestamp(),
          details=coalesce(public.matmove_ride_investigation_tickets.details,'{}'::jsonb)
            || excluded.details,
          updated_at=pg_catalog.clock_timestamp();

    quarantined_count := quarantined_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'quarantined',quarantined_count,
    'dispatchClosed',quarantined_count,
    'moneyMovement',false,
    'confirmationPreserved',true,
    'reviewAfterHours',24
  );
end;
$function$;

revoke all on function public.matmove_quarantine_stale_cash_handover_review()
  from public,anon,authenticated;
grant execute on function public.matmove_quarantine_stale_cash_handover_review()
  to service_role;

create or replace function public.matmove_ride_stale_request_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  ticket_count integer := 0;
  cancelled_count integer := 0;
  cash_quarantine jsonb;
  cash_quarantined_count integer := 0;
begin
  -- Every unfinished request that has not moved for 30 minutes receives
  -- one durable investigation ticket. The same ticket is refreshed on later sweeps.
  with stale as (
    select b.id,b.status,b.payment_method,b.driver_id,b.updated_at,b.created_at
    from public.bookings b
    where b.status in (
      'pending','pending_admin','cash_reserve_pending',
      'cash_review_required','accepted','in_progress'
    )
    and coalesce(b.updated_at,b.created_at) < pg_catalog.clock_timestamp() - interval '30 minutes'
    order by coalesce(b.updated_at,b.created_at)
    limit 500
  ), upserted as (
    insert into public.matmove_ride_investigation_tickets(
      booking_id,reason_code,source_status,last_seen_at,details
    )
    select s.id,
      case
        when s.status='cash_review_required' then 'cash_payment_review_overdue'
        when s.status='in_progress' then 'trip_in_progress_stale'
        when s.status='accepted' then 'accepted_request_stale'
        when s.status='cash_reserve_pending' then 'cash_reserve_stale'
        else 'unassigned_or_pending_request_stale'
      end,
      s.status,pg_catalog.clock_timestamp(),
      pg_catalog.jsonb_build_object(
        'paymentMethod',s.payment_method,
        'driverAssigned',s.driver_id is not null,
        'lastBookingUpdate',s.updated_at
      )
    from stale s
    on conflict(booking_id) do update
      set last_seen_at=excluded.last_seen_at,
          source_status=excluded.source_status,
          reason_code=case
            when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true'
              or coalesce(public.matmove_ride_investigation_tickets.details->>'cashDispatchClosedForReview','false')='true'
            then public.matmove_ride_investigation_tickets.reason_code
            else excluded.reason_code
          end,
          details=case
            when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true'
              or coalesce(public.matmove_ride_investigation_tickets.details->>'cashDispatchClosedForReview','false')='true'
            then public.matmove_ride_investigation_tickets.details
            else excluded.details
          end,
          updated_at=pg_catalog.clock_timestamp()
      where public.matmove_ride_investigation_tickets.status <> 'resolved'
    returning 1
  )
  select count(*) into ticket_count from upserted;

  -- Cash handovers with one missing physical-return confirmation are no longer
  -- left in live dispatch after 24 hours. This function only quarantines; it
  -- never creates a capture/refund leg or edits either party's confirmation.
  cash_quarantine := public.matmove_quarantine_stale_cash_handover_review();
  cash_quarantined_count := coalesce((cash_quarantine->>'quarantined')::integer,0);

  -- Only a truly abandoned, unassigned, unpaid request is auto-cancelled.
  -- Any payment/cash ledger, assigned driver, started trip or uncertainty blocks this path.
  with abandoned as (
    select b.id
    from public.bookings b
    where b.status in ('pending','pending_admin')
      and b.driver_id is null
      and b.started_at is null
      and coalesce(b.updated_at,b.created_at) < pg_catalog.clock_timestamp() - interval '60 minutes'
      and not exists(select 1 from public.ride_payments rp where rp.booking_id=b.id)
      and not exists(select 1 from public.matmove_cash_ride_payments cp where cp.booking_id=b.id)
    order by coalesce(b.updated_at,b.created_at)
    limit 200
    for update skip locked
  )
  update public.bookings b
  set status='cancelled',updated_at=pg_catalog.clock_timestamp()
  from abandoned a
  where b.id=a.id
  ;
  get diagnostics cancelled_count = row_count;

  return pg_catalog.jsonb_build_object(
    'ticketsCreatedOrRefreshed',ticket_count,
    'unfundedRequestsAutoCancelled',coalesce(cancelled_count,0),
    'staleCashHandoverQuarantined',cash_quarantined_count,
    'ticketAfterMinutes',30,
    'autoCancelAfterMinutes',60,
    'cashHandoverReviewAfterHours',24
  );
end;
$function$;

commit;
