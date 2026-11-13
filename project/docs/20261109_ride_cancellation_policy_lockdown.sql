-- MatMove ride cancellation authorization and fail-closed fee policy.
-- This migration intentionally does not invent a rider cancellation-fee amount.
-- Assigned-driver cancellation remains a full refund to the original payer.
-- Rider cancellation after acceptance is blocked until the agreed fee is
-- configured and its 50/50 MatMove/driver split is implemented and verified.
CREATE OR REPLACE FUNCTION public.prepare_ride_payment(p_booking_id uuid, p_actor_id uuid, p_action text, p_payer_account text DEFAULT NULL::text, p_driver_account text DEFAULT NULL::text, p_escrow_account text DEFAULT NULL::text, p_fee_account text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  b public.bookings%rowtype;
  p public.ride_payments%rowtype;
  fare bigint;
  fee bigint;
  caller_role text;
begin
  select *
  into b
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: Booking not found.';
  end if;

  select *
  into p
  from public.ride_payments
  where booking_id = b.id
  for update;

  select role
  into caller_role
  from public.profiles
  where id = p_actor_id;

  if p_action in ('accept', 'start') then
    if caller_role is distinct from 'driver'
      or b.rider_id = p_actor_id
    then
      raise exception
        'FORBIDDEN: Driver account required.';
    end if;

    if b.driver_id is not null
      and b.driver_id <> p_actor_id
    then
      raise exception
        'FORBIDDEN: Another driver owns this booking.';
    end if;

  elsif p_action = 'complete' then
    if b.rider_id is distinct from p_actor_id then
      raise exception
        'FORBIDDEN: Only the customer who booked this ride can complete it.';
    end if;

  elsif p_action = 'cancel' then
    if p_actor_id is null
      or not (
        b.rider_id = p_actor_id
        or (
          caller_role = 'driver'
          and b.driver_id = p_actor_id
        )
      )
    then
      raise exception
        'FORBIDDEN: Only the booking customer or assigned driver can cancel this ride.';
    end if;

  else
    raise exception
      'INVALID_STATE: Unknown ride action.';
  end if;

  if p_action = 'accept' then
    if p.booking_id is not null then
      if p.driver_id <> p_actor_id
        or p.state not in (
          'funding',
          'funded',
          'releasing',
          'released'
        )
      then
        raise exception
          'INVALID_STATE: Payment cannot be accepted again. Contact support.';
      end if;

      return to_jsonb(p);
    end if;

    if b.status not in ('pending', 'pending_admin') then
      raise exception
        'LEGACY_PAYMENT: This existing ride has no payment ledger. Contact support to reconcile its escrow.';
    end if;

    if exists (
      select 1
      from public.profiles
      where id in (b.rider_id, p_actor_id)
        and coalesce(is_wallet_frozen, false)
    )
    or exists (
      select 1
      from public.wallets
      where user_id in (b.rider_id, p_actor_id)
        and coalesce(is_frozen, false)
    )
    or not exists (
      select 1
      from public.profiles
      where id = p_actor_id
        and role = 'driver'
        and kyc_status = 'approved'
    )
    or not exists (
      select 1
      from public.profiles
      where id = b.rider_id
        and (
          role = 'rider'
          or (
            role = 'merchant'
            and kyc_status = 'approved'
          )
        )
    ) then
      raise exception
        'FORBIDDEN: Ride wallets must be approved and unfrozen.';
    end if;

    if not exists (
      select 1
      from public.wallets
      where user_id = b.rider_id
        and currency = 'SLE'
        and coalesce(
          monime_account_id,
          metadata->>'monime_account_id'
        ) = p_payer_account
    )
    or not exists (
      select 1
      from public.wallets
      where user_id = p_actor_id
        and currency = 'SLE'
        and coalesce(
          monime_account_id,
          metadata->>'monime_account_id'
        ) = p_driver_account
    ) then
      raise exception
        'ACCOUNT_CHANGED: Wallet links changed. Check again before accepting.';
    end if;

    if b.fare_amount is null
      or b.fare_amount <= 0
      or b.fare_amount::numeric * 100 <>
        trunc(b.fare_amount::numeric * 100)
      or b.fare_amount::numeric > 10000000000
    then
      raise exception
        'INVALID_FARE: A positive fare with at most two decimal places must be set before accepting.';
    end if;

    fare := (b.fare_amount::numeric * 100)::bigint;

    -- Driver gets 85%, rounded to cents.
    -- Fee is the remainder so the total is conserved.
    fee := fare -
      round(fare::numeric * 85 / 100)::bigint;

    insert into public.ride_payments (
      booking_id,
      payer_id,
      driver_id,
      fare_minor,
      driver_minor,
      fee_minor,
      payer_account,
      driver_account,
      escrow_account,
      fee_account,
      state
    )
    values (
      b.id,
      b.rider_id,
      p_actor_id,
      fare,
      fare - fee,
      fee,
      p_payer_account,
      p_driver_account,
      p_escrow_account,
      p_fee_account,
      'funding'
    )
    returning * into p;

    insert into public.ride_payment_transfers (
      booking_id,
      kind,
      amount_minor,
      source_account,
      destination_account
    )
    values (
      b.id,
      'hold',
      fare,
      p.payer_account,
      p.escrow_account
    );

    -- Reserve the driver, but do not mark accepted
    -- until Monime confirms the escrow transfer.
    update public.bookings
    set driver_id = p_actor_id
    where id = b.id;

  elsif p_action = 'start' then
    if p.booking_id is null then
      raise exception
        'LEGACY_PAYMENT: Escrow ledger is missing. Contact support.';
    end if;

    if b.driver_id <> p_actor_id
      or p.driver_id <> p_actor_id
      or p.state <> 'funded'
      or b.status not in ('accepted', 'in_progress')
    then
      raise exception
        'INVALID_STATE: Escrow must be funded and this driver assigned before starting.';
    end if;

    if not exists (
      select 1
      from public.profiles
      where id = p_actor_id
        and kyc_status = 'approved'
        and not coalesce(is_wallet_frozen, false)
    )
    or exists (
      select 1
      from public.wallets
      where user_id = p_actor_id
        and coalesce(is_frozen, false)
    ) then
      raise exception
        'FORBIDDEN: Driver approval and an unfrozen wallet are required to start this ride.';
    end if;

    update public.bookings
    set status = 'in_progress'
    where id = b.id;

  elsif p_action = 'complete' then
    if p.booking_id is null then
      raise exception
        'LEGACY_PAYMENT: Escrow ledger is missing. Contact support.';
    end if;

    if p.state = 'released'
      and b.status = 'completed'
    then
      return to_jsonb(p);
    end if;

    if b.status <> 'in_progress'
      or p.state not in ('funded', 'releasing')
    then
      raise exception
        'INVALID_STATE: Only a started, escrow-funded trip can complete.';
    end if;

    insert into public.ride_payment_transfers (
      booking_id,
      kind,
      amount_minor,
      source_account,
      destination_account
    )
    values (
      b.id,
      'driver',
      p.driver_minor,
      p.escrow_account,
      p.driver_account
    )
    on conflict do nothing;

    -- Shared escrow/fee account: retain the fee.
    -- Only create a fee transfer if accounts differ.
    if p.fee_minor > 0
      and p.escrow_account <> p.fee_account
    then
      insert into public.ride_payment_transfers (
        booking_id,
        kind,
        amount_minor,
        source_account,
        destination_account
      )
      values (
        b.id,
        'fee',
        p.fee_minor,
        p.escrow_account,
        p.fee_account
      )
      on conflict do nothing;
    end if;

    update public.ride_payments
    set
      state = 'releasing',
      updated_at = now()
    where booking_id = b.id
    returning * into p;

  elsif p_action = 'cancel' then
    if b.status = 'cancelled'
      and (
        p.booking_id is null
        or p.state in ('refunded', 'failed')
      )
    then
      return to_jsonb(p);
    end if;

    if b.status not in (
      'pending',
      'pending_admin',
      'accepted'
    ) then
      raise exception
        'INVALID_STATE: Only an unstarted trip can be cancelled.';
    end if;

    if p.booking_id is null then
      if b.status = 'accepted' then
        raise exception
          'LEGACY_PAYMENT: Existing escrow must be reconciled before cancellation.';
      end if;

      update public.bookings
      set status = 'cancelled'
      where id = b.id;

    elsif p.state = 'funding' then
      update public.ride_payment_transfers
      set
        status = 'failed',
        error = 'Cancelled before escrow funding.',
        updated_at = now()
      where booking_id = b.id
        and kind = 'hold'
        and status = 'ready'
        and attempted_at is null;

      if found then
        update public.ride_payments
        set
          state = 'failed',
          updated_at = now()
        where booking_id = b.id
        returning * into p;

        update public.bookings
        set status = 'cancelled'
        where id = b.id;
      else
        raise exception
          'PAYMENT_PENDING: Escrow funding is processing. Check again before cancelling.';
      end if;

    elsif p.state = 'failed' then
      update public.bookings
      set status = 'cancelled'
      where id = b.id;

    elsif p.state = 'funded' then
      -- Driver cancellation is a full refund to the original payer.
      -- Rider cancellation after acceptance must never silently waive the
      -- agreed cancellation fee. Until the fee amount is configured and
      -- independently split 50/50, fail closed without creating a transfer.
      if p_actor_id = b.rider_id then
        raise exception
          'CANCEL_FEE_NOT_CONFIGURED: Rider cancellation after acceptance is unavailable until the agreed cancellation fee is configured. No refund or transfer was initiated.';
      end if;

      if caller_role is distinct from 'driver'
        or b.driver_id is distinct from p_actor_id
      then
        raise exception
          'FORBIDDEN: Only the assigned driver can initiate a full-refund cancellation.';
      end if;

      insert into public.ride_payment_transfers (
        booking_id,
        kind,
        amount_minor,
        source_account,
        destination_account
      )
      values (
        b.id,
        'refund',
        p.fare_minor,
        p.escrow_account,
        p.payer_account
      )
      on conflict do nothing;

      update public.ride_payments
      set
        state = 'refunding',
        updated_at = now()
      where booking_id = b.id
      returning * into p;

    elsif p.state = 'refunding' then
      -- A prior refund may already have reached Monime. Only the assigned
      -- driver may resume this existing full-refund intent; never create a
      -- second or newly authorized rider refund here.
      if caller_role is distinct from 'driver'
        or b.driver_id is distinct from p_actor_id
      then
        raise exception
          'CANCEL_ALREADY_PROCESSING: An existing refund is being reconciled. Contact support; no new transfer was initiated.';
      end if;

      if not exists (
        select 1
        from public.ride_payment_transfers
        where booking_id = b.id
          and kind = 'refund'
      ) then
        raise exception
          'INVALID_STATE: Refund intent is missing its transfer record. Manual reconciliation is required.';
      end if;

      update public.ride_payments
      set
        state = 'refunding',
        updated_at = now()
      where booking_id = b.id
      returning * into p;

    else
      raise exception
        'INVALID_STATE: Ride cannot be refunded in its current payment state.';
    end if;
  end if;

  return to_jsonb(p);
end $function$;
