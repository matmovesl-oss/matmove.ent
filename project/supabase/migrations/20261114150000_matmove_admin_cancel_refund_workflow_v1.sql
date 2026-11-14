begin;

-- Admin cancellation is a separately authorized, idempotent operation.
-- Paid bookings remain active until their provider refund receipt is verified.
create or replace function public.matmove_admin_cancel_booking(
  p_booking_id uuid,
  p_expected bigint,
  p_request_id uuid,
  p_note text,
  p_expected_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid;
  b public.bookings%rowtype;
  receipt public.matmove_dispatch_audit%rowtype;
  rp public.ride_payments%rowtype;
  cp public.matmove_cash_ride_payments%rowtype;
  reserve public.matmove_cash_ride_legs%rowtype;
  existing_refund public.ride_payment_transfers%rowtype;
  existing_cash_refund public.matmove_cash_ride_legs%rowtype;
  outcome text;
begin
  actor := public.matmove_dispatch_actor();
  if actor is distinct from p_expected_actor then
    raise exception 'FORBIDDEN: Your signed-in Admin account changed.';
  end if;
  if p_booking_id is null or p_request_id is null or p_expected is null
     or p_note is null or length(btrim(p_note)) not between 3 and 300 then
    raise exception 'INVALID: A booking, request key and dispatch note (3–300 characters) are required.';
  end if;

  select * into b from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;

  select * into receipt from public.matmove_dispatch_audit where request_id=p_request_id;
  if found then
    if receipt.actor_id<>actor or receipt.booking_id<>b.id or receipt.action<>'cancel'
       or receipt.expected_version<>p_expected or receipt.note<>btrim(p_note) then
      raise exception 'CONFLICT: This request key was already used for another Admin action.';
    end if;
    return jsonb_build_object('actor',actor,'applied',true,'requestId',receipt.request_id,
      'bookingId',b.id,'action','cancel','version',receipt.new_version::text,
      'bookingStatus',b.status,'refundStatus',case
        when exists(select 1 from public.ride_payments where booking_id=b.id and state='refunded') then 'refunded'
        when exists(select 1 from public.matmove_cash_ride_payments where booking_id=b.id and status='refunded') then 'refunded'
        when exists(select 1 from public.ride_payments where booking_id=b.id and state='refunding') then 'refund_pending'
        when exists(select 1 from public.matmove_cash_ride_payments where booking_id=b.id and status='refund_pending') then 'refund_pending'
        else 'not_required' end);
  end if;

  if b.matmove_dispatch_version is distinct from p_expected then
    raise exception 'CONFLICT: Booking changed. Refresh Dispatch before continuing.';
  end if;
  if b.status not in ('pending','pending_admin','cash_reserve_pending','accepted')
     or b.started_at is not null then
    raise exception 'INVALID_STATE: Only an unstarted, unfinished request can be cancelled by Dispatch.';
  end if;

  select * into cp from public.matmove_cash_ride_payments where booking_id=b.id for update;
  if found then
    if cp.status in ('reserve_ready','cancelled') then
      update public.matmove_cash_ride_legs
        set status='failed',error_code='admin_cancelled_before_reserve',updated_at=clock_timestamp()
        where booking_id=b.id and leg_kind='reserve' and status='ready' and attempted_at is null;
      update public.matmove_cash_ride_payments set status='cancelled',updated_at=clock_timestamp()
        where booking_id=b.id;
      update public.bookings set status='cancelled',updated_at=clock_timestamp()
        where id=b.id returning * into b;
      outcome := 'not_required';
    elsif cp.status='reserve_pending' then
      select * into reserve from public.matmove_cash_ride_legs
        where booking_id=b.id and leg_kind='reserve' for update;
      if not found or reserve.status not in ('completed') then
        raise exception 'PAYMENT_PENDING: Cash reserve is still being verified. Reconcile it, then retry Admin cancellation.';
      end if;
    end if;

    if cp.status='fee_reserved' then
      select * into reserve from public.matmove_cash_ride_legs
        where booking_id=b.id and leg_kind='reserve' for update;
      if not found or reserve.status<>'completed' then
        raise exception 'CASH_RESERVE_NOT_VERIFIED: The original fee reserve receipt must be verified before refunding.';
      end if;
      select * into existing_cash_refund from public.matmove_cash_ride_legs
        where booking_id=b.id and leg_kind='refund' for update;
      if not found then
        insert into public.matmove_cash_ride_legs(
          booking_id,leg_kind,amount_minor,currency,source_account_ref,
          destination_account_ref,request_key,status
        ) values (
          b.id,'refund',cp.matmove_fee_minor,'SLE',reserve.destination_account_ref,
          reserve.source_account_ref,'matmove-cash:'||b.id::text||':refund','ready'
        );
      end if;
      update public.matmove_cash_ride_payments set status='refund_pending',updated_at=clock_timestamp()
        where booking_id=b.id;
      insert into public.matmove_cash_ride_audit_events(
        booking_id,event_type,actor_type,actor_profile_id,details
      ) values(b.id,'refund_requested','admin',actor,
        jsonb_build_object('reason','admin_cancel','note',btrim(p_note)));
      outcome := 'refund_pending';
    elsif cp.status in ('refund_pending','refunded') then
      outcome := case when cp.status='refunded' then 'refunded' else 'refund_pending' end;
    elsif cp.status not in ('cancelled') then
      raise exception 'CASH_REVIEW_REQUIRED: Cash provider activity is uncertain. Keep the request open for manual reconciliation.';
    end if;
  else
    select * into rp from public.ride_payments where booking_id=b.id for update;
    if found then
      if rp.state in ('funded','refunding') then
        select * into existing_refund from public.ride_payment_transfers
          where booking_id=b.id and kind='refund' for update;
        if not found then
          insert into public.ride_payment_transfers(
            booking_id,kind,amount_minor,source_account,destination_account
          ) values(b.id,'refund',rp.fare_minor,rp.escrow_account,rp.payer_account);
        end if;
        update public.ride_payments set state='refunding',updated_at=clock_timestamp()
          where booking_id=b.id;
        outcome := 'refund_pending';
      elsif rp.state='failed' then
        update public.bookings set status='cancelled',updated_at=clock_timestamp()
          where id=b.id returning * into b;
        outcome := 'not_required';
      elsif rp.state='funding' then
        update public.ride_payment_transfers
          set status='failed',error='Admin cancelled before escrow funding attempt.',updated_at=clock_timestamp()
          where booking_id=b.id and kind='hold' and status='ready' and attempted_at is null;
        if found then
          update public.ride_payments set state='failed',updated_at=clock_timestamp()
            where booking_id=b.id;
          update public.bookings set status='cancelled',updated_at=clock_timestamp()
            where id=b.id returning * into b;
          outcome := 'not_required';
        else
          raise exception 'PAYMENT_PENDING: Escrow funding has already been attempted. Reconcile the existing transfer, then retry Admin cancellation.';
        end if;
      else
        raise exception 'INVALID_STATE: This payment is not eligible for an automatic Admin refund. Manual reconciliation is required.';
      end if;
    else
      update public.bookings set status='cancelled',updated_at=clock_timestamp()
        where id=b.id returning * into b;
      outcome := 'not_required';
    end if;
  end if;

  insert into public.matmove_dispatch_audit(
    request_id,actor_id,booking_id,action,driver_id,expected_version,
    new_version,note,before_record,after_record
  ) values(
    p_request_id,actor,b.id,'cancel',null,p_expected,b.matmove_dispatch_version,
    btrim(p_note),
    jsonb_build_object('status',case when outcome='not_required' then 'cancelled' else 'refund_requested' end,
      'paymentMethod',b.payment_method),
    jsonb_build_object('status',b.status,'refundStatus',outcome,'note',btrim(p_note))
  );

  return jsonb_build_object('actor',actor,'applied',true,'requestId',p_request_id,
    'bookingId',b.id,'action','cancel','version',b.matmove_dispatch_version::text,
    'bookingStatus',b.status,'refundStatus',outcome);
end;
$function$;

revoke all on function public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid) from public, anon;
grant execute on function public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid) to authenticated;

comment on function public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid) is
  'Dispatch-authorized cancellation of unstarted bookings. Refunds are idempotently queued and bookings are not marked cancelled until the provider receipt is verified.';

commit;
