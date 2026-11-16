begin;
do $patch_admin_dispute_split$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
        if not found then
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
        elsif rp.state='funded' then
          raise exception 'INVALID_STATE: A refund transfer already exists on a funded payment. Manual reconciliation is required before an Admin dispute split.';
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
        elsif rp.state='funded' then
          raise exception 'INVALID_STATE: A refund transfer already exists on a funded payment. Manual reconciliation is required before an Admin dispute split.';
        end if;
$new$;
begin
  v_definition := replace(pg_get_functiondef('public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure),E'\r','');
  if position('refund_minor := floor(rp.fare_minor::numeric * 0.50)' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not safely replace the old full-refund block with the Admin 50/5/45 dispute split.';
    end if;
    execute v_updated;
  end if;
end;
$patch_admin_dispute_split$;
commit;