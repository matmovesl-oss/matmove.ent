
-- MatMove production security lockdown, phase 2: RPC boundaries.

do $migration$
declare
  def text;
  updated text;
  item record;
begin
  -- Admin customer-role changes require the Customers permission (or active owner).
  select pg_get_functiondef('public.admin_change_user_role(uuid,text,text)'::regprocedure) into def;
  updated := regexp_replace(
    def,
    'IF NOT EXISTS[[:space:]]*\([[:space:]]*SELECT 1[[:space:]]*FROM public\.admins a[[:space:]]*WHERE a\.id = v_admin_id[[:space:]]*\)',
    'IF NOT public.matmove_admin_can(''customers'')',
    'i'
  );
  if updated = def then
    raise exception 'Could not insert the Customers permission check into admin_change_user_role.';
  end if;
  updated := regexp_replace(updated, 'SET search_path TO[^\n]*', 'SET search_path TO ''pg_catalog'', ''public''', 'i');
  execute updated;

  -- Legacy wallet activation/freezing requires the Financials permission (or active owner).
  select pg_get_functiondef('public.admin_set_wallet_active(uuid,boolean,text)'::regprocedure) into def;
  updated := regexp_replace(
    def,
    'IF NOT EXISTS[[:space:]]*\([[:space:]]*SELECT 1[[:space:]]*FROM public\.admins[[:space:]]*WHERE id = v_admin_id[[:space:]]*\)',
    'IF NOT public.matmove_admin_can(''financials'')',
    'i'
  );
  if updated = def then
    raise exception 'Could not insert the Financials permission check into admin_set_wallet_active.';
  end if;
  updated := regexp_replace(updated, 'SET search_path TO[^\n]*', 'SET search_path TO ''pg_catalog'', ''public''', 'i');
  execute updated;

  -- Exchange-rate changes require the Financials permission (or active owner).
  select pg_get_functiondef('public.set_currency_rate(text,text,numeric,numeric)'::regprocedure) into def;
  updated := regexp_replace(
    def,
    'IF NOT EXISTS[[:space:]]*\([[:space:]]*SELECT 1[[:space:]]*FROM public\.admins[[:space:]]*WHERE id = v_admin_id[[:space:]]*\)',
    'IF NOT public.matmove_admin_can(''financials'')',
    'i'
  );
  if updated = def then
    raise exception 'Could not insert the Financials permission check into set_currency_rate.';
  end if;
  updated := regexp_replace(updated, 'SET search_path TO[^\n]*', 'SET search_path TO ''pg_catalog'', ''public''', 'i');
  execute updated;

  -- Fix all SECURITY DEFINER functions with absent or non-fixed search paths.
  for item in
    select n.nspname, p.proname, oidvectortypes(p.proargtypes) as args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=pg_catalog%'
           or cfg = 'search_path=""'
      )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = pg_catalog, public',
      item.nspname, item.proname, item.args
    );
  end loop;
end
$migration$;

-- Legacy notification overload writes only to a retired table.
-- Keep service-role execution only; the current UUID overload performs
-- active-staff permission checks and writes to the private inbox.
revoke all on function public.matmove_admin_send_notification(text,text,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.matmove_admin_send_notification(text,text,uuid,text,text,text)
  to service_role;

-- Settlement of provider-confirmed wallet top-ups is server-only.
revoke all on function public.settle_wallet_topup(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_wallet_topup(uuid,text,jsonb)
  to service_role;

-- This old nearby-driver RPC references a missing legacy driver_locations table
-- and can enumerate driver identities. Retire client execution until it is replaced.
revoke all on function public.get_nearby_eligible_drivers(numeric,numeric,numeric)
  from public, anon, authenticated;
grant execute on function public.get_nearby_eligible_drivers(numeric,numeric,numeric)
  to service_role;

-- Fare estimates are non-sensitive, but the SECURITY DEFINER lookup uses a fixed path.
alter function public.calculate_trip_fare(text,numeric)
  set search_path = pg_catalog, public;

-- Keep the permission-checked admin functions available to authenticated staff.
revoke all on function public.admin_change_user_role(uuid,text,text) from public, anon;
grant execute on function public.admin_change_user_role(uuid,text,text) to authenticated, service_role;

revoke all on function public.admin_set_wallet_active(uuid,boolean,text) from public, anon;
grant execute on function public.admin_set_wallet_active(uuid,boolean,text) to authenticated, service_role;

revoke all on function public.set_currency_rate(text,text,numeric,numeric) from public, anon;
grant execute on function public.set_currency_rate(text,text,numeric,numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
