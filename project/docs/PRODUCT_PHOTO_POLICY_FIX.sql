-- SUPABASE SQL EDITOR: repairs the conflicting catalog INSERT guard only.
-- Requires the existing Product Catalog setup. No files or product rows are deleted.
begin;
do $preflight$ begin
 if to_regclass('storage.objects') is null
 or to_regprocedure('public.matmove_catalog_is_merchant()') is null then
  raise exception 'STOP: Install the existing Product Catalog setup first.';
 end if;
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then
  raise exception 'STOP: Storage RLS must already be enabled.';
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='matmove_catalog_upload' and cmd='INSERT' and permissive='PERMISSIVE') then
  raise exception 'STOP: The existing owned catalog upload policy is missing.';
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
  and policyname='matmove_catalog_upload_scope' and cmd='INSERT' and permissive='RESTRICTIVE'
  and with_check like '%matmove_catalog_is_merchant%') then
  raise exception 'STOP: The existing merchant-only catalog guard is missing.';
 end if;
end $preflight$;
drop policy if exists matmove_product_image_owner_guard on storage.objects;
create policy matmove_product_image_owner_guard on storage.objects as restrictive for insert to public
with check(bucket_id<>'product_images' or (auth.uid() is not null
 and (strpos(name,auth.uid()::text||'/')=1 or strpos(name,auth.uid()::text||'-')=1)));
notify pgrst,'reload schema';
commit;
select exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
 and policyname='matmove_product_image_owner_guard' and permissive='RESTRICTIVE' and cmd='INSERT'
 and with_check like '%/%') as both_owned_photo_paths_ready;
