-- Production-safe driver cancellation and same-booking redispatch.
-- The customer payment/escrow hold is deliberately retained. Only a verified
-- replacement driver may become the final digital payout beneficiary.
begin;

create or replace function public.matmove_open_driver_cancel_review(
  p_booking_id uuid,
  p_driver_id uuid,
  p_request_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  b public.bookings%rowtype;
begin
  if p_reason_code not in (
    'driver_cancelled_after_start',
    'cash_fee_reserve_state_uncertain',
    'digital_escrow_state_uncertain'
  ) then
    raise exception 'INVALID_STATE: Unsupported driver cancellation review reason.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.driver_id is distinct from p_driver_id then
    raise exception 'FORBIDDEN: Only the assigned driver can open this review.';
  end if;

  insert into public.matmove_ride_investigation_tickets(
    booking_id, reason_code, source_status, last_seen_at, details
  ) values (
    p_booking_id, p_reason_code, b.status::text, pg_catalog.clock_timestamp(),
    pg_catalog.jsonb_build_object(
      'paymentMethod', b.payment_method,
      'driverId', p_driver_id,
      'requestId', p_request_id,
      'driverCancellationReview', true,
      'automaticRedispatch', false
    )
  )
  on conflict (booking_id) do update
    set reason_code=excluded.reason_code,
        source_status=excluded.source_status,
        status='open',
        last_seen_at=pg_catalog.clock_timestamp(),
        details=public.matmove_ride_investigation_tickets.details || excluded.details,
        updated_at=pg_catalog.clock_timestamp();

  if not exists (
    select 1 from public.matmove_ride_booking_events e
    where e.booking_id=p_booking_id
      and e.event_type='driver_cancel_review_opened'
      and e.details->>'requestId'=p_request_id::text
  ) then
    insert into public.matmove_ride_booking_events(
      booking_id,event_type,actor_id,actor_type,details
    ) values (
      p_booking_id,'driver_cancel_review_opened',p_driver_id,'driver',
      pg_catalog.jsonb_build_object(
        'requestId',p_request_id,
        'reasonCode',p_reason_code,
        'bookingStatus',b.status::text,
        'automaticRedispatch',false
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'success',true,'reviewRequired',true,'redispatched',false,
    'booking',pg_catalog.to_jsonb(b),
    'message','Admin investigation opened. No refund, payout or re-dispatch was started.'
  );
end;
$function$;

revoke all on function public.matmove_open_driver_cancel_review(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.matmove_open_driver_cancel_review(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.matmove_driver_cancel_redispatch(
  p_booking_id uuid,
  p_driver_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  b public.bookings%rowtype;
  b_after public.bookings%rowtype;
  rp public.ride_payments%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  prior public.matmove_dispatch_audit%rowtype;
begin
  if p_booking_id is null or p_driver_id is null or p_request_id is null then
    raise exception 'INVALID_STATE: Booking, driver and request reference are required.';
  end if;

  select * into prior
  from public.matmove_dispatch_audit
  where request_id = p_request_id;

  if found then
    if prior.booking_id <> p_booking_id
       or prior.actor_id <> p_driver_id
       or prior.action <> 'unassign'
       or prior.driver_id <> p_driver_id then
      raise exception 'DISPATCH_CONFLICT: This request reference was already used for another action.';
    end if;
    select * into b_after from public.bookings where id = p_booking_id;
    if not found then
      raise exception 'NOT_FOUND: Booking not found.';
    end if;
    return pg_catalog.jsonb_build_object(
      'success', true, 'redispatched', true, 'alreadyApplied', true,
      'booking', pg_catalog.to_jsonb(b_after)
    );
  end if;

  select * into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: Booking not found.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_driver_id and p.role::text = 'driver'
  ) then
    raise exception 'FORBIDDEN: An authenticated driver account is required.';
  end if;

  -- A cancellation after the trip starts is never an automatic re-dispatch.
  if b.driver_id is distinct from p_driver_id then
    raise exception 'FORBIDDEN: Only the currently assigned driver can cancel this booking.';
  end if;

  if b.started_at is not null or b.status::text = 'in_progress' then
    return public.matmove_open_driver_cancel_review(
      p_booking_id,p_driver_id,p_request_id,'driver_cancelled_after_start'
    );
  end if;

  if b.status::text <> 'accepted' then
    raise exception 'INVALID_STATE: Only an accepted, unstarted trip can be re-dispatched.';
  end if;

  if b.payment_method = 'cash' then
    select * into cp
    from public.matmove_cash_ride_payments
    where booking_id = p_booking_id
    for update;

    if not found then
      return public.matmove_open_driver_cancel_review(
        p_booking_id,p_driver_id,p_request_id,'cash_fee_reserve_state_uncertain'
      );
    end if;

    if cp.status <> 'fee_reserved'
       or cp.driver_id is distinct from p_driver_id
       or cp.driver_cash_confirmed_at is not null
       or cp.rider_cash_confirmed_at is not null
       or cp.cash_return_status <> 'not_requested'
       or not exists (
         select 1 from public.matmove_cash_ride_legs l
         where l.booking_id = p_booking_id
           and l.leg_kind = 'reserve'
           and l.status = 'completed'
           and l.provider_transfer_id is not null
           and l.verified_at is not null
           and l.verified_amount_minor = cp.matmove_fee_minor
       )
       or exists (
         select 1 from public.matmove_cash_ride_legs l
         where l.booking_id = p_booking_id
           and l.leg_kind in ('capture','refund')
           and (
             l.attempted_at is not null
             or l.provider_transfer_id is not null
             or l.status in ('pending','processing','completed','review_required')
           )
       ) then
      return public.matmove_open_driver_cancel_review(
        p_booking_id,p_driver_id,p_request_id,'cash_fee_reserve_state_uncertain'
      );
    end if;

    -- Keep the exact original 15 percent reserve. Clear only the old driver.
    update public.matmove_cash_ride_payments
    set driver_id = null,
        version = version + 1,
        updated_at = pg_catalog.clock_timestamp()
    where booking_id = p_booking_id;
  elsif b.payment_method = 'digital' then
    select * into rp
    from public.ride_payments
    where booking_id = p_booking_id
    for update;

    if not found then
      return public.matmove_open_driver_cancel_review(
        p_booking_id,p_driver_id,p_request_id,'digital_escrow_state_uncertain'
      );
    end if;

    if rp.state <> 'funded'
       or rp.driver_id is distinct from p_driver_id
       or not exists (
         select 1 from public.ride_payment_transfers t
         where t.booking_id = p_booking_id
           and t.kind = 'hold'
           and t.status = 'completed'
           and t.provider_id is not null
           and t.amount_minor = rp.fare_minor
           and t.source_account = rp.payer_account
           and t.destination_account = rp.escrow_account
       )
       or exists (
         select 1 from public.ride_payment_transfers t
         where t.booking_id = p_booking_id
           and t.kind <> 'hold'
           and (
             t.attempted_at is not null
             or t.provider_id is not null
             or t.status <> 'ready'
           )
       ) then
      return public.matmove_open_driver_cancel_review(
        p_booking_id,p_driver_id,p_request_id,'digital_escrow_state_uncertain'
      );
    end if;
  else
    raise exception 'INVALID_STATE: This booking payment method cannot be re-dispatched.';
  end if;

  -- The assignment-history trigger uses this transaction-local marker to
  -- record this driver as driver_cancelled rather than an Admin removal.
  perform pg_catalog.set_config('matmove.driver_cancelled', 'true', true);

  update public.bookings
  set driver_id = null,
      status = 'pending',
      accepted_at = null,
      matmove_excluded_driver_ids = case
        when p_driver_id = any(coalesce(matmove_excluded_driver_ids, '{}'::uuid[]))
          then coalesce(matmove_excluded_driver_ids, '{}'::uuid[])
        else pg_catalog.array_append(coalesce(matmove_excluded_driver_ids, '{}'::uuid[]), p_driver_id)
      end,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_booking_id
  returning * into b_after;

  insert into public.matmove_dispatch_audit(
    request_id, actor_id, booking_id, action, driver_id,
    expected_version, new_version, note, before_record, after_record
  ) values (
    p_request_id, p_driver_id, p_booking_id, 'unassign', p_driver_id,
    b.matmove_dispatch_version, b_after.matmove_dispatch_version,
    'Driver cancelled before start; original booking returned to matching.',
    pg_catalog.to_jsonb(b), pg_catalog.to_jsonb(b_after)
  );

  insert into public.matmove_ride_booking_events(
    booking_id, event_type, actor_id, actor_type, details
  ) values (
    p_booking_id, 'driver_redispatch_queued', p_driver_id, 'driver',
    pg_catalog.jsonb_build_object(
      'driverId', p_driver_id,
      'bookingId', p_booking_id,
      'paymentMethod', b.payment_method,
      'sameBooking', true,
      'paymentHoldRetained', true,
      'excludedFromFutureOffers', true
    )
  );

  return pg_catalog.jsonb_build_object(
    'success', true, 'redispatched', true, 'alreadyApplied', false,
    'booking', pg_catalog.to_jsonb(b_after),
    'paymentMethod', b.payment_method,
    'escrowRetained', true
  );
end;
$function$;

revoke all on function public.matmove_driver_cancel_redispatch(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.matmove_driver_cancel_redispatch(uuid,uuid,uuid)
  to service_role;

create or replace function public.matmove_accept_redispatched_digital(
  p_booking_id uuid,
  p_driver_id uuid,
  p_driver_account text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  b public.bookings%rowtype;
  b_after public.bookings%rowtype;
  rp public.ride_payments%rowtype;
  prior public.matmove_dispatch_audit%rowtype;
  eligibility jsonb;
begin
  if p_booking_id is null or p_driver_id is null or p_request_id is null
     or p_driver_account is null
     or p_driver_account !~ '^fac-[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_STATE: A valid booking, driver, request and SLE wallet account are required.';
  end if;

  select * into prior
  from public.matmove_dispatch_audit
  where request_id = p_request_id;

  if found then
    if prior.booking_id <> p_booking_id
       or prior.actor_id <> p_driver_id
       or prior.action <> 'assign'
       or prior.driver_id <> p_driver_id then
      raise exception 'DISPATCH_CONFLICT: This request reference was already used for another action.';
    end if;
    select * into b_after from public.bookings where id = p_booking_id;
    if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
    return pg_catalog.jsonb_build_object(
      'success', true, 'alreadyApplied', true,
      'booking', pg_catalog.to_jsonb(b_after)
    );
  end if;

  select * into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;

  select * into rp
  from public.ride_payments
  where booking_id = p_booking_id
  for update;

  if not found or b.payment_method <> 'digital' then
    raise exception 'LEGACY_PAYMENT: A digital escrow ledger is required.';
  end if;

  -- A lost HTTP response after assignment is an idempotent success.
  if b.driver_id = p_driver_id and b.status::text = 'accepted'
     and rp.driver_id = p_driver_id and rp.driver_account = p_driver_account
     and rp.state = 'funded' then
    return pg_catalog.jsonb_build_object(
      'success', true, 'alreadyApplied', true,
      'booking', pg_catalog.to_jsonb(b)
    );
  end if;

  if b.driver_id is not null
     or b.status::text not in ('pending','pending_admin')
     or b.started_at is not null
     or rp.state <> 'funded'
     or p_driver_id = b.rider_id
     or p_driver_id = any(coalesce(b.matmove_excluded_driver_ids, '{}'::uuid[]))
     or exists (
       select 1 from public.matmove_ride_driver_assignments a
       where a.booking_id = p_booking_id
         and a.driver_id = p_driver_id
         and a.assignment_status = 'driver_cancelled'
     ) then
    raise exception 'INVALID_STATE: This request is no longer available to this driver.';
  end if;

  if exists (
    select 1 from public.ride_payment_transfers t
    where t.booking_id = p_booking_id
      and t.kind <> 'hold'
      and (
        t.attempted_at is not null
        or t.provider_id is not null
        or t.status <> 'ready'
      )
  )
  or not exists (
    select 1 from public.ride_payment_transfers t
    where t.booking_id = p_booking_id
      and t.kind = 'hold'
      and t.status = 'completed'
      and t.provider_id is not null
      and t.amount_minor = rp.fare_minor
      and t.source_account = rp.payer_account
      and t.destination_account = rp.escrow_account
  ) then
    raise exception 'REDISPATCH_REVIEW_REQUIRED: Escrow or payout transfer state requires Admin reconciliation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('matmove-dispatch-driver:' || p_driver_id::text, 0)
  );

  eligibility := public.matmove_dispatch_driver_status(p_driver_id, p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %', eligibility->>'reason';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.wallets w on w.user_id = p.id
    where p.id = p_driver_id
      and p.role::text = 'driver'
      and p.kyc_status::text = 'approved'
      and not coalesce(p.is_wallet_frozen, false)
      and w.currency = 'SLE'
      and coalesce(w.monime_account_id, w.metadata->>'monime_account_id') = p_driver_account
      and not coalesce(w.is_frozen, false)
  ) then
    raise exception 'ACCOUNT_CHANGED: The replacement driver SLE wallet must be approved, linked and unfrozen.';
  end if;

  if p_driver_account in (rp.payer_account, rp.escrow_account, rp.fee_account) then
    raise exception 'ACCOUNT_CHANGED: Driver and platform/customer financial accounts must remain separate.';
  end if;

  -- Move only the future payout beneficiary. The original payer debit and
  -- escrow hold transfer row remain untouched and keep their original IDs.
  update public.ride_payments
  set driver_id = p_driver_id,
      driver_account = p_driver_account,
      updated_at = pg_catalog.clock_timestamp()
  where booking_id = p_booking_id;

  update public.bookings
  set driver_id = p_driver_id,
      status = 'accepted',
      accepted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_booking_id
  returning * into b_after;

  insert into public.matmove_dispatch_audit(
    request_id, actor_id, booking_id, action, driver_id,
    expected_version, new_version, note, before_record, after_record
  ) values (
    p_request_id, p_driver_id, p_booking_id, 'assign', p_driver_id,
    b.matmove_dispatch_version, b_after.matmove_dispatch_version,
    'Replacement driver accepted the original escrow-funded booking.',
    pg_catalog.to_jsonb(b), pg_catalog.to_jsonb(b_after)
  );

  insert into public.matmove_ride_booking_events(
    booking_id, event_type, actor_id, actor_type, details
  ) values (
    p_booking_id, 'digital_redispatch_driver_accepted', p_driver_id, 'driver',
    pg_catalog.jsonb_build_object(
      'driverId', p_driver_id,
      'assignmentNo', (
        select a.assignment_no from public.matmove_ride_driver_assignments a
        where a.booking_id = p_booking_id and a.driver_id = p_driver_id
        order by a.assignment_no desc limit 1
      ),
      'sameBooking', true,
      'newEscrowHold', false
    )
  );

  return pg_catalog.jsonb_build_object(
    'success', true, 'alreadyApplied', false,
    'booking', pg_catalog.to_jsonb(b_after),
    'payment', pg_catalog.jsonb_build_object(
      'state', 'funded',
      'payoutDriverId', p_driver_id,
      'payoutAccount', p_driver_account,
      'newEscrowHold', false
    )
  );
end;
$function$;

revoke all on function public.matmove_accept_redispatched_digital(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.matmove_accept_redispatched_digital(uuid,uuid,text,uuid)
  to service_role;

-- Expose the current final payout beneficiary to the authorized Admin review
-- RPC. The complete assignment chain remains in the existing timeline.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.matmove_admin_trip_review(uuid)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'payoutDriverId') = 0 then
    v_updated := pg_catalog.replace(
      v_definition,
      '''state'',rp.state,''fareMinor''',
      '''state'',rp.state,''payoutDriverId'',rp.driver_id,''payoutAccount'',rp.driver_account,''fareMinor'''
    );
    if v_updated = v_definition then
      raise exception 'Could not extend matmove_admin_trip_review payment details; expected definition marker was not found.';
    end if;
    execute v_updated;
  end if;
end;
$migration$;

commit;
