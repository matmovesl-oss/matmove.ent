
-- MatMove security lockdown phase 7: enforce an allow-list for Storage writes.

-- These old policies had inverted predicates. In particular, the anonymous
-- ALL policy could match every bucket except profile photos, while the
-- authenticated UPDATE/DELETE policies could match every bucket except
-- profile photos. Remove them rather than attempting to layer around them.
drop policy if exists matmove_profile_photo_no_anonymous on storage.objects;
drop policy if exists matmove_profile_photo_no_delete on storage.objects;
drop policy if exists matmove_profile_photo_no_overwrite on storage.objects;
drop policy if exists matmove_product_image_no_overwrite on storage.objects;
drop policy if exists matmove_profile_photo_insert_scope on storage.objects;

-- Every authenticated upload must match one explicitly supported bucket.
-- This restrictive policy is ANDed with each bucket's normal ownership/
-- permission policy, so a broad permissive policy cannot create a bypass.
drop policy if exists matmove_authenticated_upload_allowlist on storage.objects;
create policy matmove_authenticated_upload_allowlist
  on storage.objects as restrictive
  for insert to authenticated
  with check (
    (
      bucket_id = 'matmove-profile-photos'
      and (storage.foldername(name))[1] = auth.uid()::text
    )
    or (
      bucket_id = 'kyc-documents'
      and (storage.foldername(name))[1] = auth.uid()::text
    )
    or (
      bucket_id = 'product_images'
      and public.matmove_catalog_is_merchant()
      and (
        name like auth.uid()::text || '/%'
        or name like auth.uid()::text || '-%'
      )
    )
    or (
      bucket_id = 'event-flyers'
      and public.matmove_admin_can('events.overview')
    )
  );

-- Restrict reads of private personal-document/photo buckets to the owner,
-- even if another legacy permissive policy is added later.
drop policy if exists matmove_private_personal_storage_read_scope on storage.objects;
create policy matmove_private_personal_storage_read_scope
  on storage.objects as restrictive
  for select to anon, authenticated
  using (
    bucket_id not in ('kyc-documents','matmove-profile-photos')
    or (
      auth.uid() is not null
      and (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- The only authenticated object updates/deletes permitted through Storage
-- are event-flyer management actions by staff with events.overview.
drop policy if exists matmove_authenticated_storage_update_allowlist on storage.objects;
create policy matmove_authenticated_storage_update_allowlist
  on storage.objects as restrictive
  for update to authenticated
  using (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  )
  with check (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  );

drop policy if exists matmove_authenticated_storage_delete_allowlist on storage.objects;
create policy matmove_authenticated_storage_delete_allowlist
  on storage.objects as restrictive
  for delete to authenticated
  using (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  );

notify pgrst, 'reload schema';
