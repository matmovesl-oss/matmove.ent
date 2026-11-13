-- Allow authorized Homepage Posts admins to upload public post artwork.
-- Keep the authenticated storage insert allowlist restrictive for every bucket.
drop policy if exists matmove_authenticated_upload_allowlist on storage.objects;

create policy matmove_authenticated_upload_allowlist
on storage.objects
as restrictive
for insert
to authenticated
with check (
  (
    bucket_id = 'matmove-profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  or (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  or (
    bucket_id = 'product_images'
    and public.matmove_catalog_is_merchant()
    and (
      name like ((select auth.uid())::text || '/%')
      or name like ((select auth.uid())::text || '-%')
    )
  )
  or (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  )
  or (
    bucket_id = 'matmove-homepage-posts'
    and public.matmove_admin_can('notifications')
  )
);
