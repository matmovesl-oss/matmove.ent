create or replace function public.matmove_admin_flag_unpaid_ride(
  p_booking_id uuid,
  p_note text,
  p_expected_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  ticket_id uuid;
  reason text := 'admin_unpaid_payment_review';
  cash_fare_review boolean := false;
begin
  actor := public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then
    raise exception 'FORBIDDEN: Your signed-in Admin account changed.';
  end if;

  if p_booking_id is null or p_note is null or length(btrim(p_note)) not between 3 and 300 then
    raise exception 'INVALID: A booking and review note (3–300 characters) are required.';
  end if;

  select * into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: Booking not found.';
  end if;

  if b.status in ('completed','cancelled') then
    raise exception 'INVALID_STATE: A completed or cancelled request cannot be flagged as an active unpaid request.';
  end if;

  if exists(select 1 from public.ride_payments where booking_id = b.id) then
    raise exception 'PAYMENT_LEDGER_EXISTS: This request has a digital payment ledger. Open its payment investigation instead of flagging it as unpaid.';
  end if;

  select * into cp
  from public.matmove_cash_ride_payments
  where booking_id = b.id
  for update;

  if found then
    -- A cash fee reserve is not the driver's physical fare. Only allow an
    -- unpaid-cash-fare flag once a driver is assigned and the ride is active,
    -- while the driver has not confirmed receiving the physical fare.
    if b.payment_method <> 'cash'
       or b.status <> 'in_progress'
       or b.driver_id is null
       or cp.status <> 'collection_pending'
       or cp.driver_cash_confirmed_at is not null then
      raise exception 'PAYMENT_LEDGER_EXISTS: This cash ledger is not an unpaid driver-fare state. Review its collection or return status instead.';
    end if;
    cash_fare_review := true;
    reason := 'admin_unpaid_cash_fare_review';
  end if;

  insert into public.matmove_ride_investigation_tickets(
    booking_id, reason_code, source_status, status,
    first_seen_at, last_seen_at, details, updated_at
  )
  values(
    b.id, reason, b.status, 'open',
    clock_timestamp(), clock_timestamp(),
    jsonb_build_object(
      'adminPaymentReview', true,
      'adminUnpaidCashFareReview', cash_fare_review,
      'flaggedBy', actor,
      'flaggedAt', clock_timestamp(),
      'adminNote', btrim(p_note),
      'paymentMethod', b.payment_method,
      'driverAssigned', b.driver_id is not null,
      'driverCashConfirmed', case when cash_fare_review then cp.driver_cash_confirmed_at is not null else null end,
      'customerCashConfirmed', case when cash_fare_review then cp.rider_cash_confirmed_at is not null else null end
    ),
    clock_timestamp()
  )
  on conflict(booking_id) do update
  set reason_code = excluded.reason_code,
      source_status = excluded.source_status,
      status = 'open',
      last_seen_at = clock_timestamp(),
      details = public.matmove_ride_investigation_tickets.details || excluded.details,
      updated_at = clock_timestamp()
  returning id into ticket_id;

  return jsonb_build_object(
    'actor', actor,
    'bookingId', b.id,
    'ticketId', ticket_id,
    'flagged', true,
    'reasonCode', reason,
    'status', 'open'
  );
end;
$function$;
