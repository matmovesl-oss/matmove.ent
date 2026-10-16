
-- Customer account setup and optional KYC. Shared Customer/Admin Supabase project.
-- Includes compatibility with existing Admin KYC review and private document links.
-- Run this complete file once all related Customer replacement files are ready.
begin;

-- Repair the legacy role trigger before the customer-role backfill runs.
-- INVOKER observes the effective DB role of the actual UPDATE statement.
-- Secured onboarding RPCs run as their trusted owner; browsers run as authenticated.
create or replace function public.prevent_unauthorized_profile_role_change()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $role_guard$
begin
 if new.role is not distinct from old.role then return new;end if;
 if current_user in ('postgres','supabase_admin','service_role') then return new;end if;
 raise exception 'FORBIDDEN: Profile role changes require an authorized server function.';
end;
$role_guard$;
revoke all on function public.prevent_unauthorized_profile_role_change() from public,anon,authenticated;
drop trigger if exists prevent_unauthorized_profile_role_change on public.profiles;
create trigger prevent_unauthorized_profile_role_change before update of role on public.profiles
for each row execute function public.prevent_unauthorized_profile_role_change();

alter table public.profiles add column if not exists customer_onboarding_role text;
alter table public.profiles add column if not exists customer_account_started_at timestamptz;

create or replace function public.matmove_customer_phone(p_phone text)
returns text language plpgsql immutable set search_path=pg_catalog,public as $phone$
declare v text:=regexp_replace(trim(coalesce(p_phone,'')),'[[:space:]().-]','','g');
begin
 if v ~ '^0[0-9]{8}$' then v:='+232'||substr(v,2);
 elsif v ~ '^[0-9]{8}$' then v:='+232'||v;
 elsif v ~ '^232[0-9]{8}$' then v:='+'||v;end if;
 if v !~ '^\+[1-9][0-9]{7,14}$' or (v like '+232%' and v !~ '^\+232[0-9]{8}$') then
  raise exception 'INVALID: Enter a valid phone number, for example +232 76 000 000.';
 end if;
 return v;
end;
$phone$;

create or replace function public.matmove_customer_me()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $me$
declare p public.profiles%rowtype;v_role text;v_roles jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.';end if;
 select * into p from public.profiles where id=auth.uid();
 if not found then return null;end if;
 if p.role is not null and p.role not in ('rider','driver','merchant') then raise exception 'FORBIDDEN: A customer account is required.';end if;
 if exists(select 1 from public.user_roles where profile_id=p.id and role::text not in ('rider','driver','merchant')) then raise exception 'FORBIDDEN: A customer account is required.';end if;
 select coalesce(jsonb_agg(role::text order by role::text),'[]'::jsonb) into v_roles from public.user_roles where profile_id=p.id;
 if jsonb_array_length(v_roles)=1 then v_role:=v_roles->>0;
 elsif jsonb_array_length(v_roles)>1 and v_roles ? p.role then v_role:=p.role;
 elsif jsonb_array_length(v_roles)=0 then v_role:=p.role;
 else raise exception 'CONFLICT: Customer roles need support review.';end if;
 if v_role is null then return null;end if;
 return jsonb_build_object('user',jsonb_build_object('id',p.id,'email',p.email,'phone',coalesce(p.phone,''),'firstName',coalesce(p.first_name,''),'lastName',coalesce(p.last_name,'')),'roles',jsonb_build_array(v_role),'kycStatus',coalesce(p.kyc_status,'not_started'));
end;
$me$;

create or replace function public.matmove_save_customer_account(p_role text,p_phone text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $account$
declare u auth.users%rowtype;p public.profiles%rowtype;v_role text:=lower(trim(coalesce(p_role,'')));v_phone text;v_existing text;v_count integer;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in before completing your account.';end if;
 if v_role not in ('rider','driver','merchant') then raise exception 'INVALID: Choose rider, driver or merchant.';end if;
 select * into u from auth.users where id=auth.uid() for update;
 if not found or nullif(u.email,'') is null then raise exception 'FORBIDDEN: An authenticated email account is required.';end if;
 v_phone:=public.matmove_customer_phone(p_phone);
 select * into p from public.profiles where id=u.id for update;
 if p.role is not null and p.role not in ('rider','driver','merchant') then raise exception 'FORBIDDEN: Administrative accounts cannot be converted here.';end if;
 if exists(select 1 from public.user_roles where profile_id=u.id and role::text not in ('rider','driver','merchant')) then raise exception 'FORBIDDEN: Administrative roles cannot be changed here.';end if;
 select count(*),min(role::text) into v_count,v_existing from public.user_roles where profile_id=u.id;
 if v_count>1 then
  if p.role in ('rider','driver','merchant') and exists(select 1 from public.user_roles where profile_id=u.id and role::text=p.role) then v_existing:=p.role;
  else raise exception 'CONFLICT: Customer roles need support review.';end if;
 end if;
 v_existing:=coalesce(p.customer_onboarding_role,v_existing,case when p.kyc_status='approved' then p.role else null end);
 if p.kyc_status='approved' and p.role is not null and p.role<>v_role then raise exception 'CONFLICT: Approved account roles need support review.';end if;
 if v_existing is not null and v_existing<>v_role then raise exception 'FORBIDDEN: Your account type is already assigned. Contact support to change it.';end if;
 if exists(select 1 from public.profiles where id<>u.id and (case when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^0[0-9]{8}$' then '+232'||substr(regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g'),2) when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^[0-9]{8}$' then '+232'||regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^232[0-9]{8}$' then '+'||regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') else regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') end)=v_phone) then raise exception 'CONFLICT: This phone number is already registered. Sign in to that account or use another number.';end if;
 insert into public.profiles(id,email,phone,phone_number,role,kyc_status,customer_onboarding_role,customer_account_started_at,updated_at)
 values(u.id,u.email,v_phone,v_phone,v_role,'not_started',v_role,now(),now())
 on conflict(id) do update set email=excluded.email,phone=v_phone,phone_number=v_phone,role=v_role,customer_onboarding_role=v_role,customer_account_started_at=coalesce(profiles.customer_account_started_at,now()),kyc_status=case when coalesce(profiles.kyc_status,'pending')='pending' and not exists(select 1 from public.kyc_submissions where profile_id=u.id) then 'not_started' else profiles.kyc_status end,updated_at=now();
 insert into public.user_roles(profile_id,role) values(u.id,v_role::public.user_role) on conflict(profile_id,role) do nothing;
 perform public.ensure_matmove_wallets(u.id);
 return public.matmove_customer_me();
end;
$account$;

create or replace function public.matmove_submit_customer_kyc(p_role text,p_details jsonb,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $kyc$
declare v_user uuid:=auth.uid();v_role text:=lower(trim(coalesce(p_role,'')));p public.profiles%rowtype;v_submission uuid;v_status text;d jsonb;o record;v_types text[]:=array[]::text[];v_paths text[]:=array[]::text[];v_path text;v_type text;v_size bigint;v_dob date;v_phone text;v_first text;v_last text;
begin
 if v_user is null then raise exception 'FORBIDDEN: Sign in before submitting KYC.';end if;
 if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(p_documents) is distinct from 'array' then raise exception 'INVALID: Personal details and uploaded documents are required.';end if;
 v_first:=trim(coalesce(p_details->>'firstName',''));v_last:=trim(coalesce(p_details->>'lastName',''));
 if length(v_first)<2 or length(v_first)>100 or length(v_last)<2 or length(v_last)>100 then raise exception 'INVALID: Enter your first and last name.';end if;
 begin v_dob:=(p_details->>'dateOfBirth')::date;exception when others then raise exception 'INVALID: Enter a valid date of birth.';end;
 if v_dob is null or v_dob>=current_date or v_dob<date '1900-01-01' then raise exception 'INVALID: Enter your actual date of birth.';end if;
 if length(trim(coalesce(p_details->>'residentialAddress','')))<5 then raise exception 'INVALID: Enter your residential address.';end if;
 perform public.matmove_save_customer_account(v_role,p_details->>'phone');
 select * into p from public.profiles where id=v_user for update;
 if p.kyc_status='approved' then
  select id into v_submission from public.kyc_submissions where profile_id=v_user and target_role::text=v_role and status::text='approved' order by created_at desc limit 1;
  return jsonb_build_object('success',true,'role',v_role,'kyc_status','approved','kyc_submission_id',v_submission,'already_approved',true);
 end if;
 if jsonb_array_length(p_documents)<2 or jsonb_array_length(p_documents)>12 then raise exception 'INVALID: Complete the required document and selfie uploads.';end if;
 for d in select value from jsonb_array_elements(p_documents) loop
  v_path:=d->>'storage_path';v_type:=d->>'document_type';
  if v_type is null or v_type not in ('identity_front','identity_back','drivers_license_front','drivers_license_back','business_document','selfie') then raise exception 'INVALID: Unsupported KYC document type.';end if;
  if v_path is null or left(v_path,length(v_user::text)+1)<>v_user::text||'/' or v_path like '%/../%' or v_path=any(v_paths) then raise exception 'INVALID: Each document must be a distinct upload belonging to your account.';end if;
  select metadata into o from storage.objects where bucket_id='kyc-documents' and name=v_path;
  if not found then raise exception 'INVALID: An upload could not be verified. Upload it again before submitting.';end if;
  if coalesce(o.metadata->>'size','') !~ '^[0-9]+$' then raise exception 'INVALID: Uploaded file size could not be verified.';end if;
  v_size:=(o.metadata->>'size')::bigint;
  if v_size<1 or v_size>10485760 or coalesce(o.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','application/pdf') or (v_type='selfie' and o.metadata->>'mimetype'='application/pdf') then raise exception 'INVALID: Use supported images or PDF files, up to 10 MB; the selfie must be an image.';end if;
  v_paths:=array_append(v_paths,v_path);v_types:=array_append(v_types,v_type);
 end loop;
 if not ('selfie'=any(v_types)) then raise exception 'INVALID: A completed selfie upload is required.';end if;
 if v_role='driver' then
  if not ('drivers_license_front'=any(v_types)) then raise exception 'INVALID: Upload your driving licence.';end if;
 elsif v_role='merchant' and coalesce(p_details->>'businessType','')<>'Digital / Online Only' then
  if not ('business_document'=any(v_types)) then raise exception 'INVALID: Upload your business document.';end if;
 else
  if not ('identity_front'=any(v_types) and 'identity_back'=any(v_types)) then raise exception 'INVALID: Upload both sides of your identity document.';end if;
 end if;
 -- Requested policy: riders complete KYC automatically; business roles require Admin review.
 v_status:=case when v_role='rider' then 'approved' else 'submitted' end;
 select id into v_submission from public.kyc_submissions where profile_id=v_user and target_role::text=v_role and status::text in ('draft','submitted','under_review') order by created_at desc limit 1;
 if v_submission is null then
  insert into public.kyc_submissions(profile_id,target_role,status,submitted_at,reviewed_at)
  values(v_user,v_role::public.user_role,v_status::public.kyc_status,now(),case when v_role='rider' then now() else null end) returning id into v_submission;
 else
  update public.kyc_submissions set status=v_status::public.kyc_status,submitted_at=coalesce(submitted_at,now()),reviewed_at=case when v_role='rider' then now() else null end where id=v_submission;
 end if;
 delete from public.kyc_documents where submission_id=v_submission;
 for d in select value from jsonb_array_elements(p_documents) loop
  select (metadata->>'size')::bigint into v_size from storage.objects where bucket_id='kyc-documents' and name=d->>'storage_path';
  insert into public.kyc_documents(submission_id,document_type,storage_path,file_name,file_size_bytes)
  values(v_submission,d->>'document_type',d->>'storage_path',left(coalesce(d->>'file_name','Document'),200),v_size);
 end loop;
 update public.profiles set first_name=v_first,last_name=v_last,full_name=concat_ws(' ',v_first,nullif(trim(p_details->>'middleName'),''),v_last),date_of_birth=v_dob,nationality=nullif(p_details->>'nationality',''),country=coalesce(nullif(p_details->>'country',''),'Sierra Leone'),city=nullif(p_details->>'city',''),residential_address=trim(p_details->>'residentialAddress'),address=trim(p_details->>'residentialAddress'),vehicle_type=nullif(p_details->>'vehicleType',''),plate_number=nullif(p_details->>'plateNumber',''),driver_license_no=nullif(p_details->>'driverLicenseNumber',''),business_name=nullif(p_details->>'businessName',''),business_type=nullif(p_details->>'businessType',''),tax_id=nullif(p_details->>'businessRegNumber',''),
 id_card_url=(select storage_path from public.kyc_documents where submission_id=v_submission and document_type='identity_front' order by created_at,id limit 1),
 id_card_back_url=(select storage_path from public.kyc_documents where submission_id=v_submission and document_type='identity_back' order by created_at,id limit 1),
 selfie_url=(select storage_path from public.kyc_documents where submission_id=v_submission and document_type='selfie' order by created_at,id limit 1),
 license_doc_url=(select storage_path from public.kyc_documents where submission_id=v_submission and document_type='drivers_license_front' order by created_at,id limit 1),
 business_doc_url=(select storage_path from public.kyc_documents where submission_id=v_submission and document_type='business_document' order by created_at,id limit 1),
 kyc_status=v_status,updated_at=now() where id=v_user;
 return jsonb_build_object('success',true,'role',v_role,'kyc_status',v_status,'kyc_submission_id',v_submission,'documents_saved',jsonb_array_length(p_documents));
end;
$kyc$;

-- Retain the old RPC signature, but route it through the same upload checks.
create or replace function public.submit_customer_kyc(p_role text,p_first_name text default '',p_last_name text default '',p_phone text default '',p_address text default '',p_documents jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $legacy$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where id=auth.uid();
 return public.matmove_submit_customer_kyc(p_role,jsonb_build_object('firstName',p_first_name,'lastName',p_last_name,'phone',p_phone,'residentialAddress',p_address,'dateOfBirth',p.date_of_birth,'businessType',p.business_type),p_documents);
end;
$legacy$;

-- Customers cannot approve themselves by writing directly to these fields/tables.
create or replace function public.matmove_customer_protect_approval()
returns trigger language plpgsql set search_path=pg_catalog,public as $guard$
declare v_review boolean:=false;
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   if new.role is not null or coalesce(new.kyc_status,'pending') not in ('pending','not_started','draft') or new.is_wallet_frozen then raise exception 'FORBIDDEN: Use the secure customer account setup.';end if;
  else
   if new.role is distinct from old.role or new.is_wallet_frozen is distinct from old.is_wallet_frozen or new.customer_onboarding_role is distinct from old.customer_onboarding_role
    or new.id_card_url is distinct from old.id_card_url or new.id_card_back_url is distinct from old.id_card_back_url
    or new.selfie_url is distinct from old.selfie_url or new.license_doc_url is distinct from old.license_doc_url or new.business_doc_url is distinct from old.business_doc_url
   then raise exception 'FORBIDDEN: Account roles, document references and freeze controls require an authorized server function.';end if;
   if new.kyc_status is distinct from old.kyc_status then
    -- Preserve the existing Admin review screen, using trusted DB assignments only.
    if current_user='authenticated' and to_regprocedure('public.matmove_admin_any(text[])') is not null then
     execute 'select public.matmove_admin_any(ARRAY[''kyc'']::text[])' into v_review;
    end if;
    if not coalesce(v_review,false) or new.role is null or new.role not in ('rider','driver','merchant') or new.kyc_status is null or new.kyc_status not in ('approved','rejected','resubmission_required')
     or not exists(select 1 from public.kyc_submissions where profile_id=old.id and target_role::text=old.role)
    then raise exception 'FORBIDDEN: KYC approval requires an authorized server function or assigned KYC reviewer and a submitted verification record.';end if;
    new.updated_at:=now();
   end if;
  end if;
 end if;
 return new;
end;
$guard$;
drop trigger if exists matmove_customer_protect_approval on public.profiles;
create trigger matmove_customer_protect_approval before insert or update on public.profiles for each row execute function public.matmove_customer_protect_approval();

-- Keep submission review status in sync when the existing Admin page reviews a profile.
create or replace function public.matmove_customer_sync_admin_review()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $review$
declare v_review boolean:=false;v_submission uuid;
begin
 if new.kyc_status is not distinct from old.kyc_status or new.kyc_status is null or new.kyc_status not in ('approved','rejected','resubmission_required') then return new;end if;
 if auth.uid() is null or to_regprocedure('public.matmove_admin_any(text[])') is null then return new;end if;
 execute 'select public.matmove_admin_any(ARRAY[''kyc'']::text[])' into v_review;
 if not coalesce(v_review,false) then return new;end if;
 select id into v_submission from public.kyc_submissions where profile_id=new.id and target_role::text=new.role order by created_at desc,id desc limit 1 for update;
 if v_submission is not null then
  update public.kyc_submissions set status=(case when new.kyc_status='approved' then 'approved' else 'rejected' end)::public.kyc_status,
   reviewed_at=now(),reviewer_id=auth.uid(),rejection_reason=case when new.kyc_status='approved' then null when new.kyc_status='resubmission_required' then 'Resubmission required. Contact support for the review details.' else 'Verification rejected. Contact support for the review details.' end where id=v_submission;
 end if;
 return new;
end;
$review$;
revoke all on function public.matmove_customer_sync_admin_review() from public,anon,authenticated;
drop trigger if exists matmove_customer_sync_admin_review on public.profiles;
create trigger matmove_customer_sync_admin_review after update of kyc_status on public.profiles for each row execute function public.matmove_customer_sync_admin_review();
revoke insert,update,delete on public.user_roles,public.kyc_submissions,public.kyc_documents from anon,authenticated;

-- Repair the role mismatch for existing customer-only memberships.
update public.profiles p set role=r.role,customer_onboarding_role=r.role,updated_at=now()
from (select profile_id,min(role::text) role from public.user_roles group by profile_id having count(*)=1 and min(role::text) in ('rider','driver','merchant')) r
where p.id=r.profile_id and p.role is null;

revoke all on function public.matmove_customer_phone(text) from public,anon,authenticated;
revoke all on function public.matmove_customer_me() from public,anon;
revoke all on function public.matmove_save_customer_account(text,text) from public,anon;
revoke all on function public.matmove_submit_customer_kyc(text,jsonb,jsonb) from public,anon;
revoke all on function public.submit_customer_kyc(text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.matmove_customer_me() to authenticated,service_role;
grant execute on function public.matmove_save_customer_account(text,text) to authenticated,service_role;
grant execute on function public.matmove_submit_customer_kyc(text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.submit_customer_kyc(text,text,text,text,text,jsonb) to authenticated,service_role;
grant usage on schema public to authenticated,service_role;
notify pgrst,'reload schema';
commit;
