
drop policy if exists matmove_kyc_assigned_staff_storage_read on storage.objects;

create policy matmove_kyc_assigned_staff_storage_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'kyc-documents'
  and (select public.matmove_admin_can('kyc'))
);

comment on policy matmove_kyc_assigned_staff_storage_read on storage.objects
is 'Allows only active MatMove staff with KYC permission (or owner access) to read private KYC documents; customer access remains limited to own folder.';
