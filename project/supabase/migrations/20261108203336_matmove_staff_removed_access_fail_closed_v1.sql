
create or replace function public.matmove_is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select exists (
    select 1
    from public.matmove_staff_access a
    where a.id = auth.uid()
      and a.is_active = true
      and a.removed_at is null
  );
$function$;

create or replace function public.matmove_admin_access(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select to_jsonb(a)
  from public.matmove_staff_access a
  where a.id = p_id
    and a.is_active = true
    and a.removed_at is null;
$function$;
