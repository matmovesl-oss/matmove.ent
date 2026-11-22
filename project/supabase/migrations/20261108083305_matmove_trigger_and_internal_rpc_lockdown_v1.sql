
-- MatMove lockdown phase 4: remove trigger entry points and non-client RPCs.

-- Fare calculation reads public pricing only; run as invoker, not SECURITY DEFINER.
alter function public.calculate_trip_fare(text,numeric) security invoker;
alter function public.calculate_trip_fare(text,numeric)
  set search_path = pg_catalog, public;

-- Recipient validation is an internal payout/refund helper for trusted server endpoints.
revoke all on function public.matmove_admin_money_recipient(text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.matmove_admin_money_recipient(text,uuid,text)
  to service_role;

-- These functions are installed as table triggers. They are not client RPCs.
-- Revoking direct EXECUTE does not remove or disable the installed triggers.
do $trigger_lockdown$
declare item record;
begin
  for item in
    select n.nspname,p.proname,oidvectortypes(p.proargtypes) as args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prorettype='trigger'::regtype
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      item.nspname,item.proname,item.args
    );
  end loop;
end
$trigger_lockdown$;

-- Remaining mutable search-path warnings are simple trigger/check functions.
alter function public.set_financial_updated_at()
  set search_path = pg_catalog, public;
alter function public.prevent_ledger_entry_mutation()
  set search_path = pg_catalog, public;
alter function public.ledger_transaction_is_balanced(uuid)
  set search_path = pg_catalog, public;

notify pgrst, 'reload schema';
