begin;

do $patch_admin_cancel$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$elsif rp.state='funded' and existing_refund.amount_minor <> floor(rp.fare_minor::numeric * 0.50)::bigint then
          raise exception 'INVALID_STATE: An earlier refund attempt exists with a different amount. Manual reconciliation is required.';
$old$;
  v_new text := $new$elsif rp.state='funded' then
          raise exception 'INVALID_STATE: A refund transfer already exists on a funded payment. Manual reconciliation is required before an Admin dispute split.';
$new$;
begin
  v_definition := replace(pg_get_functiondef('public.matmove_admin_cancel_booking(uuid,bigint,uuid,text,uuid)'::regprocedure),E'\r','');
  if position('A refund transfer already exists on a funded payment' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not harden the Admin cancellation split retry guard.';
    end if;
    execute v_updated;
  end if;
end;
$patch_admin_cancel$;

do $patch_full_refund$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$    elsif exists (
      select 1 from public.ride_payment_transfers
      where booking_id = p_booking_id and kind = 'refund' and status = 'completed'
    ) then
$old$;
  v_new text := $new$    elsif exists (
      select 1 from public.ride_payment_transfers
      where booking_id = p_booking_id and kind = 'refund'
        and status = 'completed' and amount_minor = p.fare_minor
    ) then
$new$;
begin
  v_definition := replace(pg_get_functiondef('public.finalize_ride_payment(uuid)'::regprocedure),E'\r','');
  if position('amount_minor = p.fare_minor' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not distinguish a completed full refund from an incomplete dispute split.';
    end if;
    execute v_updated;
  end if;
end;
$patch_full_refund$;

commit;
