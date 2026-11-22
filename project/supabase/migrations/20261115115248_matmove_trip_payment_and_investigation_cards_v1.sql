begin;

-- Extend the already participant-scoped trip-card RPC with a safe payment
-- summary and open investigation marker. No provider account IDs, private
-- admin notes, or raw transfer receipts are exposed to riders/drivers.
do $patch$
declare
  v_definition text;
  v_updated text;
  v_anchor text := '      ) end' || E'\n    ) order by b.created_at desc';
  v_replacement text := $replacement$
      ) end,
      'payment',case
        when b.payment_method='cash' then (
          select jsonb_build_object(
            'method','cash',
            'status',cp.status,
            'driverCashConfirmed',cp.driver_cash_confirmed_at is not null,
            'customerCashConfirmed',cp.rider_cash_confirmed_at is not null,
            'cashReturnStatus',cp.cash_return_status,
            'reserveStatus',(select l.status from public.matmove_cash_ride_legs l where l.booking_id=b.id and l.leg_kind='reserve' limit 1),
            'captureStatus',(select l.status from public.matmove_cash_ride_legs l where l.booking_id=b.id and l.leg_kind='capture' limit 1),
            'refundStatus',(select l.status from public.matmove_cash_ride_legs l where l.booking_id=b.id and l.leg_kind='refund' limit 1)
          )
          from public.matmove_cash_ride_payments cp
          where cp.booking_id=b.id
        )
        else (
          select jsonb_build_object(
            'method','digital',
            'status',rp.state,
            'holdStatus',(select t.status from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='hold' order by t.updated_at desc limit 1),
            'driverPayoutStatus',(select t.status from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='driver' order by t.updated_at desc limit 1),
            'refundStatus',(select t.status from public.ride_payment_transfers t where t.booking_id=b.id and t.kind='refund' order by t.updated_at desc limit 1)
          )
          from public.ride_payments rp
          where rp.booking_id=b.id
        )
      end,
      'investigation',case
        when v_role='driver' and b.driver_id is distinct from v_uid then null
        else (
          select jsonb_build_object(
            'status',it.status,
            'reasonCode',it.reason_code,
            'firstSeenAt',it.first_seen_at,
            'updatedAt',it.updated_at
          )
          from public.matmove_ride_investigation_tickets it
          where it.booking_id=b.id and it.status<>'resolved'
          order by it.updated_at desc
          limit 1
        )
      end
    ) order by b.created_at desc
$replacement$;
begin
  v_definition := pg_get_functiondef(
    'public.matmove_trip_contact_cards(uuid[])'::regprocedure
  );
  if position('''driverPayoutStatus''' in v_definition)>0
     and position('''investigation''' in v_definition)>0 then
    return;
  end if;
  v_updated := replace(v_definition,v_anchor,v_replacement);
  if v_updated=v_definition then
    raise exception 'Trip card payment/investigation extension anchor was not found.';
  end if;
  execute v_updated;
end;
$patch$;

commit;
