
-- COORDINATED RELEASE: install with the new Customer passcode UI.
-- This migration removes legacy plaintext PINs. Old deployed clients must refresh
-- to the new release; do not apply to production while still serving the old UI.
-- Run the entire file in the ONE shared Supabase project as postgres.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $requirements$
begin
 if to_regprocedure('public.matmove_preferences_role(uuid)') is null then raise exception 'SETUP_REQUIRED: Install Portal Home setup first.';end if;
end;
$requirements$;
create table if not exists public.matmove_customer_passcodes(
 user_id uuid primary key references auth.users(id) on delete cascade,
 pin_hash text,
 digits smallint not null default 6 check(digits in (4,6)),
 failures integer not null default 0 check(failures between 0 and 5),
 blocked_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.matmove_customer_passcodes enable row level security;
revoke all on public.matmove_customer_passcodes from public,anon,authenticated,service_role;

-- Qualify the extension's actual schema rather than relying on search_path.
create or replace function public.matmove_pin_crypt(p_pin text,p_hash text default null)
returns text language plpgsql security definer set search_path=pg_catalog as $fn$
declare ns text;result text;
begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
 if ns is null then raise exception 'SETUP_REQUIRED: pgcrypto is required.';end if;
 if p_hash is null then execute format('select %I.crypt($1,%I.gen_salt(''bf'',10))',ns,ns) into result using p_pin;
 else execute format('select %I.crypt($1,$2)',ns) into result using p_pin,p_hash;end if;
 return result;
end;
$fn$;
revoke all on function public.matmove_pin_crypt(text,text) from public,anon,authenticated,service_role;

-- Capture old valid PINs once, then clear plaintext. Existing hashes always win.
do $legacy_format$
begin
 if exists(select 1 from public.profiles where role::text in ('rider','driver','merchant') and passcode is not null and passcode<>'' and passcode !~ '^([0-9]{4}|[0-9]{6})$') then
  raise exception 'SETUP_REQUIRED: A legacy customer passcode has an unsupported format. Review it before migration; nothing was changed.';
 end if;
end;
$legacy_format$;
insert into public.matmove_customer_passcodes(user_id,pin_hash,digits)
select p.id,public.matmove_pin_crypt(p.passcode),length(p.passcode)
from public.profiles p where p.role::text in ('rider','driver','merchant') and p.passcode ~ '^([0-9]{4}|[0-9]{6})$'
on conflict(user_id) do nothing;
update public.profiles set passcode=null where passcode is not null and role::text in ('rider','driver','merchant');

create or replace function public.matmove_deny_plaintext_passcode()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $fn$
begin
 if new.passcode is not null then raise exception 'FORBIDDEN: Use the secure passcode screen. Plaintext passcodes are disabled.';end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_deny_plaintext_passcode on public.profiles;
create trigger matmove_deny_plaintext_passcode before insert or update of passcode on public.profiles for each row execute function public.matmove_deny_plaintext_passcode();
revoke all on function public.matmove_deny_plaintext_passcode() from public,anon,authenticated,service_role;

create or replace function public.matmove_customer_passcode(p_action text,p_pin text default null,p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare uid uuid:=auth.uid();r public.matmove_customer_passcodes%rowtype;ok boolean:=false;result_code text:='status';wait_seconds integer:=0;
begin
 if uid is null then raise exception 'AUTH: Sign in to continue.';end if;
 perform public.matmove_preferences_role(uid);
 if exists(select 1 from public.matmove_staff_access where id=uid and is_active=true and removed_at is null) then raise exception 'ACCESS: Customer account required.';end if;
 if p_action is null or p_action not in ('status','create','verify','change') then raise exception 'INVALID: Unsupported passcode action.';end if;
 if p_action='status' and (p_pin is not null or p_new_pin is not null) then raise exception 'INVALID: Status does not accept a passcode.';end if;
 if p_action in ('create','change') and (p_new_pin is null or p_new_pin !~ '^[0-9]{6}$') then raise exception 'INVALID: Choose exactly six digits.';end if;
 if p_action='create' and p_pin is not null then raise exception 'INVALID: New setup does not accept an old passcode.';end if;
 if p_action='verify' and p_new_pin is not null then raise exception 'INVALID: Verification does not change the passcode.';end if;
 perform pg_advisory_xact_lock(hashtextextended('matmove-passcode:'||uid::text,0));
 insert into public.matmove_customer_passcodes(user_id) values(uid) on conflict(user_id) do nothing;
 select * into r from public.matmove_customer_passcodes where user_id=uid for update;
 if r.blocked_until>clock_timestamp() then
  result_code:='cooldown';wait_seconds:=greatest(1,ceil(extract(epoch from(r.blocked_until-clock_timestamp())))::integer);
 elsif p_action='create' then
  if r.pin_hash is not null then result_code:='already_configured';
  else update public.matmove_customer_passcodes set pin_hash=public.matmove_pin_crypt(p_new_pin),digits=6,failures=0,blocked_until=null,updated_at=clock_timestamp() where user_id=uid returning * into r;ok:=true;result_code:='saved';end if;
 elsif p_action in ('verify','change') then
  if r.pin_hash is null then result_code:='setup_required';
  elsif p_pin is null or length(p_pin)>6 or p_pin !~ '^[0-9]{4,6}$' then
   raise exception 'INVALID: Enter your current passcode.';
  elsif length(p_pin)=r.digits and public.matmove_pin_crypt(p_pin,r.pin_hash)=r.pin_hash then
   update public.matmove_customer_passcodes set failures=0,blocked_until=null where user_id=uid returning * into r;
   if p_action='change' then
    update public.matmove_customer_passcodes set pin_hash=public.matmove_pin_crypt(p_new_pin),digits=6,updated_at=clock_timestamp() where user_id=uid returning * into r;
   end if;
   ok:=true;result_code:=case when r.digits=4 then 'upgrade_required' when p_action='change' then 'saved' else 'verified' end;
  else
   -- Return, never raise after this write: a raised exception would roll back
   -- the failed-attempt counter and let repeated guesses bypass the cooldown.
   update public.matmove_customer_passcodes set failures=case when blocked_until is not null then 1 else least(failures+1,5) end,
    blocked_until=case when blocked_until is null and failures>=4 then clock_timestamp()+interval '5 minutes' else null end where user_id=uid returning * into r;
   result_code:=case when r.blocked_until is not null then 'cooldown' else 'incorrect' end;
   if r.blocked_until is not null then wait_seconds:=300;end if;
  end if;
 end if;
 return jsonb_build_object('userId',uid,'configured',r.pin_hash is not null,'digits',r.digits,'ok',ok,'code',result_code,'attemptsRemaining',5-r.failures,'retryAfterSeconds',wait_seconds);
end;
$fn$;
revoke all on function public.matmove_customer_passcode(text,text,text) from public,anon,service_role;
grant execute on function public.matmove_customer_passcode(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
