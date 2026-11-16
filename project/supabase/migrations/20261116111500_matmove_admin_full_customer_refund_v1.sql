begin;

-- Admin cancellation of a funded digital ride now refunds the entire escrowed
-- fare to the original customer. It does not create a driver or platform leg.
-- Cash rides remain governed by the separate physical-cash return workflow.
do $patch$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
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
$old$;
  v_new text := $new$
          if rp.state='funded' then
            refund_minor := rp.fare_minor;
            driver_award_minor := 0;
            platform_minor := 0;
            if refund_minor <= 0 then
              raise exception 'INVALID_STATE: The funded fare is not valid for a full customer refund.';
            end if;

            insert into public.ride_payment_transfers(
              booking_id,kind,amount_minor,source_account,destination_account
            ) values(b.id,'refund',refund_minor,rp.escrow_account,rp.payer_account);
          else
            -- An older refunding payment may be waiting on a full-refund leg.
            -- Never add a driver or platform transfer while reconciling it.
            insert into public.ride_payment_transfers(
              booking_id,kind,amount_minor,source_account,destination_account
            ) values(b.id,'refund',rp.fare_minor,rp.escrow_account,rp.payer_account);
          end if;
$new$;
begin
  v_definition := pg_get_functiondef(
    'public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure
  );
  if position('refund_minor := rp.fare_minor;' in v_definition) > 0
     and position('50/5/45' in v_definition) = 0 then
    return;
  end if;
  v_updated := replace(v_definition, v_old, v_new);
  if v_updated = v_definition then
    raise exception 'Could not safely replace the existing Admin 50/5/45 escrow branch.';
  end if;
  execute v_updated;
end;
$patch$;

commit;
