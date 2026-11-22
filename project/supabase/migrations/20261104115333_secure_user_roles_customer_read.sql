begin;

alter table public.user_roles enable row level security;

revoke all privileges on table public.user_roles from public, anon, authenticated;
grant select on table public.user_roles to authenticated;
grant all privileges on table public.user_roles to service_role;

drop policy if exists "Users can view own roles" on public.user_roles;
create policy "Users can view own roles"
  on public.user_roles
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

commit;