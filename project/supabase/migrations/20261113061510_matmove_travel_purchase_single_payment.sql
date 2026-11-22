-- Prevent multiple non-failed travel purchase attempts from charging the same booking.
-- A failed provider transfer may be retried; pending, processing, completed and
-- review-required attempts remain unique so a second idempotency key cannot
-- create a second charge for one booking.
begin;

create unique index if not exists matmove_travel_purchase_booking_once
  on public.matmove_purchase_payments (booking_id)
  where purchase_type = 'travel'
    and booking_id is not null
    and state in ('initiating', 'pending', 'processing', 'completed', 'review_required');

create or replace function public.matmove_fulfill_purchase_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  p public.matmove_purchase_payments%rowtype;
  b public.travel_bookings%rowtype;
  e public.platform_events%rowtype;
  v_ticket_id uuid;
begin
  select * into p
  from public.matmove_purchase_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: MatMove payment request not found.';
  end if;

  if p.provider_status <> 'completed' then
    raise exception 'PAYMENT_PENDING: Monime has not confirmed this transfer as completed.';
  end if;

  if p.state not in ('processing', 'completed') then
    raise exception 'INVALID_STATE: Purchase payment is not eligible for fulfilment.';
  end if;

  if p.state = 'completed' and p.fulfilled_at is not null then
    return jsonb_build_object(
      'fulfilled', true,
      'payment_id', p.id,
      'purchase_type', p.purchase_type
    );
  end if;

  if p.purchase_type = 'travel' then
    select * into b
    from public.travel_bookings
    where id = p.booking_id and user_id = p.user_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: Matching travel booking not found.';
    end if;

    if b.is_paid and b.payment_id is distinct from p.id then
      raise exception 'CONFLICT: This travel booking has already been paid by another MatMove payment.';
    end if;

    if b.payment_id is not null and b.payment_id is distinct from p.id then
      raise exception 'CONFLICT: This travel booking is already linked to another MatMove payment.';
    end if;

    if b.payment_id = p.id and b.is_paid then
      null;
    else
      update public.travel_bookings
      set is_paid = true, payment_id = p.id
      where id = p.booking_id and user_id = p.user_id;
    end if;

  elsif p.purchase_type = 'event' then
    select * into e
    from public.platform_events
    where id = p.event_id
    for share;

    if not found or e.is_active is not true then
      raise exception 'INVALID_STATE: Event is not active.';
    end if;

    select id into v_ticket_id
    from public.event_tickets
    where payment_id = p.id;

    if v_ticket_id is null then
      insert into public.event_tickets (
        event_id, user_id, user_phone, ticket_code, tickets_count,
        amount_paid, status, payment_id
      ) values (
        p.event_id,
        p.user_id,
        p.user_phone,
        'TKT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
        p.quantity,
        p.amount_minor::numeric / 100,
        'confirmed',
        p.id
      ) returning id into v_ticket_id;
    end if;
  end if;

  update public.matmove_purchase_payments
  set state = 'completed',
      fulfilled_at = coalesce(fulfilled_at, now()),
      failure_detail = null,
      updated_at = now()
  where id = p.id;

  return jsonb_build_object(
    'fulfilled', true,
    'payment_id', p.id,
    'purchase_type', p.purchase_type,
    'ticket_id', v_ticket_id
  );
end;
$function$;

revoke all on function public.matmove_fulfill_purchase_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.matmove_fulfill_purchase_payment(uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
