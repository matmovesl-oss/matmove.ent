begin;

-- Keep every assignment for the life of the booking. A driver cancellation
-- changes only the assignment; it does not create a second booking or charge.
alter table public.bookings
  add column if not exists matmove_excluded_driver_ids uuid[] not null default '{}'::uuid[];

create table if not exists public.matmove_ride_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  assignment_no integer not null check (assignment_no > 0),
  driver_id uuid not null references public.profiles(id) on delete restrict,
  assignment_status text not null check (
    assignment_status in ('assigned','driver_cancelled','completed','admin_removed')
  ),
  assigned_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  unique (booking_id, assignment_no)
);

create unique index if not exists matmove_ride_one_active_assignment_idx
  on public.matmove_ride_driver_assignments(booking_id)
  where assignment_status = 'assigned';
create index if not exists matmove_ride_assignments_booking_idx
  on public.matmove_ride_driver_assignments(booking_id, assignment_no);
create index if not exists matmove_ride_assignments_driver_idx
  on public.matmove_ride_driver_assignments(driver_id, assignment_status);

create table if not exists public.matmove_ride_booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('driver','rider','merchant','admin','system')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists matmove_ride_booking_events_timeline_idx
  on public.matmove_ride_booking_events(booking_id, created_at, id);

alter table public.matmove_ride_driver_assignments enable row level security;
alter table public.matmove_ride_booking_events enable row level security;
revoke all on public.matmove_ride_driver_assignments from public, anon, authenticated;
revoke all on public.matmove_ride_booking_events from public, anon, authenticated;
grant all on public.matmove_ride_driver_assignments to service_role;
grant all on public.matmove_ride_booking_events to service_role;

-- Backfill the existing attached driver for each legacy booking. Existing
-- closed bookings remain historical; active bookings receive an open row.
insert into public.matmove_ride_driver_assignments(
  booking_id, assignment_no, driver_id, assignment_status, assigned_at, ended_at, reason
)
select b.id, 1, b.driver_id,
  case when b.status = 'completed' then 'completed'
       when b.status = 'cancelled' then 'admin_removed'
       else 'assigned' end,
  coalesce(b.accepted_at, b.created_at, clock_timestamp()),
  case when b.status in ('completed','cancelled') then coalesce(b.completed_at,b.updated_at,clock_timestamp()) else null end,
  case when b.status = 'cancelled' then 'legacy_closed_booking' else 'legacy_assignment_backfill' end
from public.bookings b
where b.driver_id is not null
  and not exists (
    select 1 from public.matmove_ride_driver_assignments a
    where a.booking_id=b.id and a.driver_id=b.driver_id
  );

create or replace function public.matmove_record_booking_driver_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reason text;
  v_actor_type text;
  v_assignment_no integer;
  v_old_status text;
begin
  if tg_op = 'UPDATE' and new.driver_id is not distinct from old.driver_id then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.driver_id is not null then
    v_reason := case
      when current_setting('matmove.driver_cancelled', true) = 'true'
        then 'driver_cancelled_before_start'
      else 'assignment_removed_or_replaced'
    end;
    v_actor_type := case
      when current_setting('matmove.driver_cancelled', true) = 'true'
        then 'driver'
      else 'system'
    end;

    update public.matmove_ride_driver_assignments
    set assignment_status = case
          when current_setting('matmove.driver_cancelled', true) = 'true'
            then 'driver_cancelled'
          else 'admin_removed'
        end,
        ended_at = clock_timestamp(),
        reason = v_reason
    where booking_id = old.id
      and driver_id = old.driver_id
      and assignment_status = 'assigned';

    if not found then
      select coalesce(max(a.assignment_no),0)+1 into v_assignment_no
      from public.matmove_ride_driver_assignments a
      where a.booking_id=old.id;
      insert into public.matmove_ride_driver_assignments(
        booking_id,assignment_no,driver_id,assignment_status,assigned_at,ended_at,reason
      ) values (
        old.id,v_assignment_no,old.driver_id,
        case when current_setting('matmove.driver_cancelled',true)='true'
          then 'driver_cancelled' else 'admin_removed' end,
        coalesce(old.accepted_at,old.created_at,clock_timestamp()),clock_timestamp(),v_reason
      );
    end if;

    insert into public.matmove_ride_booking_events(
      booking_id,event_type,actor_id,actor_type,details
    ) values (
      old.id,
      case when current_setting('matmove.driver_cancelled',true)='true'
        then 'driver_cancelled' else 'driver_assignment_removed' end,
      old.driver_id,
      v_actor_type,
      jsonb_build_object('driverId',old.driver_id,'reason',v_reason)
    );
  end if;

  if new.driver_id is not null then
    select coalesce(max(a.assignment_no),0)+1 into v_assignment_no
    from public.matmove_ride_driver_assignments a
    where a.booking_id=new.id;

    insert into public.matmove_ride_driver_assignments(
      booking_id,assignment_no,driver_id,assignment_status,assigned_at
    ) values (
      new.id,v_assignment_no,new.driver_id,'assigned',clock_timestamp()
    );

    insert into public.matmove_ride_booking_events(
      booking_id,event_type,actor_id,actor_type,details
    ) values (
      new.id,'driver_assigned',new.driver_id,'driver',
      jsonb_build_object('driverId',new.driver_id,'assignmentNo',v_assignment_no)
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists matmove_record_booking_driver_assignment on public.bookings;
create trigger matmove_record_booking_driver_assignment
after insert or update of driver_id on public.bookings
for each row execute function public.matmove_record_booking_driver_assignment();
revoke all on function public.matmove_record_booking_driver_assignment() from public, anon, authenticated;

-- A released/unassigned booking must not keep its former driver marked busy
-- merely because the one booking-level escrow ledger still references them.
create or replace function public.matmove_dispatch_driver_busy(p_driver uuid, p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    exists (
      select 1
      from public.bookings b
      where b.id is distinct from p_booking
        and b.driver_id = p_driver
        and b.status in ('pending','pending_admin','accepted','in_progress')
    )
    or exists (
      select 1
      from public.ride_payments rp
      join public.bookings b on b.id=rp.booking_id
      where rp.booking_id is distinct from p_booking
        and rp.driver_id = p_driver
        and b.driver_id = p_driver
        and b.status in ('pending','pending_admin','accepted','in_progress')
        and coalesce(rp.state,'') not in ('released','refunded','failed')
    );
$function$;
revoke all on function public.matmove_dispatch_driver_busy(uuid,uuid) from public, anon, authenticated;
grant execute on function public.matmove_dispatch_driver_busy(uuid,uuid) to service_role;

-- This function is the only allowed way to clear an accepted driver's
-- assignment before the trip starts. It never changes the booking ID,
-- payment amount, payer, escrow account, or original hold/reserve.
create or replace function public.matmove_driver_cancel_and_redispatch(
  p_booking_id uuid,
  p_driver_id uuid,
  p_reason text default 'driver_unavailable'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  rp public.ride_payments%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  reserve_leg public.matmove_cash_ride_legs%rowtype;
  existing_assignment public.matmove_ride_driver_assignments%rowtype;
  v_reason text;
begin
  if p_booking_id is null or p_driver_id is null then
    raise exception 'INVALID: Booking and driver are required.';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason),''),'driver_unavailable');
  if length(v_reason) > 300 then raise exception 'INVALID: Cancellation reason is too long.'; end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;

  if not exists (
    select 1 from public.profiles p
    where p.id=p_driver_id and p.role='driver'
  ) then
    raise exception 'FORBIDDEN: An authenticated driver profile is required.';
  end if;

  -- A retry after a successful cancellation is idempotent only while the
  -- booking remains available for matching and has no replacement driver.
  if b.driver_id is null
     and b.status='pending'
     and p_driver_id = any(coalesce(b.matmove_excluded_driver_ids,'{}'::uuid[])) then
    select * into existing_assignment
    from public.matmove_ride_driver_assignments a
    where a.booking_id=b.id and a.driver_id=p_driver_id
      and a.assignment_status='driver_cancelled'
    order by a.assignment_no desc limit 1;
    if found then
      return jsonb_build_object(
        'redispatched',true,'reviewRequired',false,'idempotent',true,
        'booking',to_jsonb(b),'bookingId',b.id
      );
    end if;
  end if;

  if b.driver_id is distinct from p_driver_id then
    raise exception 'FORBIDDEN: Only the currently assigned driver can cancel this booking.';
  end if;

  if b.status in ('completed','cancelled') then
    raise exception 'INVALID_STATE: A completed or cancelled booking cannot be re-dispatched.';
  end if;

  -- Once started, never put another driver onto the same physical trip.
  -- Keep assignment and money intact and route the case to Admin review.
  if b.started_at is not null or b.status='in_progress' then
    insert into public.matmove_ride_investigation_tickets(
      booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at
    ) values (
      b.id,'driver_cancel_after_start_review',b.status,'open',
      clock_timestamp(),clock_timestamp(),
      jsonb_build_object('paymentMethod',b.payment_method,'driverId',p_driver_id,
        'reason',v_reason,'startedAt',b.started_at,'requiresPhysicalAndFinancialReview',true),
      clock_timestamp()
    )
    on conflict(booking_id) do update set
      reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,
      source_status=excluded.source_status,
      status='open',
      last_seen_at=clock_timestamp(),
      details=public.matmove_ride_investigation_tickets.details || excluded.details,
      updated_at=clock_timestamp();

    insert into public.matmove_ride_booking_events(
      booking_id,event_type,actor_id,actor_type,details
    ) values (
      b.id,'driver_cancel_after_start_review',p_driver_id,'driver',
      jsonb_build_object('reason',v_reason,'startedAt',b.started_at,'noRedispatch',true)
    );

    return jsonb_build_object(
      'redispatched',false,'reviewRequired',true,'idempotent',false,
      'booking',to_jsonb(b),'bookingId',b.id
    );
  end if;

  if b.status <> 'accepted' then
    raise exception 'INVALID_STATE: Only an accepted, not-yet-started booking can be re-dispatched.';
  end if;

  if b.payment_method='cash' then
    select * into cp from public.matmove_cash_ride_payments
      where booking_id=b.id for update;
    if not found or cp.driver_id is distinct from p_driver_id
       or cp.status <> 'fee_reserved'
       or cp.driver_cash_confirmed_at is not null
       or cp.rider_cash_confirmed_at is not null
       or cp.cash_return_status <> 'not_requested' then
      insert into public.matmove_ride_investigation_tickets(
        booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at
      ) values (
        b.id,'driver_cancel_cash_state_review',b.status,'open',
        clock_timestamp(),clock_timestamp(),
        jsonb_build_object('paymentMethod','cash','driverId',p_driver_id,
          'cashStatus',coalesce(cp.status,'missing'),'reason',v_reason,
          'requiresManualReconciliation',true),
        clock_timestamp()
      )
      on conflict(booking_id) do update set
        reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,source_status=excluded.source_status,
        status='open',last_seen_at=clock_timestamp(),
        details=public.matmove_ride_investigation_tickets.details || excluded.details,
        updated_at=clock_timestamp();
      insert into public.matmove_ride_booking_events(
        booking_id,event_type,actor_id,actor_type,details
      ) values (
        b.id,'driver_cancel_payment_review',p_driver_id,'driver',
        jsonb_build_object('paymentMethod','cash','reason',v_reason,'noRedispatch',true)
      );
      return jsonb_build_object('redispatched',false,'reviewRequired',true,'booking',to_jsonb(b),'bookingId',b.id);
    end if;

    select * into reserve_leg from public.matmove_cash_ride_legs
    where booking_id=b.id and leg_kind='reserve' for update;
    if not found or reserve_leg.status <> 'completed'
       or reserve_leg.verified_at is null
       or reserve_leg.verified_amount_minor is distinct from cp.matmove_fee_minor
       or reserve_leg.verified_currency is distinct from 'SLE' then
      insert into public.matmove_ride_investigation_tickets(
        booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at
      ) values (
        b.id,'driver_cancel_cash_reserve_review',b.status,'open',
        clock_timestamp(),clock_timestamp(),
        jsonb_build_object('paymentMethod','cash','driverId',p_driver_id,
          'reason',v_reason,'reserveStatus',coalesce(reserve_leg.status,'missing'),
          'requiresManualReconciliation',true),
        clock_timestamp()
      )
      on conflict(booking_id) do update set
        reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,source_status=excluded.source_status,
        status='open',last_seen_at=clock_timestamp(),
        details=public.matmove_ride_investigation_tickets.details || excluded.details,
        updated_at=clock_timestamp();
      return jsonb_build_object('redispatched',false,'reviewRequired',true,'booking',to_jsonb(b),'bookingId',b.id);
    end if;

  elsif b.payment_method='digital' then
    select * into rp from public.ride_payments
      where booking_id=b.id for update;
    if not found or rp.driver_id is distinct from p_driver_id or rp.state <> 'funded' then
      insert into public.matmove_ride_investigation_tickets(
        booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at
      ) values (
        b.id,'driver_cancel_digital_state_review',b.status,'open',
        clock_timestamp(),clock_timestamp(),
        jsonb_build_object('paymentMethod','digital','driverId',p_driver_id,
          'paymentState',coalesce(rp.state,'missing'),'reason',v_reason,
          'requiresManualReconciliation',true),
        clock_timestamp()
      )
      on conflict(booking_id) do update set
        reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,source_status=excluded.source_status,
        status='open',last_seen_at=clock_timestamp(),
        details=public.matmove_ride_investigation_tickets.details || excluded.details,
        updated_at=clock_timestamp();
      insert into public.matmove_ride_booking_events(
        booking_id,event_type,actor_id,actor_type,details
      ) values (
        b.id,'driver_cancel_payment_review',p_driver_id,'driver',
        jsonb_build_object('paymentMethod','digital','reason',v_reason,'noRedispatch',true)
      );
      return jsonb_build_object('redispatched',false,'reviewRequired',true,'booking',to_jsonb(b),'bookingId',b.id);
    end if;

    if not exists (
      select 1 from public.ride_payment_transfers t
      where t.booking_id=b.id and t.kind='hold'
        and t.status='completed' and t.provider_id is not null
    ) or exists (
      select 1 from public.ride_payment_transfers t
      where t.booking_id=b.id and t.kind in ('driver','fee','refund')
    ) then
      insert into public.matmove_ride_investigation_tickets(
        booking_id,reason_code,source_status,status,first_seen_at,last_seen_at,details,updated_at
      ) values (
        b.id,'driver_cancel_digital_transfer_review',b.status,'open',
        clock_timestamp(),clock_timestamp(),
        jsonb_build_object('paymentMethod','digital','driverId',p_driver_id,
          'reason',v_reason,'requiresManualReconciliation',true),
        clock_timestamp()
      )
      on conflict(booking_id) do update set
        reason_code=case when coalesce(public.matmove_ride_investigation_tickets.details->>'adminPaymentReview','false')='true' then public.matmove_ride_investigation_tickets.reason_code else excluded.reason_code end,source_status=excluded.source_status,
        status='open',last_seen_at=clock_timestamp(),
        details=public.matmove_ride_investigation_tickets.details || excluded.details,
        updated_at=clock_timestamp();
      insert into public.matmove_ride_booking_events(
        booking_id,event_type,actor_id,actor_type,details
      ) values (
        b.id,'driver_cancel_transfer_review',p_driver_id,'driver',
        jsonb_build_object('reason',v_reason,'noRedispatch',true)
      );
      return jsonb_build_object('redispatched',false,'reviewRequired',true,'booking',to_jsonb(b),'bookingId',b.id);
    end if;
  else
    raise exception 'INVALID_STATE: This booking payment method cannot use driver re-dispatch.';
  end if;

  -- The flag is transaction-local and is consumed by the assignment-history
  -- trigger. The cash-ledger guard then verifies the closed assignment row.
  perform set_config('matmove.driver_cancelled','true',true);
  update public.bookings
  set driver_id=null,
      status='pending',
      matmove_excluded_driver_ids=array(
        select distinct excluded_id
        from unnest(coalesce(matmove_excluded_driver_ids,'{}'::uuid[]) || array[p_driver_id]) excluded_id
      ),
      updated_at=clock_timestamp()
  where id=b.id
  returning * into b;

  if b.payment_method='cash' then
    update public.matmove_cash_ride_payments
    set driver_id=null
    where booking_id=b.id;
  end if;

  insert into public.matmove_ride_booking_events(
    booking_id,event_type,actor_id,actor_type,details
  ) values (
    b.id,'booking_redispatched',p_driver_id,'driver',
    jsonb_build_object('previousDriverId',p_driver_id,'reason',v_reason,
      'paymentMethod',b.payment_method,'sameBookingId',true,
      'paymentOrReserveReused',true)
  );

  return jsonb_build_object(
    'redispatched',true,'reviewRequired',false,'idempotent',false,
    'booking',to_jsonb(b),'bookingId',b.id,
    'paymentOrReserveReused',true
  );
end;
$function$;

revoke all on function public.matmove_driver_cancel_and_redispatch(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.matmove_driver_cancel_and_redispatch(uuid,uuid,text) to service_role;

-- Assign a replacement digital driver only against the original, verified
-- hold. The old driver's payout beneficiary is replaced before any payout leg
-- can be created; no new hold or charge is inserted.
create or replace function public.matmove_redispatch_assign_digital_driver(
  p_booking_id uuid,
  p_driver_id uuid,
  p_driver_account text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  p public.ride_payments%rowtype;
  eligibility jsonb;
begin
  if p_booking_id is null or p_driver_id is null
     or p_driver_account is null or p_driver_account !~ '^fac-[A-Za-z0-9_-]+
    raise exception 'INVALID: A booking, driver and verified SLE financial account are required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if b.payment_method <> 'digital' or b.status <> 'pending'
     or b.driver_id is not null or b.started_at is not null then
    raise exception 'INVALID_STATE: This digital booking is not waiting for a replacement driver.';
  end if;
  if b.rider_id = p_driver_id
     or p_driver_id = any(coalesce(b.matmove_excluded_driver_ids,'{}'::uuid[]))
     or exists(
       select 1 from public.matmove_ride_driver_assignments a
       where a.booking_id=b.id and a.driver_id=p_driver_id
         and a.assignment_status='driver_cancelled'
     ) then
    raise exception 'REDISPATCH_DRIVER_EXCLUDED: The cancelling driver cannot accept this same booking again.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver_id::text,0));
  eligibility := public.matmove_dispatch_driver_status(p_driver_id,p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %',eligibility->>'reason';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id=p_driver_id and pr.role='driver' and pr.kyc_status='approved'
      and not coalesce((to_jsonb(pr)->>'is_wallet_frozen')::boolean,false)
  ) or not exists (
    select 1 from public.wallets w
    where w.user_id=p_driver_id and w.currency='SLE'
      and coalesce(w.monime_account_id,w.metadata->>'monime_account_id')=p_driver_account
      and not coalesce(w.is_frozen,false)
  ) then
    raise exception 'FORBIDDEN: A verified, approved, unfrozen driver SLE wallet is required.';
  end if;

  select * into p from public.ride_payments where booking_id=b.id for update;
  if not found or p.state <> 'funded'
     or not exists (
       select 1 from public.ride_payment_transfers t
       where t.booking_id=b.id and t.kind='hold'
         and t.status='completed' and t.provider_id is not null
     )
     or exists (
       select 1 from public.ride_payment_transfers t
       where t.booking_id=b.id and t.kind in ('driver','fee','refund')
     ) then
    raise exception 'PAYMENT_PENDING: The original escrow hold must be fully verified with no payout or refund legs before re-dispatch.';
  end if;

  if p_driver_account in (p.payer_account,p.escrow_account,p.fee_account) then
    raise exception 'ACCOUNT_CHANGED: The replacement driver wallet must be separate from the payer and platform financial accounts.';
  end if;

  update public.ride_payments
  set driver_id=p_driver_id,driver_account=p_driver_account,updated_at=clock_timestamp()
  where booking_id=b.id
  returning * into p;

  update public.bookings
  set driver_id=p_driver_id,status='accepted',updated_at=clock_timestamp()
  where id=b.id
  returning * into b;

  return jsonb_build_object(
    'booking',to_jsonb(b),'payment',to_jsonb(p),
    'reassigned',true,'holdReused',true,'newChargeCreated',false
  );
end;
$function$;
revoke all on function public.matmove_redispatch_assign_digital_driver(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.matmove_redispatch_assign_digital_driver(uuid,uuid,text) to service_role;

-- Cash assignment is still serialized by driver advisory lock and reuses the
-- one verified 15% reserve. A driver removed from this booking is excluded.
create or replace function public.matmove_cash_ride_assign_driver(
  p_booking_id uuid,
  p_driver_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
  eligibility jsonb;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments
  where booking_id=p_booking_id for update;
  if not found or p.status <> 'fee_reserved' or b.status <> 'pending' then
    raise exception 'CASH_FEE_NOT_RESERVED: Cash fee must be reserved before driver acceptance.';
  end if;

  select * into reserve from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind='reserve' for key share;
  if not found or reserve.status <> 'completed'
     or reserve.verified_at is null
     or reserve.verified_amount_minor is distinct from p.matmove_fee_minor
     or reserve.verified_currency is distinct from 'SLE' then
    raise exception 'CASH_FEE_NOT_RESERVED: A verified fee reserve is required.';
  end if;

  if p_driver_id is null or p_driver_id=p.rider_id
     or p_driver_id=any(coalesce(b.matmove_excluded_driver_ids,'{}'::uuid[]))
     or exists (
       select 1 from public.matmove_ride_driver_assignments a
       where a.booking_id=b.id and a.driver_id=p_driver_id
         and a.assignment_status='driver_cancelled'
     ) then
    raise exception 'FORBIDDEN: Choose a different approved driver.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver_id::text,0));
  eligibility := public.matmove_dispatch_driver_status(p_driver_id,p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %',eligibility->>'reason';
  end if;

  if b.driver_id is not null and b.driver_id is distinct from p_driver_id then
    raise exception 'CONFLICT: Another driver is already assigned.';
  end if;

  update public.bookings
  set driver_id=p_driver_id,status='accepted',updated_at=clock_timestamp()
  where id=p_booking_id
  returning * into b;

  update public.matmove_cash_ride_payments
  set driver_id=p_driver_id,updated_at=clock_timestamp()
  where booking_id=p_booking_id
  returning * into p;

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,actor_profile_id,details
  ) values (
    p_booking_id,'driver_assigned','driver',p_driver_id,
    jsonb_build_object('driverId',p_driver_id)
  );

  return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(p));
end;
$function$;
revoke all on function public.matmove_cash_ride_assign_driver(uuid,uuid) from public, anon, authenticated;
grant execute on function public.matmove_cash_ride_assign_driver(uuid,uuid) to service_role;

-- Preserve every cash ledger invariant. The sole exception is clearing the
-- current driver after the atomic driver-cancel transaction has already moved
-- the booking to pending and closed that driver's assignment history.
create or replace function public.matmove_cash_ride_payment_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_booking_driver_id uuid;
  v_booking_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'CASH_LEDGER_IMMUTABLE: Cash ride payment records cannot be deleted.';
  end if;

  if old.driver_id is null and new.driver_id is not null then
    select b.driver_id into v_booking_driver_id
    from public.bookings b
    where b.id=old.booking_id for key share;
    if not found or v_booking_driver_id is distinct from new.driver_id then
      raise exception 'CASH_DRIVER_ASSIGNMENT_MISMATCH: Cash ride driver must match the booking assignment.';
    end if;
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.rider_id is distinct from old.rider_id
     or new.fare_minor is distinct from old.fare_minor
     or new.driver_cash_minor is distinct from old.driver_cash_minor
     or new.matmove_fee_minor is distinct from old.matmove_fee_minor
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'CASH_LEDGER_IMMUTABLE: Booking identity and quoted fare fields cannot be changed.';
  end if;

  if old.driver_id is not null and new.driver_id is distinct from old.driver_id then
    select b.driver_id,b.status into v_booking_driver_id,v_booking_status
    from public.bookings b where b.id=old.booking_id for key share;
    if new.driver_id is not null
       or old.status <> 'fee_reserved'
       or new.status <> 'fee_reserved'
       or old.driver_cash_confirmed_at is not null
       or new.driver_cash_confirmed_at is not null
       or old.rider_cash_confirmed_at is not null
       or new.rider_cash_confirmed_at is not null
       or old.cash_return_status <> 'not_requested'
       or new.cash_return_status <> 'not_requested'
       or v_booking_driver_id is not null
       or v_booking_status <> 'pending'
       or not exists (
         select 1 from public.matmove_ride_driver_assignments a
         where a.booking_id=old.booking_id and a.driver_id=old.driver_id
           and a.assignment_status='driver_cancelled'
       ) then
      raise exception 'CASH_DRIVER_IMMUTABLE: A cash driver can only be cleared by the verified pre-start cancellation transaction.';
    end if;
  end if;

  if old.driver_cash_confirmed_at is not null
     and (new.driver_cash_confirmed_at is distinct from old.driver_cash_confirmed_at
       or new.driver_cash_confirmed_by is distinct from old.driver_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Driver cash confirmation cannot be overwritten.';
  end if;

  if old.rider_cash_confirmed_at is not null
     and (new.rider_cash_confirmed_at is distinct from old.rider_cash_confirmed_at
       or new.rider_cash_confirmed_by is distinct from old.rider_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Rider cash confirmation cannot be overwritten.';
  end if;

  if old.manual_resolution_at is not null
     and (new.manual_resolution_at is distinct from old.manual_resolution_at
       or new.manual_resolution_by is distinct from old.manual_resolution_by
       or new.manual_resolution_note is distinct from old.manual_resolution_note) then
    raise exception 'CASH_RESOLUTION_IMMUTABLE: A recorded manual resolution cannot be overwritten.';
  end if;

  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$function$;
revoke all on function public.matmove_cash_ride_payment_guard() from public, anon, authenticated;

commit;
 then
    raise exception 'INVALID: A booking, driver and verified SLE financial account are required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if b.payment_method <> 'digital' or b.status <> 'pending'
     or b.driver_id is not null or b.started_at is not null then
    raise exception 'INVALID_STATE: This digital booking is not waiting for a replacement driver.';
  end if;
  if b.rider_id = p_driver_id
     or p_driver_id = any(coalesce(b.matmove_excluded_driver_ids,'{}'::uuid[]))
     or exists(
       select 1 from public.matmove_ride_driver_assignments a
       where a.booking_id=b.id and a.driver_id=p_driver_id
         and a.assignment_status='driver_cancelled'
     ) then
    raise exception 'REDISPATCH_DRIVER_EXCLUDED: The cancelling driver cannot accept this same booking again.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver_id::text,0));
  eligibility := public.matmove_dispatch_driver_status(p_driver_id,p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %',eligibility->>'reason';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id=p_driver_id and pr.role='driver' and pr.kyc_status='approved'
      and not coalesce(pr.is_wallet_frozen,false)
  ) or not exists (
    select 1 from public.wallets w
    where w.user_id=p_driver_id and w.currency='SLE'
      and coalesce(w.monime_account_id,w.metadata->>'monime_account_id')=p_driver_account
      and not coalesce(w.is_frozen,false)
  ) then
    raise exception 'FORBIDDEN: A verified, approved, unfrozen driver SLE wallet is required.';
  end if;

  select * into p from public.ride_payments where booking_id=b.id for update;
  if not found or p.state <> 'funded'
     or not exists (
       select 1 from public.ride_payment_transfers t
       where t.booking_id=b.id and t.kind='hold'
         and t.status='completed' and t.provider_id is not null
     )
     or exists (
       select 1 from public.ride_payment_transfers t
       where t.booking_id=b.id and t.kind in ('driver','fee','refund')
     ) then
    raise exception 'PAYMENT_PENDING: The original escrow hold must be fully verified with no payout or refund legs before re-dispatch.';
  end if;

  if p_driver_account in (p.payer_account,p.escrow_account,p.fee_account) then
    raise exception 'ACCOUNT_CHANGED: The replacement driver wallet must be separate from the payer and platform financial accounts.';
  end if;

  update public.ride_payments
  set driver_id=p_driver_id,driver_account=p_driver_account,updated_at=clock_timestamp()
  where booking_id=b.id
  returning * into p;

  update public.bookings
  set driver_id=p_driver_id,status='accepted',updated_at=clock_timestamp()
  where id=b.id
  returning * into b;

  return jsonb_build_object(
    'booking',to_jsonb(b),'payment',to_jsonb(p),
    'reassigned',true,'holdReused',true,'newChargeCreated',false
  );
end;
$function$;
revoke all on function public.matmove_redispatch_assign_digital_driver(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.matmove_redispatch_assign_digital_driver(uuid,uuid,text) to service_role;

-- Cash assignment is still serialized by driver advisory lock and reuses the
-- one verified 15% reserve. A driver removed from this booking is excluded.
create or replace function public.matmove_cash_ride_assign_driver(
  p_booking_id uuid,
  p_driver_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  b public.bookings%rowtype;
  p public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
  eligibility jsonb;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.payment_method <> 'cash' then
    raise exception 'NOT_FOUND: Cash ride booking not found.';
  end if;

  select * into p from public.matmove_cash_ride_payments
  where booking_id=p_booking_id for update;
  if not found or p.status <> 'fee_reserved' or b.status <> 'pending' then
    raise exception 'CASH_FEE_NOT_RESERVED: Cash fee must be reserved before driver acceptance.';
  end if;

  select * into reserve from public.matmove_cash_ride_legs
  where booking_id=p_booking_id and leg_kind='reserve' for key share;
  if not found or reserve.status <> 'completed'
     or reserve.verified_at is null
     or reserve.verified_amount_minor is distinct from p.matmove_fee_minor
     or reserve.verified_currency is distinct from 'SLE' then
    raise exception 'CASH_FEE_NOT_RESERVED: A verified fee reserve is required.';
  end if;

  if p_driver_id is null or p_driver_id=p.rider_id
     or p_driver_id=any(coalesce(b.matmove_excluded_driver_ids,'{}'::uuid[]))
     or exists (
       select 1 from public.matmove_ride_driver_assignments a
       where a.booking_id=b.id and a.driver_id=p_driver_id
         and a.assignment_status='driver_cancelled'
     ) then
    raise exception 'FORBIDDEN: Choose a different approved driver.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-dispatch-driver:'||p_driver_id::text,0));
  eligibility := public.matmove_dispatch_driver_status(p_driver_id,p_booking_id);
  if eligibility->>'eligible' is distinct from 'true' then
    raise exception 'FORBIDDEN: Driver is not eligible. %',eligibility->>'reason';
  end if;

  if b.driver_id is not null and b.driver_id is distinct from p_driver_id then
    raise exception 'CONFLICT: Another driver is already assigned.';
  end if;

  update public.bookings
  set driver_id=p_driver_id,status='accepted',updated_at=clock_timestamp()
  where id=p_booking_id
  returning * into b;

  update public.matmove_cash_ride_payments
  set driver_id=p_driver_id,updated_at=clock_timestamp()
  where booking_id=p_booking_id
  returning * into p;

  insert into public.matmove_cash_ride_audit_events(
    booking_id,event_type,actor_type,actor_profile_id,details
  ) values (
    p_booking_id,'driver_assigned','driver',p_driver_id,
    jsonb_build_object('driverId',p_driver_id)
  );

  return jsonb_build_object('booking',to_jsonb(b),'payment',to_jsonb(p));
end;
$function$;
revoke all on function public.matmove_cash_ride_assign_driver(uuid,uuid) from public, anon, authenticated;
grant execute on function public.matmove_cash_ride_assign_driver(uuid,uuid) to service_role;

-- Preserve every cash ledger invariant. The sole exception is clearing the
-- current driver after the atomic driver-cancel transaction has already moved
-- the booking to pending and closed that driver's assignment history.
create or replace function public.matmove_cash_ride_payment_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_booking_driver_id uuid;
  v_booking_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'CASH_LEDGER_IMMUTABLE: Cash ride payment records cannot be deleted.';
  end if;

  if old.driver_id is null and new.driver_id is not null then
    select b.driver_id into v_booking_driver_id
    from public.bookings b
    where b.id=old.booking_id for key share;
    if not found or v_booking_driver_id is distinct from new.driver_id then
      raise exception 'CASH_DRIVER_ASSIGNMENT_MISMATCH: Cash ride driver must match the booking assignment.';
    end if;
  end if;

  if new.booking_id is distinct from old.booking_id
     or new.rider_id is distinct from old.rider_id
     or new.fare_minor is distinct from old.fare_minor
     or new.driver_cash_minor is distinct from old.driver_cash_minor
     or new.matmove_fee_minor is distinct from old.matmove_fee_minor
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'CASH_LEDGER_IMMUTABLE: Booking identity and quoted fare fields cannot be changed.';
  end if;

  if old.driver_id is not null and new.driver_id is distinct from old.driver_id then
    select b.driver_id,b.status into v_booking_driver_id,v_booking_status
    from public.bookings b where b.id=old.booking_id for key share;
    if new.driver_id is not null
       or old.status <> 'fee_reserved'
       or new.status <> 'fee_reserved'
       or old.driver_cash_confirmed_at is not null
       or new.driver_cash_confirmed_at is not null
       or old.rider_cash_confirmed_at is not null
       or new.rider_cash_confirmed_at is not null
       or old.cash_return_status <> 'not_requested'
       or new.cash_return_status <> 'not_requested'
       or v_booking_driver_id is not null
       or v_booking_status <> 'pending'
       or not exists (
         select 1 from public.matmove_ride_driver_assignments a
         where a.booking_id=old.booking_id and a.driver_id=old.driver_id
           and a.assignment_status='driver_cancelled'
       ) then
      raise exception 'CASH_DRIVER_IMMUTABLE: A cash driver can only be cleared by the verified pre-start cancellation transaction.';
    end if;
  end if;

  if old.driver_cash_confirmed_at is not null
     and (new.driver_cash_confirmed_at is distinct from old.driver_cash_confirmed_at
       or new.driver_cash_confirmed_by is distinct from old.driver_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Driver cash confirmation cannot be overwritten.';
  end if;

  if old.rider_cash_confirmed_at is not null
     and (new.rider_cash_confirmed_at is distinct from old.rider_cash_confirmed_at
       or new.rider_cash_confirmed_by is distinct from old.rider_cash_confirmed_by) then
    raise exception 'CASH_CONFIRMATION_IMMUTABLE: Rider cash confirmation cannot be overwritten.';
  end if;

  if old.manual_resolution_at is not null
     and (new.manual_resolution_at is distinct from old.manual_resolution_at
       or new.manual_resolution_by is distinct from old.manual_resolution_by
       or new.manual_resolution_note is distinct from old.manual_resolution_note) then
    raise exception 'CASH_RESOLUTION_IMMUTABLE: A recorded manual resolution cannot be overwritten.';
  end if;

  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$function$;
revoke all on function public.matmove_cash_ride_payment_guard() from public, anon, authenticated;

commit;
