begin;

-- Merchant ride bookings use the same private cash-ride ledger as Rider bookings.
-- The booking's rider_id column is the customer-party reference for both roles.
-- Keep the financial reserve, dual-confirmation gate and verified provider receipt
-- unchanged; only broaden the authorized customer role and preserve its audit identity.

alter table public.matmove_cash_ride_audit_events
  drop constraint if exists matmove_cash_ride_audit_events_actor_type_check;

alter table public.matmove_cash_ride_audit_events
  add constraint matmove_cash_ride_audit_events_actor_type_check
  check (actor_type = any (array['system','rider','merchant','driver','admin']));

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  -- Customer trip creation: allow a merchant to request a cash ride.
  v_definition := pg_get_functiondef('public.matmove_create_customer_trip(uuid,jsonb)'::regprocedure);
  v_updated := replace(
    v_definition,
    'service <> ''ride'' or role_name <> ''rider''',
    'service <> ''ride'' or role_name not in (''rider'',''merchant'')'
  );
  if v_updated = v_definition then
    raise exception 'Merchant cash ride migration could not update customer trip role guard.';
  end if;
  execute v_updated;

  -- The reserve source remains the customer's own unique, unfrozen SLE wallet.
  v_definition := pg_get_functiondef('public.matmove_cash_ride_prepare_leg(uuid,text,uuid,text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'where id=p.rider_id and role=''rider''',
    'where id=p.rider_id and role in (''rider'',''merchant'')'
  );
  if v_updated = v_definition then
    raise exception 'Merchant cash ride migration could not update reserve role guard.';
  end if;
  execute v_updated;

  -- Reconciliation rechecks the same owner role before completing a reserve.
  v_definition := pg_get_functiondef('public.matmove_cash_ride_claim_leg(uuid,text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'and rider.role=''rider''',
    'and rider.role in (''rider'',''merchant'')'
  );
  if v_updated = v_definition then
    raise exception 'Merchant cash ride migration could not update reconciliation role guard.';
  end if;
  execute v_updated;

  -- A merchant is the customer-side actor, but remains separately identified
  -- in the append-only audit log. Both confirmation timestamps are still required.
  v_definition := pg_get_functiondef('public.matmove_cash_ride_confirm_collection(uuid,uuid,text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'p_actor_type not in (''rider'',''driver'')',
    'p_actor_type not in (''rider'',''merchant'',''driver'')'
  );
  v_updated := replace(
    v_updated,
    'if p_actor_type=''rider'' then',
    'if p_actor_type in (''rider'',''merchant'') then'
  );
  v_updated := replace(
    v_updated,
    'values(p_booking_id,''rider_cash_confirmed'',''rider'',p_actor_id);',
    'values(p_booking_id,''rider_cash_confirmed'',p_actor_type,p_actor_id);'
  );
  if v_updated = v_definition then
    raise exception 'Merchant cash ride migration could not update confirmation actor guard.';
  end if;
  execute v_updated;

  -- Cancellation is likewise available to the customer party, including merchants.
  v_definition := pg_get_functiondef('public.matmove_cash_ride_cancel(uuid,uuid,text)'::regprocedure);
  v_updated := replace(
    v_definition,
    'p_actor_type not in (''rider'',''driver'')',
    'p_actor_type not in (''rider'',''merchant'',''driver'')'
  );
  v_updated := replace(
    v_updated,
    'if p_actor_type=''rider'' then',
    'if p_actor_type in (''rider'',''merchant'') then'
  );
  if v_updated = v_definition then
    raise exception 'Merchant cash ride migration could not update cancellation actor guard.';
  end if;
  execute v_updated;
end;
$migration$;

comment on constraint matmove_cash_ride_audit_events_actor_type_check
  on public.matmove_cash_ride_audit_events is
  'Customer cash-ride actions distinguish rider and merchant actors; driver, admin and system events remain separately attributable.';

commit;
