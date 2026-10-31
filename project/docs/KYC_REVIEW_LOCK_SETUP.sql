
-- KYC identity locks, private resumable drafts and atomic Admin decisions.
-- Run AFTER CUSTOMER_ONBOARDING_SETUP.sql in the ONE shared Supabase project.
-- Run the entire file as postgres. RLS stays enabled.
begin;
do $requirements$
begin
 if to_regprocedure('public.matmove_save_customer_account(text,text)') is null or to_regprocedure('public.matmove_admin_any(text[])') is null then
  raise exception 'SETUP_REQUIRED: Complete Customer onboarding and Admin staff setup first.';
 end if;
end;
$requirements$;

alter table public.profiles add column if not exists kyc_rejection_reason text;
alter table public.profiles add column if not exists kyc_reviewed_at timestamptz;
alter table public.profiles add column if not exists kyc_reviewed_by uuid references auth.users(id);
alter table public.profiles add column if not exists kyc_review_version bigint not null default 0;

create table if not exists public.matmove_kyc_drafts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}',
 step text not null default 'personal',
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 constraint matmove_kyc_draft_payload_check check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 constraint matmove_kyc_draft_step_check check(step in ('personal','identity','documents','selfie','vehicle','review'))
);
create table if not exists public.matmove_kyc_review_events (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id),
 submission_id uuid not null references public.kyc_submissions(id),
 reviewer_id uuid not null references auth.users(id),
 decision text not null check(decision in ('approved','rejected','resubmission_required')),
 reason text,
 review_version bigint not null,
 created_at timestamptz not null default now()
);
alter table public.matmove_kyc_drafts enable row level security;
alter table public.matmove_kyc_review_events enable row level security;
revoke all on public.matmove_kyc_drafts,public.matmove_kyc_review_events from public,anon,authenticated;
grant select on public.matmove_kyc_drafts,public.matmove_kyc_review_events to authenticated;
grant all on public.matmove_kyc_drafts,public.matmove_kyc_review_events to service_role;
drop policy if exists matmove_kyc_draft_owner_read on public.matmove_kyc_drafts;
create policy matmove_kyc_draft_owner_read on public.matmove_kyc_drafts for select to authenticated using(user_id=auth.uid());
drop policy if exists matmove_kyc_review_staff_read on public.matmove_kyc_review_events;
create policy matmove_kyc_review_staff_read on public.matmove_kyc_review_events for select to authenticated using(public.matmove_admin_any(ARRAY['kyc']::text[]));

create or replace function public.matmove_kyc_protect_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $identity$
declare k text;
begin
 if current_user in ('anon','authenticated') and (
  new.kyc_rejection_reason is distinct from old.kyc_rejection_reason or new.kyc_reviewed_at is distinct from old.kyc_reviewed_at
  or new.kyc_reviewed_by is distinct from old.kyc_reviewed_by or new.kyc_review_version is distinct from old.kyc_review_version
  or new.kyc_status is distinct from old.kyc_status
 ) then raise exception 'FORBIDDEN: Use the secure KYC submission or Admin review function.';end if;
 if old.role in ('rider','driver','merchant') and old.kyc_status='approved' and (auth.uid()=old.id or current_user in ('anon','authenticated')) then
  foreach k in array ARRAY['first_name','last_name','full_name','email','phone','phone_number','date_of_birth','nationality','country','residential_address','city','address','vehicle_type','plate_number','driver_license_no','business_name','business_type','tax_id','operating_region','id_card_url','id_card_back_url','selfie_url','license_doc_url','business_doc_url'] loop
   if to_jsonb(new)->k is distinct from to_jsonb(old)->k then raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';end if;
  end loop;
 end if;
 return new;
end;
$identity$;
drop trigger if exists matmove_kyc_protect_identity on public.profiles;
create trigger matmove_kyc_protect_identity before update on public.profiles for each row execute function public.matmove_kyc_protect_identity();

create or replace function public.matmove_customer_kyc_draft()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $draft_read$
declare p public.profiles%rowtype;d public.matmove_kyc_drafts%rowtype;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.';end if;
 perform public.matmove_customer_me();
 select * into p from public.profiles where id=auth.uid();
 if not found or p.role is null or p.role not in ('rider','driver','merchant') then raise exception 'FORBIDDEN: Complete your customer account first.';end if;
 select * into d from public.matmove_kyc_drafts where user_id=p.id;
 return jsonb_build_object('locked',p.kyc_status='approved','status',p.kyc_status,'reason',p.kyc_rejection_reason,'reviewVersion',p.kyc_review_version,'role',p.role,
  'payload',case when p.kyc_status='approved' then null else coalesce(d.payload,'{}'::jsonb) end,'step',coalesce(d.step,'personal'),'version',coalesce(d.version,0),'updatedAt',d.updated_at);
end;
$draft_read$;

create or replace function public.matmove_save_kyc_draft(p_expected bigint,p_step text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $draft_save$
declare p public.profiles%rowtype;d public.matmove_kyc_drafts%rowtype;k text;item jsonb;v_payload jsonb;v_path text;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.';end if;
 perform public.matmove_customer_me();
 select * into p from public.profiles where id=auth.uid() for update;
 if not found or p.role is null or p.role not in ('rider','driver','merchant') then raise exception 'FORBIDDEN: Complete your customer account first.';end if;
 if p.kyc_status='approved' then raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';end if;
 if p_expected is null or p_expected<0 or p_step is null or p_step not in ('personal','identity','documents','selfie','vehicle','review') then raise exception 'INVALID: Invalid draft version or verification step.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536 then raise exception 'INVALID: Verification draft is too large or invalid.';end if;
 for k in select jsonb_object_keys(p_payload) loop
  if k not in ('ob_role','ob_personal','ob_identity','ob_docs','ob_selfie','ob_vehicle','ob_driver','ob_merchant') then raise exception 'INVALID: Unsupported verification draft field.';end if;
 end loop;
 if p_payload ? 'ob_role' and p_payload->>'ob_role' is distinct from p.role then raise exception 'FORBIDDEN: The draft cannot change your account type.';end if;
 foreach k in array ARRAY['ob_personal','ob_identity','ob_docs','ob_vehicle','ob_driver','ob_merchant'] loop
  if p_payload ? k and jsonb_typeof(p_payload->k) is distinct from 'object' then raise exception 'INVALID: Invalid verification draft section.';end if;
 end loop;
 if p_payload ? 'ob_selfie' and jsonb_typeof(p_payload->'ob_selfie') not in ('object','null') then raise exception 'INVALID: Invalid selfie draft.';end if;
 for item in select value from jsonb_each(coalesce(p_payload->'ob_docs','{}'::jsonb)) union all select p_payload->'ob_selfie' where jsonb_typeof(p_payload->'ob_selfie')='object' loop
  v_path:=nullif(item->>'id','');
  if v_path is not null and (left(v_path,length(p.id::text)+1)<>p.id::text||'/' or v_path like '%/../%') then raise exception 'FORBIDDEN: Draft uploads must belong to your own account.';end if;
 end loop;
 select * into d from public.matmove_kyc_drafts where user_id=p.id for update;
 if coalesce(d.version,0)<>p_expected then raise exception 'CONFLICT: This draft changed in another session. Reload the saved draft before continuing.';end if;
 v_payload:=p_payload||jsonb_build_object('ob_role',p.role);
 insert into public.matmove_kyc_drafts(user_id,payload,step,version,updated_at) values(p.id,v_payload,p_step,p_expected+1,now())
 on conflict(user_id) do update set payload=excluded.payload,step=excluded.step,version=excluded.version,updated_at=excluded.updated_at
 returning * into d;
 return jsonb_build_object('version',d.version,'savedAt',d.updated_at);
end;
$draft_save$;

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
 if p.kyc_status='approved' then
  if p.role is distinct from v_role or public.matmove_customer_phone(coalesce(nullif(p.phone,''),p.phone_number)) is distinct from v_phone then raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';end if;
  return public.matmove_customer_me();
 end if;
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
 perform 1 from auth.users where id=v_user for update;
 select * into p from public.profiles where id=v_user for update;
 if p.kyc_status='approved' then raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';end if;
 if jsonb_typeof(p_details) is distinct from 'object' or jsonb_typeof(p_documents) is distinct from 'array' then raise exception 'INVALID: Personal details and uploaded documents are required.';end if;
 v_first:=trim(coalesce(p_details->>'firstName',''));v_last:=trim(coalesce(p_details->>'lastName',''));
 if length(v_first)<2 or length(v_first)>100 or length(v_last)<2 or length(v_last)>100 then raise exception 'INVALID: Enter your first and last name.';end if;
 begin v_dob:=(p_details->>'dateOfBirth')::date;exception when others then raise exception 'INVALID: Enter a valid date of birth.';end;
 if v_dob is null or v_dob>=current_date or v_dob<date '1900-01-01' then raise exception 'INVALID: Enter your actual date of birth.';end if;
 if length(trim(coalesce(p_details->>'residentialAddress','')))<5 then raise exception 'INVALID: Enter your residential address.';end if;
 perform public.matmove_save_customer_account(v_role,p_details->>'phone');
 select * into p from public.profiles where id=v_user for update;
 if p.kyc_status='approved' then raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';end if;
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
 kyc_status=v_status,kyc_rejection_reason=null,kyc_reviewed_at=case when v_role='rider' then now() else null end,kyc_reviewed_by=null,kyc_review_version=kyc_review_version+1,updated_at=now() where id=v_user;
 delete from public.matmove_kyc_drafts where user_id=v_user;
 return jsonb_build_object('success',true,'role',v_role,'kyc_status',v_status,'kyc_submission_id',v_submission,'documents_saved',jsonb_array_length(p_documents));
end;
$kyc$;


create or replace function public.matmove_admin_kyc_queue()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $queue$
declare result jsonb;
begin
 if auth.uid() is null or not public.matmove_admin_any(ARRAY['kyc']::text[]) then raise exception 'FORBIDDEN: KYC review access is required.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'profile_id',p.id,'submission_id',s.id,'target_role',p.role,'status',p.kyc_status,
  'rejection_reason',coalesce(p.kyc_rejection_reason,s.rejection_reason),'submitted_at',s.submitted_at,'created_at',p.created_at,'profile',to_jsonb(p)-'passcode') order by p.updated_at desc),'[]'::jsonb)
 into result from public.profiles p left join lateral(select * from public.kyc_submissions where profile_id=p.id and target_role::text=p.role order by created_at desc,id desc limit 1)s on true
 where p.role in ('rider','driver','merchant');
 return result;
end;
$queue$;

create or replace function public.matmove_review_customer_kyc(p_profile uuid,p_submission uuid,p_expected_version bigint,p_decision text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $decision$
declare p public.profiles%rowtype;s public.kyc_submissions%rowtype;d record;o record;types text[]:=ARRAY[]::text[];v_reason text:=btrim(coalesce(p_reason,''));v_version bigint;
begin
 if auth.uid() is null or not public.matmove_admin_any(ARRAY['kyc']::text[]) then raise exception 'FORBIDDEN: KYC review access is required.';end if;
 if p_decision is null or p_decision not in ('approved','rejected','resubmission_required') then raise exception 'INVALID: Choose an approval or rejection decision.';end if;
 if p_decision<>'approved' and (length(v_reason)<3 or length(v_reason)>2000) then raise exception 'INVALID: Enter a rejection reason between 3 and 2000 characters.';end if;
 select * into p from public.profiles where id=p_profile for update;
 if not found or p.role is null or p.role not in ('rider','driver','merchant') then raise exception 'NOT_FOUND: Customer profile not found.';end if;
 if p_expected_version is null or p.kyc_review_version<>p_expected_version then raise exception 'CONFLICT: This verification changed. Refresh the review queue.';end if;
 select * into s from public.kyc_submissions where profile_id=p.id and target_role::text=p.role order by created_at desc,id desc limit 1 for update;
 if not found or p_submission is null or s.id<>p_submission then raise exception 'CONFLICT: Refresh and review the latest submitted verification.';end if;
 if p_decision='approved' then
  if length(coalesce(p.first_name,''))<2 or length(coalesce(p.last_name,''))<2 or p.date_of_birth is null or p.date_of_birth>=current_date then raise exception 'INVALID: The customer must submit complete personal information.';end if;
  for d in select * from public.kyc_documents where submission_id=s.id loop
   if left(d.storage_path,length(p.id::text)+1)<>p.id::text||'/' or d.storage_path like '%/../%' then raise exception 'INVALID: Document ownership could not be verified.';end if;
   select metadata into o from storage.objects where bucket_id='kyc-documents' and name=d.storage_path;
   if not found then raise exception 'INVALID: A submitted document is missing from storage.';end if;
   if coalesce(o.metadata->>'size','') !~ '^[0-9]+$' then raise exception 'INVALID: Document size could not be verified.';end if;
   if (o.metadata->>'size')::bigint not between 1 and 10485760 or coalesce(o.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','application/pdf')
    or (d.document_type='selfie' and o.metadata->>'mimetype'='application/pdf') then raise exception 'INVALID: A submitted document is invalid.';end if;
   types:=array_append(types,d.document_type);
  end loop;
  if not ('selfie'=any(types)) then raise exception 'INVALID: A verified selfie is required.';end if;
  if p.role='driver' then
   if not ('drivers_license_front'=any(types)) then raise exception 'INVALID: A driving licence is required.';end if;
  elsif p.role='merchant' and coalesce(p.business_type,'')<>'Digital / Online Only' then
   if not ('business_document'=any(types)) then raise exception 'INVALID: A business document is required.';end if;
  elsif not ('identity_front'=any(types) and 'identity_back'=any(types)) then raise exception 'INVALID: Both sides of the identity document are required.';end if;
 end if;
 v_version:=p.kyc_review_version+1;
 update public.profiles set kyc_status=p_decision,kyc_rejection_reason=case when p_decision='approved' then null else v_reason end,
  kyc_reviewed_at=now(),kyc_reviewed_by=auth.uid(),kyc_review_version=v_version,updated_at=now() where id=p.id;
 update public.kyc_submissions set status=(case when p_decision='approved' then 'approved' else 'rejected' end)::public.kyc_status,
  rejection_reason=case when p_decision='approved' then null else v_reason end,reviewed_at=now(),reviewer_id=auth.uid() where id=s.id;
 insert into public.matmove_kyc_review_events(profile_id,submission_id,reviewer_id,decision,reason,review_version)
 values(p.id,s.id,auth.uid(),p_decision,case when p_decision='approved' then null else v_reason end,v_version);
 if p_decision='approved' then delete from public.matmove_kyc_drafts where user_id=p.id;end if;
 return jsonb_build_object('success',true,'profileId',p.id,'status',p_decision,'reason',case when p_decision='approved' then null else v_reason end,'reviewVersion',v_version);
end;
$decision$;

-- Show recorded historical reasons where a reviewed submission already holds one.
update public.profiles p set kyc_rejection_reason=s.rejection_reason from (
 select distinct on(profile_id) profile_id,rejection_reason from public.kyc_submissions
 where status::text='rejected' and nullif(rejection_reason,'') is not null order by profile_id,created_at desc,id desc
)s where p.id=s.profile_id and p.kyc_status in ('rejected','resubmission_required') and p.kyc_rejection_reason is null;

revoke all on function public.matmove_customer_kyc_draft() from public,anon;
revoke all on function public.matmove_save_kyc_draft(bigint,text,jsonb) from public,anon;
revoke all on function public.matmove_admin_kyc_queue() from public,anon;
revoke all on function public.matmove_review_customer_kyc(uuid,uuid,bigint,text,text) from public,anon;
grant execute on function public.matmove_customer_kyc_draft(),public.matmove_save_kyc_draft(bigint,text,jsonb),public.matmove_admin_kyc_queue(),public.matmove_review_customer_kyc(uuid,uuid,bigint,text,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
