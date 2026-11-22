-- MatMove staff/customer role lifecycle safeguard and targeted account repair.
begin;

create or replace function public.matmove_staff_resolve_customer_role(p_user_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public as $role$
declare v_profile_role text; v_saved_role text; v_role_count integer; v_single_role text;
begin
 select p.role::text,p.customer_onboarding_role into v_profile_role,v_saved_role
 from public.profiles p where p.id=p_user_id;
 if not found then return null; end if;
 if exists(select 1 from public.user_roles r where r.profile_id=p_user_id
           and r.role::text not in ('rider','driver','merchant')) then return null; end if;
 if v_saved_role in ('rider','driver','merchant') then
   if not exists(select 1 from public.user_roles r where r.profile_id=p_user_id)
      or exists(select 1 from public.user_roles r where r.profile_id=p_user_id and r.role::text=v_saved_role)
   then return v_saved_role; end if;
   return null;
 end if;
 select count(distinct r.role::text),min(r.role::text) into v_role_count,v_single_role
 from public.user_roles r where r.profile_id=p_user_id
 and r.role::text in ('rider','driver','merchant');
 if v_profile_role in ('rider','driver','merchant') then
   if v_role_count=0 or exists(select 1 from public.user_roles r where r.profile_id=p_user_id and r.role::text=v_profile_role)
   then return v_profile_role; end if;
 end if;
 if v_role_count=1 then return v_single_role; end if;
 return null;
end;
$role$;
revoke all on function public.matmove_staff_resolve_customer_role(uuid) from public,anon,authenticated;

-- Reject Customer Portal sessions for active Admin staff even when old customer memberships remain.
create or replace function public.matmove_customer_me()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $me$
declare p public.profiles%rowtype; v_role text; v_roles jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.'; end if;
 select * into p from public.profiles where id=auth.uid();
 if not found then return null; end if;
 if p.role is not null and p.role not in ('rider','driver','merchant') then
   raise exception 'FORBIDDEN: A customer account is required.';
 end if;
 if exists(select 1 from public.matmove_staff_access s where s.id=p.id and s.is_active=true and s.removed_at is null) then
   raise exception 'FORBIDDEN: An active Admin account cannot use the Customer Portal.';
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
 return jsonb_build_object('user',jsonb_build_object('id',p.id,'email',p.email,
   'phone',coalesce(p.phone,''),'firstName',coalesce(p.first_name,''),'lastName',coalesce(p.last_name,'')),
   'roles',jsonb_build_array(v_role),'kycStatus',coalesce(p.kyc_status,'not_started'));
end;
$me$;
revoke all on function public.matmove_customer_me() from public,anon;
grant execute on function public.matmove_customer_me() to authenticated,service_role;

-- Wrap existing secured staff functions so their current audit and membership checks remain intact.
alter function public.matmove_admin_set_staff_role(uuid) rename to matmove_admin_set_staff_role_lifecycle_base;
create or replace function public.matmove_admin_set_staff_role(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $staff$
declare v_original text; v_role text;
begin
 if auth.uid() is null or not exists(select 1 from public.matmove_staff_access
   where id=auth.uid() and is_owner and is_active and removed_at is null)
 then raise exception 'FORBIDDEN: Only the verified owner can change staff roles.'; end if;
 select role::text into v_role from public.profiles where id=p_user_id for update;
 if not found then return false; end if;
 if v_role='staff' then return true; end if;
 if v_role not in ('rider','driver','merchant') then
   raise exception 'CONFLICT: This account does not have a restorable Customer role.';
 end if;
 v_original:=public.matmove_staff_resolve_customer_role(p_user_id);
 if v_original is null then raise exception 'CONFLICT: Original Customer role could not be verified.'; end if;
 perform public.matmove_admin_set_staff_role_lifecycle_base(p_user_id);
 update public.profiles set customer_onboarding_role=coalesce(customer_onboarding_role,v_original)
 where id=p_user_id and role::text='staff';
 return true;
end;
$staff$;
revoke all on function public.matmove_admin_set_staff_role_lifecycle_base(uuid) from public,anon,authenticated;
grant execute on function public.matmove_admin_set_staff_role_lifecycle_base(uuid) to service_role;
revoke all on function public.matmove_admin_set_staff_role(uuid) from public,anon;
grant execute on function public.matmove_admin_set_staff_role(uuid) to authenticated,service_role;

alter function public.matmove_staff_save(uuid,uuid,text,text,jsonb,text,boolean,boolean)
 rename to matmove_staff_save_lifecycle_base;
create or replace function public.matmove_staff_save(
 p_actor uuid,p_id uuid,p_email text,p_name text,p_permissions jsonb,p_department text,p_active boolean,p_setup boolean
)
returns void language plpgsql security definer set search_path=pg_catalog,public as $staff$
declare v_role text; v_original text;
begin
 select role::text into v_role from public.profiles where id=p_id for update;
 if p_active and v_role in ('rider','driver','merchant') then
   v_original:=public.matmove_staff_resolve_customer_role(p_id);
   if v_original is null then raise exception 'CONFLICT: Original Customer role could not be verified.'; end if;
 elsif p_active and v_role is not null and v_role<>'staff' then
   raise exception 'CONFLICT: This account role cannot be assigned as ordinary staff.';
 end if;
 perform public.matmove_staff_save_lifecycle_base(p_actor,p_id,p_email,p_name,p_permissions,p_department,p_active,p_setup);
 if p_active and v_role in ('rider','driver','merchant') then
   update public.profiles set customer_onboarding_role=coalesce(customer_onboarding_role,v_original),
     role='staff',updated_at=clock_timestamp() where id=p_id;
 end if;
end;
$staff$;
revoke all on function public.matmove_staff_save_lifecycle_base(uuid,uuid,text,text,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.matmove_staff_save_lifecycle_base(uuid,uuid,text,text,jsonb,text,boolean,boolean) to service_role;
revoke all on function public.matmove_staff_save(uuid,uuid,text,text,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.matmove_staff_save(uuid,uuid,text,text,jsonb,text,boolean,boolean) to service_role;

alter function public.matmove_staff_remove(uuid,uuid,timestamptz,text)
 rename to matmove_staff_remove_lifecycle_base;
create or replace function public.matmove_staff_remove(p_actor uuid,p_id uuid,p_expected timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $staff$
declare result jsonb; v_original text;
begin
 result:=public.matmove_staff_remove_lifecycle_base(p_actor,p_id,p_expected,p_reason);
 if coalesce((result->>'removed')::boolean,false) then
   v_original:=public.matmove_staff_resolve_customer_role(p_id);
   if v_original in ('rider','driver','merchant') then
     update public.profiles set role=v_original,updated_at=clock_timestamp()
     where id=p_id and role::text in ('staff','rider','driver','merchant');
   end if;
   result:=result||jsonb_build_object('restoredCustomerRole',v_original);
 end if;
 return result;
end;
$staff$;
revoke all on function public.matmove_staff_remove_lifecycle_base(uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.matmove_staff_remove_lifecycle_base(uuid,uuid,timestamptz,text) to service_role;
revoke all on function public.matmove_staff_remove(uuid,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.matmove_staff_remove(uuid,uuid,timestamptz,text) to service_role;

alter function public.matmove_staff_restore(uuid,uuid,timestamptz,text,jsonb,text)
 rename to matmove_staff_restore_lifecycle_base;
create or replace function public.matmove_staff_restore(
 p_actor uuid,p_id uuid,p_expected timestamptz,p_name text,p_permissions jsonb,p_department text
)
returns void language plpgsql security definer set search_path=pg_catalog,public as $staff$
declare v_role text; v_original text;
begin
 select role::text into v_role from public.profiles where id=p_id for update;
 if v_role in ('rider','driver','merchant') then
   v_original:=public.matmove_staff_resolve_customer_role(p_id);
   if v_original is null then raise exception 'CONFLICT: Original Customer role could not be verified.'; end if;
 end if;
 perform public.matmove_staff_restore_lifecycle_base(p_actor,p_id,p_expected,p_name,p_permissions,p_department);
 if v_role in ('rider','driver','merchant') then
   update public.profiles set customer_onboarding_role=coalesce(customer_onboarding_role,v_original),
     role='staff',updated_at=clock_timestamp() where id=p_id;
 end if;
end;
$staff$;
revoke all on function public.matmove_staff_restore_lifecycle_base(uuid,uuid,timestamptz,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.matmove_staff_restore_lifecycle_base(uuid,uuid,timestamptz,text,jsonb,text) to service_role;
revoke all on function public.matmove_staff_restore(uuid,uuid,timestamptz,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.matmove_staff_restore(uuid,uuid,timestamptz,text,jsonb,text) to service_role;

-- Owner-only restore for legacy staff profiles without any staff-access record.
create or replace function public.matmove_admin_restore_customer_role(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $restore$
declare v_role text;
begin
 if auth.uid() is null or not exists(select 1 from public.matmove_staff_access
   where id=auth.uid() and is_owner and is_active and removed_at is null)
 then raise exception 'FORBIDDEN: Only the verified owner can restore a Customer role.'; end if;
 if exists(select 1 from public.matmove_staff_access where id=p_user_id)
   or exists(select 1 from public.admins where id=p_user_id)
 then raise exception 'CONFLICT: This account has a staff-access record. Use Staff Governance instead.'; end if;
 v_role:=public.matmove_staff_resolve_customer_role(p_user_id);
 if v_role not in ('rider','driver','merchant') then
   raise exception 'CONFLICT: Original Customer role cannot be verified. Manual support review is required.';
 end if;
 update public.profiles set role=v_role,updated_at=clock_timestamp()
 where id=p_user_id and role::text='staff';
 if not found then raise exception 'CONFLICT: This profile is no longer an orphaned staff account.'; end if;
 insert into public.matmove_staff_audit(actor_id,target_id,action,details)
 values(auth.uid(),p_user_id,'RESTORE_STAFF',jsonb_build_object('restoredCustomerRole',v_role,
   'reason','Owner restored an orphaned staff conversion'));
 return jsonb_build_object('success',true,'userId',p_user_id,'role',v_role);
end;
$restore$;
revoke all on function public.matmove_admin_restore_customer_role(uuid) from public,anon;
grant execute on function public.matmove_admin_restore_customer_role(uuid) to authenticated,service_role;

-- The preflight found exactly one legacy profile with a saved customer role,
-- matching customer membership, no staff-access record and no Admin membership.
do $repair$
declare v_count integer; v_updated integer;
begin
 select count(*) into v_count
 from public.profiles p
 where p.role::text='staff'
   and p.customer_onboarding_role in ('rider','driver','merchant')
   and not exists(select 1 from public.matmove_staff_access s where s.id=p.id)
   and not exists(select 1 from public.admins a where a.id=p.id)
   and not exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text not in ('rider','driver','merchant'))
   and exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text=p.customer_onboarding_role)
   and public.matmove_staff_resolve_customer_role(p.id)=p.customer_onboarding_role;
 if v_count<>1 then raise exception 'Expected exactly one verified orphaned Customer profile; found %.',v_count; end if;
 update public.profiles p set role=p.customer_onboarding_role,updated_at=clock_timestamp()
 where p.role::text='staff'
   and p.customer_onboarding_role in ('rider','driver','merchant')
   and not exists(select 1 from public.matmove_staff_access s where s.id=p.id)
   and not exists(select 1 from public.admins a where a.id=p.id)
   and not exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text not in ('rider','driver','merchant'))
   and exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text=p.customer_onboarding_role)
   and public.matmove_staff_resolve_customer_role(p.id)=p.customer_onboarding_role;
 get diagnostics v_updated=row_count;
 if v_updated<>1 then raise exception 'Role repair did not update exactly one profile.'; end if;
end;
$repair$;

notify pgrst,'reload schema';
commit;