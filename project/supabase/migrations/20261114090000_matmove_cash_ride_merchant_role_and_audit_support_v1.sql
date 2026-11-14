-- Enable physical-cash ride bookings for both customer roles (Rider and Merchant).
-- Preserve the immutable 85/15 split, the same reserve/capture idempotency keys,
-- both-party confirmation requirement, and existing settlement verification.

alter table public.matmove_cash_ride_audit_events
  drop constraint if exists matmove_cash_ride_audit_events_actor_type_check;
alter table public.matmove_cash_ride_audit_events
  add constraint matmove_cash_ride_audit_events_actor_type_check
  check (actor_type = any (array['system','rider','merchant','driver','admin']::text[]));

do $cash_merchant_roles$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef('public.matmove_create_customer_trip(uuid,jsonb)'::regprocedure);
  if position('service <> ''ride'' or role_name <> ''rider''' in v_definition) = 0 then
    raise exception 'Expected cash role guard was not found in matmove_create_customer_trip; no customer booking function changed.';
  end if;
  v_definition := replace(
    v_definition,
    'service <> ''ride'' or role_name <> ''rider''',
    'service <> ''ride'' or role_name not in (''rider'',''merchant'')'
  );
  execute v_definition;

  v_definition := pg_get_functiondef('public.matmove_cash_ride_prepare_leg(uuid,text,uuid,text)'::regprocedure);
  if position('where id=p.rider_id and role=''rider''' in v_definition) = 0 then
    raise exception 'Expected SLE wallet owner role guard was not found in matmove_cash_ride_prepare_leg; no cash preparation function changed.';
  end if;
  v_definition := replace(
    v_definition,
    'where id=p.rider_id and role=''rider''',
    'where id=p.rider_id and role in (''rider'',''merchant'')'
  );
  execute v_definition;

  v_definition := pg_get_functiondef('public.matmove_cash_ride_claim_leg(uuid,text)'::regprocedure);
  if position('and rider.role=''rider''' in v_definition) = 0 then
    raise exception 'Expected reserve source-account role guard was not found in matmove_cash_ride_claim_leg; no claim function changed.';
  end if;
  v_definition := replace(
    v_definition,
    'and rider.role=''rider''',
    'and rider.role in (''rider'',''merchant'')'
  );
  execute v_definition;

  v_definition := pg_get_functiondef('public.matmove_cash_ride_confirm_collection(uuid,uuid,text)'::regprocedure);
  if position('p_actor_type not in (''rider'',''driver'')' in v_definition) = 0
     or position('if p_actor_type=''rider'' then' in v_definition) = 0 then
    raise exception 'Expected customer confirmation role guards were not found; no cash confirmation function changed.';
  end if;
  v_definition := replace(
    v_definition,
    'p_actor_type not in (''rider'',''driver'')',
    'p_actor_type not in (''rider'',''merchant'',''driver'')'
  );
  v_definition := replace(
    v_definition,
    'if p_actor_type=''rider'' then',
    'if p_actor_type in (''rider'',''merchant'') then'
  );
  execute v_definition;

  v_definition := pg_get_functiondef('public.matmove_cash_ride_cancel(uuid,uuid,text)'::regprocedure);
  if position('p_actor_type not in (''rider'',''driver'')' in v_definition) = 0
     or position('if p_actor_type=''rider'' then' in v_definition) = 0 then
    raise exception 'Expected customer cancel role guards were not found; no cash cancel function changed.';
  end if;
  v_definition := replace(
    v_definition,
    'p_actor_type not in (''rider'',''driver'')',
    'p_actor_type not in (''rider'',''merchant'',''driver'')'
  );
  v_definition := replace(
    v_definition,
    'if p_actor_type=''rider'' then',
    'if p_actor_type in (''rider'',''merchant'') then'
  );
  execute v_definition;
end;
$cash_merchant_roles$;

comment on constraint matmove_cash_ride_audit_events_actor_type_check
on public.matmove_cash_ride_audit_events
is 'Cash confirmation and cancellation audit actors may be Rider, Merchant, Driver, Admin or System.';
