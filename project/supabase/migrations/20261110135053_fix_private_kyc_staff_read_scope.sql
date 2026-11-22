
BEGIN;

-- KYC documents: customers may read their own files; authenticated staff
-- with the KYC permission may read customer files for KYC work.
DROP POLICY IF EXISTS matmove_kyc_private_select_scope ON storage.objects;
DROP POLICY IF EXISTS matmove_kyc_private_select_scope_anon ON storage.objects;
DROP POLICY IF EXISTS matmove_kyc_private_select_scope_authenticated ON storage.objects;

CREATE POLICY matmove_kyc_private_select_scope_anon
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon
USING (
  bucket_id <> 'kyc-documents'
  OR (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
);

CREATE POLICY matmove_kyc_private_select_scope_authenticated
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  bucket_id <> 'kyc-documents'
  OR (
    auth.uid() IS NOT NULL
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.matmove_admin_can('kyc')
    )
  )
);

-- Keep the general personal-storage restriction focused on profile photos.
-- This prevents it from accidentally overriding the KYC staff-read permission.
DROP POLICY IF EXISTS matmove_private_personal_storage_read_scope ON storage.objects;

CREATE POLICY matmove_private_personal_storage_read_scope
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
  bucket_id <> 'matmove-profile-photos'
  OR (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
);

COMMIT;
