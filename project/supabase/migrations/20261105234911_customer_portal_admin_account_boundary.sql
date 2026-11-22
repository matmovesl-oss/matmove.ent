-- Close the no-profile Admin session edge case on the Customer Portal boundary.
begin;

create or replace function public.matmove_customer_me()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $me$
declare p public.profiles%rowtype; v_role text; v_roles jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.'; end if;

 -- Check Admin access before profile lookup; some invited/legacy staff rows
 -- exist without a corresponding Customer profile.
 if exists(
   select 1 from public.matmove_staff_access s
   where s.id=auth.uid() and s.is_active=true and s.removed_at is null
 ) then
   raise exception 'FORBIDDEN: An active Admin account cannot use the Customer Portal.';
 end if;

 select * into p from public.profiles where id=auth.uid();
 if not found then return null; end if;
 if p.role is not null and p.role not in ('rider','driver','merchant') then
   raise exception 'FORBIDDEN: A customer account is required.';
 end if;
 if exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text not in ('rider','driver','merchant')) then
   raise exception 'FORBIDDEN: A customer account is required.';
 end if;
 select coalesce(jsonb_agg(r.role::text order by r.role::text),'[]'::jsonb) into v_roles
 from public.user_roles r where r.profile_id=p.id;
 if jsonb_array_length(v_roles)=1 then v_role:=v_roles->>0;
 elsif jsonb_array_length(v_roles)>1 and v_roles ? p.role then v_role:=p.role;
 elsif jsonb_array_length(v_roles)=0 then v_role:=p.role;
 else raise exception 'CONFLICT: Customer roles need support review.'; end if;
 if v_role is null then return null; end if;
 return jsonb_build_object(
   'user',jsonb_build_object('id',p.id,'email',p.email,'phone',coalesce(p.phone,''),
     'firstName',coalesce(p.first_name,''),'lastName',coalesce(p.last_name,'')),
   'roles',jsonb_build_array(v_role),'kycStatus',coalesce(p.kyc_status,'not_started')
 );
end;
$me$;

create or replace function public.matmove_save_customer_account(p_role text,p_phone text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $account$
declare u auth.users%rowtype;p public.profiles%rowtype;
 v_role text:=lower(trim(coalesce(p_role,'')));v_phone text;v_existing text;v_count integer;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in before completing your account.'; end if;

 -- A currently authorized Admin staff member may not create a second Customer identity.
 if exists(
   select 1 from public.matmove_staff_access s
   where s.id=auth.uid() and s.is_active=true and s.removed_at is null
 ) then
   raise exception 'FORBIDDEN: An active Admin account cannot create a Customer account.';
 end if;

 if v_role not in ('rider','driver','merchant') then raise exception 'INVALID: Choose rider, driver or merchant.'; end if;
 select * into u from auth.users where id=auth.uid() for update;
 if not found or nullif(u.email,'') is null then raise exception 'FORBIDDEN: An authenticated email account is required.'; end if;
 v_phone:=public.matmove_customer_phone(p_phone);
 select * into p from public.profiles where id=u.id for update;
 if p.kyc_status='approved' then
  if p.role is distinct from v_role or public.matmove_customer_phone(coalesce(nullif(p.phone,''),p.phone_number)) is distinct from v_phone then
   raise exception 'LOCKED: Your verified identity is locked. Contact MatMove support for changes.';
  end if;
  return public.matmove_customer_me();
 end if;
 if p.role is not null and p.role not in ('rider','driver','merchant') then
  raise exception 'FORBIDDEN: Administrative accounts cannot be converted here.';
 end if;
 if exists(select 1 from public.user_roles where profile_id=u.id and role::text not in ('rider','driver','merchant')) then
  raise exception 'FORBIDDEN: Administrative roles cannot be changed here.';
 end if;
 select count(*),min(role::text) into v_count,v_existing from public.user_roles where profile_id=u.id;
 if v_count>1 then
  if p.role in ('rider','driver','merchant') and exists(select 1 from public.user_roles where profile_id=u.id and role::text=p.role) then v_existing:=p.role;
  else raise exception 'CONFLICT: Customer roles need support review.'; end if;
 end if;
 v_existing:=coalesce(p.customer_onboarding_role,v_existing,case when p.kyc_status='approved' then p.role else null end);
 if p.kyc_status='approved' and p.role is not null and p.role<>v_role then raise exception 'CONFLICT: Approved account roles need support review.'; end if;
 if v_existing is not null and v_existing<>v_role then raise exception 'FORBIDDEN: Your account type is already assigned. Contact support to change it.'; end if;
 if exists(select 1 from public.profiles where id<>u.id and
  (case
   when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^0[0-9]{8}$'
    then '+232'||substr(regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g'),2)
   when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^[0-9]{8}$'
    then '+232'||regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g')
   when regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g') ~ '^232[0-9]{8}$'
    then '+'||regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g')
   else regexp_replace(coalesce(nullif(phone,''),phone_number,''),'[[:space:]().-]','','g')
  end)=v_phone
 ) then raise exception 'CONFLICT: This phone number is already registered. Sign in to that account or use another number.'; end if;

 insert into public.profiles(id,email,phone,phone_number,role,kyc_status,customer_onboarding_role,customer_account_started_at,updated_at)
 values(u.id,u.email,v_phone,v_phone,v_role,'not_started',v_role,now(),now())
 on conflict(id) do update set email=excluded.email,phone=v_phone,phone_number=v_phone,role=v_role,
  customer_onboarding_role=v_role,customer_account_started_at=coalesce(profiles.customer_account_started_at,now()),
  kyc_status=case when coalesce(profiles.kyc_status,'pending')='pending'
     and not exists(select 1 from public.kyc_submissions where profile_id=u.id)
     then 'not_started' else profiles.kyc_status end,
  updated_at=now();
 insert into public.user_roles(profile_id,role)
 values(u.id,v_role::public.user_role) on conflict(profile_id,role) do nothing;
 perform public.ensure_matmove_wallets(u.id);
 return public.matmove_customer_me();
end;
$account$;

revoke all on function public.matmove_customer_me() from public,anon;
grant execute on function public.matmove_customer_me() to authenticated,service_role;
revoke all on function public.matmove_save_customer_account(text,text) from public,anon;
grant execute on function public.matmove_save_customer_account(text,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;