begin;

do $patch_trip_cards$
declare
  v_definition text;
  v_updated text;
  v_old text := $old$
            'refundStatus',(select t.status from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund' order by t.updated_at desc limit 1)
$old$;
  v_new text := $new$
            'refundStatus',(select t.status from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund' order by t.updated_at desc limit 1),
            'adminSettlement',case
              when exists(select 1 from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund')
               and exists(select 1 from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='driver')
              then jsonb_build_object(
                'customerRefundMinor',(select t.amount_minor::text from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund' order by t.updated_at desc limit 1),
                'driverAwardMinor',(select t.amount_minor::text from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='driver' order by t.updated_at desc limit 1),
                'platformShareMinor',(rp.fare_minor
                  - coalesce((select t.amount_minor from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund' order by t.updated_at desc limit 1),0)
                  - coalesce((select t.amount_minor from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='driver' order by t.updated_at desc limit 1),0))::text,
                'platformFeeTransferred',exists(select 1 from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='fee'),
                'platformMode',case when rp.escrow_account=rp.fee_account then 'retained' else 'transferred' end,
                'status',rp.state
              )
              else null
            end
$new$;
begin
  v_definition := replace(pg_get_functiondef('public.matmove_trip_contact_cards(uuid[])'::regprocedure),E'\r','');
  if position('adminSettlement' in v_definition)=0 then
    v_updated := replace(v_definition,v_old,v_new);
    if v_updated=v_definition then
      raise exception 'Could not extend the role-scoped trip payment cards with Admin settlement details.';
    end if;
    execute v_updated;
  end if;
end;
$patch_trip_cards$;

commit;
