
-- MatMove security lockdown phase 6: remove legacy admin table dependencies
-- and close broad Storage object policies.

-- Replace legacy admin checks with the verified MatMove staff permission registry.
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can view all kyc" on public.kyc_submissions;

-- KYC evidence must not be served from public object URLs.
update storage.buckets
set public = false
where id = 'kyc-documents';

-- Remove public KYC read and unrestricted KYC upload policies.
drop policy if exists "Public Access KYC" on storage.objects;
drop policy if exists "Users upload KYC Documents" on storage.objects;
drop policy if exists "Allow authenticated uploads" on storage.objects;

-- Remove old generic catalogue object policies. These policies used
-- bucket_id <> 'product_images', which accidentally matched every other
-- bucket and could grant uploads, overwrites or deletes outside the catalogue.
drop policy if exists "Auth Upload" on storage.objects;
drop policy if exists "Merchant Image Upload" on storage.objects;
drop policy if exists matmove_product_image_owner_guard on storage.objects;
drop policy if exists matmove_catalog_upload_scope on storage.objects;
drop policy if exists matmove_catalog_no_delete on storage.objects;
drop policy if exists matmove_catalog_no_overwrite on storage.objects;

-- Keep KYC upload/read private and scoped to the Auth user's own folder.
-- Admin document review uses the service-role server endpoint to create
-- short-lived signed URLs, so the browser never needs a public KYC bucket.
drop policy if exists matmove_kyc_private_insert_scope on storage.objects;
create policy matmove_kyc_private_insert_scope
  on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'kyc-documents'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists matmove_kyc_private_select_scope on storage.objects;
create policy matmove_kyc_private_select_scope
  on storage.objects as restrictive
  for select to anon, authenticated
  using (
    bucket_id <> 'kyc-documents'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- Product photos are public content, but upload is restricted to the
-- authenticated owner of a real MatMove merchant account.
drop policy if exists matmove_product_image_merchant_insert_scope on storage.objects;
create policy matmove_product_image_merchant_insert_scope
  on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'product_images'
    or (
      public.matmove_catalog_is_merchant()
      and (
        name like auth.uid()::text || '/%'
        or name like auth.uid()::text || '-%'
      )
    )
  );

-- Legacy hyphenated bucket remains read-only for clients. New managed uploads
-- use the product_images bucket and the permission-checked policies above.
drop policy if exists matmove_legacy_product_images_read_only on storage.objects;
create policy matmove_legacy_product_images_read_only
  on storage.objects as restrictive
  for insert to authenticated
  with check (bucket_id <> 'product-images');

-- No generic browser update or delete permission remains. Event flyer changes
-- are permitted only by the explicit events.overview staff policies.
notify pgrst, 'reload schema';
