
do $lockdown$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and (
        p.proconfig is null
        or not exists (
          select 1 from unnest(p.proconfig) cfg
          where cfg like 'search_path=%'
        )
        or exists (
          select 1 from unnest(p.proconfig) cfg
          where cfg like 'search_path=%'
            and (cfg ilike '%pg_temp%' or cfg not ilike '%pg_catalog%')
        )
      )
  loop
    execute format('alter function %s set search_path = pg_catalog, public', f.signature);
  end loop;
end
$lockdown$;

-- Keep public fare estimation and aggregate seat availability callable;
-- both functions return calculation/public availability data only, not customer rows.
-- All other sensitive admin functions are authenticated and permission-checked.

notify pgrst, 'reload schema';
