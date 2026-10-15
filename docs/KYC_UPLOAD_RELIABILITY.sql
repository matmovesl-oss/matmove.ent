
-- Run the entire file in the shared Supabase project's SQL editor as postgres.
-- Disable the editor's automatic SQL rewriting; this script keeps RLS enabled.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('kyc-documents','kyc-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Service-role Admin document APIs retain access; customers see only their own folder.
drop policy if exists matmove_kyc_owner_read on storage.objects;
create policy matmove_kyc_owner_read on storage.objects for select to authenticated using(bucket_id='kyc-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists matmove_kyc_owner_insert on storage.objects;
create policy matmove_kyc_owner_insert on storage.objects for insert to authenticated with check(bucket_id='kyc-documents' and (storage.foldername(name))[1]=auth.uid()::text);
-- Restrictive policies also contain any older, overly broad authenticated policies.
drop policy if exists matmove_kyc_read_scope on storage.objects;
create policy matmove_kyc_read_scope on storage.objects as restrictive for select to authenticated using(bucket_id<>'kyc-documents' or (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists matmove_kyc_insert_scope on storage.objects;
create policy matmove_kyc_insert_scope on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'kyc-documents' or (storage.foldername(name))[1]=auth.uid()::text);
-- Replacements use a new path. Submitted documents are not overwritten or deleted by this form.
drop policy if exists matmove_kyc_no_customer_overwrite on storage.objects;
create policy matmove_kyc_no_customer_overwrite on storage.objects as restrictive for update to authenticated using(bucket_id<>'kyc-documents') with check(bucket_id<>'kyc-documents');
drop policy if exists matmove_kyc_no_customer_delete on storage.objects;
create policy matmove_kyc_no_customer_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'kyc-documents');
drop policy if exists matmove_kyc_no_anonymous on storage.objects;
create policy matmove_kyc_no_anonymous on storage.objects as restrictive for all to anon using(bucket_id<>'kyc-documents') with check(bucket_id<>'kyc-documents');
NOTIFY pgrst, 'reload schema';
commit;
