begin;

-- A ticket can outlive the booking-status transition that originally attempted
-- to resolve it. Re-check the complete financial and physical-cash state
-- whenever either payment ledger changes, not only when bookings are updated.
create or replace function public.matmove_resolve_ride_investigation_if_safe(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  booking_status text;
begin
  select b.status into booking_status
  from public.bookings b
  where b.id=p_booking_id;

  if not found or booking_status not in ('completed','cancelled') then
    return;
  end if;

  if exists(
    select 1 from public.ride_payments rp
    where rp.booking_id=p_booking_id and rp.state='refunding'
  ) then
    return;
  end if;

  if exists(
    select 1 from public.matmove_cash_ride_payments cp
    where cp.booking_id=p_booking_id
      and (
        cp.status in ('refund_pending','collection_pending','review_required')
        or (booking_status='cancelled' and cp.status not in ('refunded','cancelled'))
        or (booking_status='completed' and cp.status<>'settled')
        or (booking_status='cancelled' and cp.driver_id is not null and cp.cash_return_status<>'refunded')
      )
  ) then
    return;
  end if;

  update public.matmove_ride_investigation_tickets
  set status='resolved',updated_at=clock_timestamp()
  where booking_id=p_booking_id and status<>'resolved';
end;
$function$;

revoke all on function public.matmove_resolve_ride_investigation_if_safe(uuid) from public,anon,authenticated;

-- Keep the existing booking trigger, but make it use the same authoritative
-- resolver as payment-ledger updates.
create or replace function public.matmove_resolve_terminal_ride_investigation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  perform public.matmove_resolve_ride_investigation_if_safe(new.id);
  return new;
end;
$function$;

create or replace function public.matmove_resolve_ride_investigation_after_cash_payment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  perform public.matmove_resolve_ride_investigation_if_safe(new.booking_id);
  return new;
end;
$function$;

create or replace function public.matmove_resolve_ride_investigation_after_digital_payment()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
begin
  perform public.matmove_resolve_ride_investigation_if_safe(new.booking_id);
  return new;
end;
$function$;

drop trigger if exists matmove_resolve_ride_investigation_after_cash_payment on public.matmove_cash_ride_payments;
create trigger matmove_resolve_ride_investigation_after_cash_payment
after update of status,cash_return_status on public.matmove_cash_ride_payments
for each row
execute function public.matmove_resolve_ride_investigation_after_cash_payment();

drop trigger if exists matmove_resolve_ride_investigation_after_digital_payment on public.ride_payments;
create trigger matmove_resolve_ride_investigation_after_digital_payment
after update of state on public.ride_payments
for each row
execute function public.matmove_resolve_ride_investigation_after_digital_payment();

-- When a verified fee-reserve refund completes for a cash review with no
-- assigned driver, close the booking. If a driver was assigned, both parties
-- must have completed the physical cash-return confirmation first.
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
    'status in (''cash_reserve_pending'',''pending'',''accepted'') or (status=''in_progress''',
    'status in (''cash_reserve_pending'',''pending_admin'',''pending'',''accepted'') or (status=''cash_review_required'' and exists(select 1 from public.matmove_cash_ride_payments cpr where cpr.booking_id=p_booking_id and cpr.status=''refunded'' and (cpr.driver_id is null or cpr.cash_return_status=''refunded''))) or (status=''in_progress'''
  );
  if v_updated=v_definition
     and position('status=''cash_review_required'' and exists' in v_definition)=0 then
    raise exception 'Verified cash-review refund booking transition could not be safely extended.';
  end if;
  execute v_updated;
end;
$patch$;

-- Repair already-refunded cash reviews left open by the previous transition.
-- This update fires the booking trigger above, which resolves only safe cases.
update public.bookings b
set status='cancelled',updated_at=clock_timestamp()
from public.matmove_cash_ride_payments cp
where cp.booking_id=b.id
  and cp.status='refunded'
  and b.status='cash_review_required'
  and (cp.driver_id is null or cp.cash_return_status='refunded');

commit;
