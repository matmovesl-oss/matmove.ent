
-- Effective anonymous deny rules for Storage object mutations.
-- The Storage owner role maintains inherited table grants; restrictive RLS
-- policies ensure anon cannot write regardless of those underlying grants.

drop policy if exists matmove_deny_anon_storage_insert on storage.objects;
create policy matmove_deny_anon_storage_insert
  on storage.objects as restrictive
  for insert to anon
  with check (false);

drop policy if exists matmove_deny_anon_storage_update on storage.objects;
create policy matmove_deny_anon_storage_update
  on storage.objects as restrictive
  for update to anon
  using (false)
  with check (false);

drop policy if exists matmove_deny_anon_storage_delete on storage.objects;
create policy matmove_deny_anon_storage_delete
  on storage.objects as restrictive
  for delete to anon
  using (false);

notify pgrst, 'reload schema';
