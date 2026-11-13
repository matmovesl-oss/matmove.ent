-- Strictly validate new customer input while safely skipping blank and malformed
-- legacy phone values in duplicate detection. Never rewrite legacy profile data.
create or replace function public.matmove_customer_phone_match(p_phone text)
returns text
language plpgsql
immutable
set search_path=pg_catalog,public
as $phone_match$
declare
  v text:=regexp_replace(trim(coalesce(p_phone,'')),'[[:space:]().-]','','g');
begin
  if v='' then return null; end if;
  if v ~ '^0[0-9]{8}$' then
    v:='+232'||substr(v,2);
  elsif v ~ '^[0-9]{8}$' then
    v:='+232'||v;
  elsif v ~ '^232[0-9]{8}$' then
    v:='+'||v;
  end if;
  if v ~ '^\+[1-9][0-9]{7,14}$'
     and (v not like '+232%' or v ~ '^\+232[0-9]{8}$') then
    return v;
  end if;
  return null;
end;
$phone_match$;

revoke all on function public.matmove_customer_phone_match(text) from public,anon,authenticated;

create or replace function public.matmove_save_customer_account(p_role text,p_phone text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $account$
declare
  u auth.users%rowtype;
  p public.profiles%rowtype;
  v_role text:=lower(trim(coalesce(p_role,'')));
  v_phone text;
  v_existing text;
  v_count integer;
  v_active_admin boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in before completing your account.';
  end if;
  if to_regclass('public.matmove_staff_access') is not null then
    execute 'select exists(select 1 from public.matmove_staff_access s where s.id=$1 and s.is_active=true and s.removed_at is null)'
      into v_active_admin using auth.uid();
    if v_active_admin then
      raise exception 'FORBIDDEN: An active Admin account cannot create a Customer account.';
    end if;
  end if;
  if v_role not in ('rider','driver','merchant') then
    raise exception 'INVALID: Choose rider, driver or merchant.';
  end if;
  select * into u from auth.users where id=auth.uid() for update;
  if not found or nullif(u.email,'') is null then
    raise exception 'FORBIDDEN: An authenticated email account is required.';
  end if;

  -- New user input still passes the strict canonical phone validator.
  v_phone:=public.matmove_customer_phone(p_phone);
  if v_phone is null then
    raise exception 'INVALID: Enter a valid phone number, for example +232 76 000 000.';
  end if;
  select * into p from public.profiles where id=u.id for update;

  if p.kyc_status='approved' then
    if p.role is distinct from v_role then
      raise exception 'LOCKED: Your verified account type cannot be changed here.';
    end if;
    if nullif(trim(coalesce(p.phone,'')),'') is null
       and nullif(trim(coalesce(p.phone_number,'')),'') is null then
      if exists(
        select 1 from public.profiles other
        where other.id<>u.id
          and public.matmove_customer_phone_match(coalesce(nullif(other.phone,''),other.phone_number))=v_phone
      ) then
        raise exception 'CONFLICT: This phone number is already registered. Sign in to that account or use another number.';
      end if;
      update public.profiles
      set phone=v_phone,phone_number=v_phone,updated_at=now()
      where id=u.id and role=v_role and kyc_status='approved'
        and nullif(trim(coalesce(phone,'')),'') is null
        and nullif(trim(coalesce(phone_number,'')),'') is null;
      return public.matmove_customer_me();
    end if;
    if public.matmove_customer_phone(coalesce(nullif(p.phone,''),p.phone_number)) is distinct from v_phone then
      raise exception 'LOCKED: Your verified phone number is already set. Contact MatMove support for changes.';
    end if;
    return public.matmove_customer_me();
  end if;

  if p.role is not null and p.role not in ('rider','driver','merchant') then
    raise exception 'FORBIDDEN: Administrative accounts cannot be converted here.';
  end if;
  if exists(
    select 1 from public.user_roles
    where profile_id=u.id and role::text not in ('rider','driver','merchant')
  ) then
    raise exception 'FORBIDDEN: Administrative roles cannot be changed here.';
  end if;

  select count(*),min(role::text) into v_count,v_existing
  from public.user_roles where profile_id=u.id;
  if v_count>1 then
    if p.role in ('rider','driver','merchant')
       and exists(select 1 from public.user_roles where profile_id=u.id and role::text=p.role) then
      v_existing:=p.role;
    else
      raise exception 'CONFLICT: Customer roles need support review.';
    end if;
  end if;
  v_existing:=coalesce(p.customer_onboarding_role,v_existing,case when p.kyc_status='approved' then p.role else null end);
  if p.kyc_status='approved' and p.role is not null and p.role<>v_role then
    raise exception 'CONFLICT: Approved account roles need support review.';
  end if;
  if v_existing is not null and v_existing<>v_role then
    raise exception 'FORBIDDEN: Your account type is already assigned. Contact support to change it.';
  end if;

  -- Unusable legacy values return NULL from the safe matcher and do not abort
  -- this customer's signup. Valid existing numbers remain protected.
  if exists(
    select 1 from public.profiles other
    where other.id<>u.id
      and public.matmove_customer_phone_match(coalesce(nullif(other.phone,''),other.phone_number))=v_phone
  ) then
    raise exception 'CONFLICT: This phone number is already registered. Sign in to that account or use another number.';
  end if;

  insert into public.profiles(
    id,email,phone,phone_number,role,kyc_status,
    customer_onboarding_role,customer_account_started_at,updated_at
  )
  values(u.id,u.email,v_phone,v_phone,v_role,'not_started',v_role,now(),now())
  on conflict(id) do update set
    email=excluded.email,
    phone=v_phone,
    phone_number=v_phone,
    role=v_role,
    customer_onboarding_role=v_role,
    customer_account_started_at=coalesce(profiles.customer_account_started_at,now()),
    kyc_status=case
      when coalesce(profiles.kyc_status,'pending')='pending'
       and not exists(select 1 from public.kyc_submissions where profile_id=u.id)
      then 'not_started'
      else profiles.kyc_status
    end,
    updated_at=now();

  insert into public.user_roles(profile_id,role)
  values(u.id,v_role::public.user_role)
  on conflict(profile_id,role) do nothing;
  perform public.ensure_matmove_wallets(u.id);
  return public.matmove_customer_me();
end;
$account$;
