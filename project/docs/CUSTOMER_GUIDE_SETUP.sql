begin;
create table if not exists public.matmove_customer_guide_seen(
 user_id uuid primary key references auth.users(id) on delete cascade,
 seen_at timestamptz not null default clock_timestamp()
);
alter table public.matmove_customer_guide_seen enable row level security;
revoke all on public.matmove_customer_guide_seen from public,anon,authenticated,service_role;
create or replace function public.matmove_customer_guide(p_action text default 'status')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare u uuid:=auth.uid();first_display boolean:=false;
begin
 if u is null then raise exception 'AUTH: Sign in to continue.';end if;
 perform public.matmove_preferences_role(u);
 if exists(select 1 from public.matmove_staff_access where id=u and is_active=true and removed_at is null) then raise exception 'ACCESS: Customer account required.';end if;
 if p_action is null or p_action not in ('status','claim','seen') then raise exception 'INVALID: Unsupported guide action.';end if;
 if p_action in ('claim','seen') then
  insert into public.matmove_customer_guide_seen(user_id) values(u) on conflict(user_id) do nothing;
  first_display:=found and p_action='claim';
 end if;
 return jsonb_build_object('userId',u,'seen',exists(select 1 from public.matmove_customer_guide_seen where user_id=u),'firstDisplay',first_display);
end;
$fn$;
revoke all on function public.matmove_customer_guide(text) from public,anon,service_role;
grant execute on function public.matmove_customer_guide(text) to authenticated;
notify pgrst,'reload schema';
commit;
select to_regprocedure('public.matmove_customer_guide(text)') is not null as account_guide_ready;
