-- Product photos are public catalog media; KYC and profile photos remain private.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product_images','product_images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists matmove_catalog_photo_read on storage.objects;
create policy matmove_catalog_photo_read on storage.objects for select to authenticated
using(bucket_id='product_images' and public.matmove_catalog_is_merchant()
 and (name like auth.uid()::text||'/%' or name like auth.uid()::text||'-%'));
drop policy if exists matmove_catalog_upload on storage.objects;
create policy matmove_catalog_upload on storage.objects for insert to authenticated
with check(bucket_id='product_images' and public.matmove_catalog_is_merchant()
 and (name like auth.uid()::text||'/%' or name like auth.uid()::text||'-%'));
notify pgrst,'reload schema';
commit;
select public as catalog_photos_public,file_size_limit,
 allowed_mime_types from storage.buckets where id='product_images';
-- Unknown restrictive policies are deliberately retained. If uploads still fail,
-- return the read-only Storage policy audit in PRODUCTION_RIDE_AUDIT.sql.
