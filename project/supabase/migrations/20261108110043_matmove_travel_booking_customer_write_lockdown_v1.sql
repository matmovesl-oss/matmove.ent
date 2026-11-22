
-- Prevent customer-controlled payment, fare, approval and boarding fields.
-- Keep the existing AdminTravelPage workflow, but require its matching permissions.

create or replace function public.matmove_guard_travel_booking_write_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  actor_id uuid := auth.uid();
  customer_role text;
  can_manifest boolean := false;
  can_board boolean := false;
begin
  -- Trusted server/database operations (purchase fulfilment, reconciliation,
  -- migrations and administrative maintenance) remain server-controlled.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if actor_id is null then
    raise exception 'AUTH: Sign in before changing a travel booking.';
  end if;

  if tg_op = 'INSERT' then
    select p.role::text
      into customer_role
    from public.profiles p
    where p.id = actor_id;

    if customer_role in ('rider', 'driver', 'merchant')
       and not exists (
         select 1
         from public.matmove_staff_access a
         where a.id = actor_id
           and a.is_active = true
           and a.removed_at is null
       ) then
      if new.user_id is distinct from actor_id then
        raise exception 'FORBIDDEN: You may only create your own travel booking.';
      end if;
    elsif public.matmove_admin_can('travel.manifest')
          and new.user_id is not null
          and exists (
            select 1 from public.profiles p
            where p.id = new.user_id
              and p.role::text in ('rider', 'driver', 'merchant')
          ) then
      -- Admin-created passenger records must still start unpaid and unboarded.
      null;
    else
      raise exception 'FORBIDDEN: Customer travel booking access is required.';
    end if;

    -- Never accept client-supplied financial, approval or boarding state.
    new.status := 'pending_approval';
    new.is_paid := false;
    new.payment_id := null;
    new.boarded_at := null;
    new.boarded_by := null;
    new.admin_notes := null;
    new.cancel_reason := null;
    new.cancel_requested_at := null;
    new.fare_amount := 0;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Admin manifest actions: approval, rejection and cancellation approval.
    can_manifest := public.matmove_admin_can('travel.manifest');

    if can_manifest
       and (
         (old.status = 'pending_approval' and new.status in ('approved', 'rejected'))
         or (old.status = 'cancel_requested' and new.status = 'cancelled')
       )
       and (
         (to_jsonb(new) - array['status', 'admin_notes'])
         is not distinct from
         (to_jsonb(old) - array['status', 'admin_notes'])
       ) then
      return new;
    end if;

    -- Boarding is a separate permission and requires a paid, approved booking.
    can_board := public.matmove_admin_can('travel.boarding');

    if can_board
       and old.status = 'approved'
       and old.is_paid = true
       and old.boarded_at is null
       and new.status = 'boarded'
       and (
         (to_jsonb(new) - array['status', 'boarded_at', 'boarded_by'])
         is not distinct from
         (to_jsonb(old) - array['status', 'boarded_at', 'boarded_by'])
       ) then
      new.boarded_at := clock_timestamp();
      new.boarded_by := actor_id;
      return new;
    end if;

    -- A customer may request cancellation, but cannot approve it, refund it,
    -- mark it paid, alter its fare or change its passenger/boarding details.
    if old.user_id = actor_id
       and not exists (
         select 1
         from public.matmove_staff_access a
         where a.id = actor_id
           and a.is_active = true
           and a.removed_at is null
       )
       and old.status in ('pending_approval', 'approved', 'cancel_requested')
       and old.boarded_at is null
       and new.status = 'cancel_requested'
       and (
         (to_jsonb(new) - array['status', 'cancel_reason', 'cancel_requested_at'])
         is not distinct from
         (to_jsonb(old) - array['status', 'cancel_reason', 'cancel_requested_at'])
       ) then
      if new.cancel_reason is not null and length(btrim(new.cancel_reason)) > 500 then
        raise exception 'INVALID: Cancellation reason must be 500 characters or fewer.';
      end if;
      new.cancel_requested_at := coalesce(old.cancel_requested_at, clock_timestamp());
      return new;
    end if;

    raise exception 'FORBIDDEN: Travel booking changes must use an authorized MatMove workflow.';
  end if;

  return new;
end;
$function$;

-- The old ALL policy let every customer update/delete every column on their
-- own row. Replace it with explicit customer read/create/cancel-request access.
drop policy if exists "Users can manage own travel bookings" on public.travel_bookings;

drop policy if exists matmove_customer_travel_bookings_select on public.travel_bookings;
create policy matmove_customer_travel_bookings_select
  on public.travel_bookings
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists matmove_customer_travel_bookings_insert on public.travel_bookings;
create policy matmove_customer_travel_bookings_insert
  on public.travel_bookings
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists matmove_customer_travel_bookings_cancel_request on public.travel_bookings;
create policy matmove_customer_travel_bookings_cancel_request
  on public.travel_bookings
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and status in ('pending_approval', 'approved', 'cancel_requested')
  )
  with check (
    user_id = (select auth.uid())
    and status = 'cancel_requested'
  );

-- Attach the existing capacity/fare guard (previously defined but unattached)
-- after the new permission/field guard.
drop trigger if exists a_matmove_travel_bookings_write_guard on public.travel_bookings;
create trigger a_matmove_travel_bookings_write_guard
  before insert or update on public.travel_bookings
  for each row execute function public.matmove_guard_travel_booking_write_v1();

drop trigger if exists z_matmove_travel_bookings_capacity_guard on public.travel_bookings;
create trigger z_matmove_travel_bookings_capacity_guard
  before insert or update on public.travel_bookings
  for each row execute function public.matmove_guard_travel_booking();
