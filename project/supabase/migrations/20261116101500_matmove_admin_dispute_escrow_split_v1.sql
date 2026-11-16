begin;

do $patch_admin_cancel$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
        if not found then
          insert into public.ride_payment_transfers(
            booking_id,kind,amount_minor,source_account,destination_account
          ) values(b.id,'refund',rp.fare_minor,rp.escrow_account,rp.payer_account);
        end if;
$old$;
  v_new text := $new$
        if not found then
          if rp.state='funded' then
            if rp.driver_id is null or rp.driver_account is null
               or rp.driver_account=rp.escrow_account then
              raise exception 'INVALID_STATE: A verified assigned driver wallet is required for the Admin dispute split.';
            end if;

            refund_minor := floor(rp.fare_minor::numeric * 0.50)::bigint;
            driver_award_minor := floor(rp.fare_minor::numeric * 0.05)::bigint;
            platform_minor := rp.fare_minor - refund_minor - driver_award_minor;
            if refund_minor <= 0 or driver_award_minor <= 0 or platform_minor <= 0 then
              raise exception 'INVALID_STATE: This fare is too small for the Admin 50/5/45 dispute split.';
            end if;

            insert into public.ride_payment_transfers(
              booking_id,kind,amount_minor,source_account,destination_account
            ) values(b.id,'refund',refund_minor,rp.escrow_account,rp.payer_account);

            insert into public.ride_payment_transfers(
              booking_id,kind,amount_minor,source_account,destination_account
            ) values(b.id,'driver',driver_award_minor,rp.escrow_account,rp.driver_account);

            if rp.escrow_account <> rp.fee_account then
              insert into public.ride_payment_transfers(
                booking_id,kind,amount_minor,source_account,destination_account
              ) values(b.id,'fee',platform_minor,rp.escrow_account,rp.fee_account);
            end if;
          else
            -- Preserve the historical full-refund path when an older refunding
            -- payment has no split ledger. Never retrofit an in-flight transfer.
            insert into public.ride_payment_transfers(
              booking_id,kind,amount_minor,source_account,destination_account
            ) values(b.id,'refund',rp.fare_minor,rp.escrow_account,rp.payer_account);
          end if;
        elsif rp.state='funded' and existing_refund.amount_minor <> floor(rp.fare_minor::numeric * 0.50)::bigint then
          raise exception 'INVALID_STATE: An earlier refund attempt exists with a different amount. Manual reconciliation is required.';
        end if;
$new$;
begin
  v_definition := pg_get_functiondef('public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure);
  if position('driver_award_minor' in v_definition)=0 then
    v_updated := replace(v_definition,'  outcome text;','  outcome text;'||E'\n  refund_minor bigint;'||E'\n  driver_award_minor bigint;'||E'\n  platform_minor bigint;');
    if v_updated=v_definition then
      raise exception 'Could not add Admin split calculation variables.';
    end if;
    v_definition := v_updated;
  end if;
  if position('Admin dispute split' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not safely add the Admin 50/5/45 escrow split.';
    end if;
    v_definition := v_updated;
  end if;
  execute v_definition;
end;
$patch_admin_cancel$;

do $patch_finalize$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
  elsif p.state = 'refunding' then
    if exists (
      select 1
      from public.ride_payment_transfers
      where booking_id = p_booking_id
        and kind = 'refund'
        and status = 'completed'
    ) then
      update public.ride_payments
      set state = 'refunded', updated_at = now()
      where booking_id = p_booking_id;

      update public.bookings
      set status = 'cancelled'
      where id = p_booking_id;
    end if;
$old$;
  v_new text := $new$
  elsif p.state = 'refunding' then
    if exists (
      select 1 from public.ride_payment_transfers
      where booking_id = p_booking_id and kind = 'driver'
    ) then
      -- Admin dispute split: customer refund (50%), driver award (5%), and
      -- platform share (45%). Complete only after every applicable leg verifies.
      if exists (
        select 1 from public.ride_payment_transfers
        where booking_id = p_booking_id and kind = 'refund' and status = 'completed'
      )
      and exists (
        select 1 from public.ride_payment_transfers
        where booking_id = p_booking_id and kind = 'driver' and status = 'completed'
      )
      and (
        p.escrow_account = p.fee_account
        or exists (
          select 1 from public.ride_payment_transfers
          where booking_id = p_booking_id and kind = 'fee' and status = 'completed'
        )
      ) then
        update public.ride_payments set state = 'refunded', updated_at = now()
        where booking_id = p_booking_id;
        update public.bookings set status = 'cancelled', updated_at = now()
        where id = p_booking_id;
      end if;
    elsif exists (
      -- Legacy customer-initiated full refunds have no driver award leg.
      select 1 from public.ride_payment_transfers
      where booking_id = p_booking_id and kind = 'refund' and status = 'completed'
    ) then
      update public.ride_payments set state = 'refunded', updated_at = now()
      where booking_id = p_booking_id;
      update public.bookings set status = 'cancelled', updated_at = now()
      where id = p_booking_id;
    end if;
$new$;
begin
  v_definition := pg_get_functiondef('public.finalize_ride_payment(uuid)'::regprocedure);
  if position('Admin dispute split: customer refund' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not safely update Admin split settlement finalization.';
    end if;
    execute v_updated;
  end if;
end;
$patch_finalize$;

do $patch_reconcile_review$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_updated text;
begin
  v_definition := pg_get_functiondef('public.matmove_admin_trip_review(uuid)'::regprocedure);
  v_old := $old$payment_data:=jsonb_build_object('state',rp.state,'fareMinor',rp.fare_minor::text,'driverMinor',rp.driver_minor::text,'feeMinor',rp.fee_minor::text,'createdAt',rp.created_at,'updatedAt',rp.updated_at,$old$;
  v_new := $new$payment_data:=jsonb_build_object('state',rp.state,'fareMinor',rp.fare_minor::text,'driverMinor',rp.driver_minor::text,'feeMinor',rp.fee_minor::text,'escrowAccount',rp.escrow_account,'feeAccount',rp.fee_account,'createdAt',rp.created_at,'updatedAt',rp.updated_at,$new$;
  if position('''escrowAccount'',rp.escrow_account' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not expose the digital settlement account lineage to Admin review.';
    end if;
    execute v_updated;
  end if;
end;
$patch_reconcile_review$;

commit;
