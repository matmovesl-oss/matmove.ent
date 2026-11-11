-- Separate password/passcode recovery and permit 6–10 digit customer passcodes.
begin;
alter table public.matmove_customer_passcodes drop constraint if exists matmove_customer_passcodes_digits_check;
alter table public.matmove_customer_passcodes add constraint matmove_customer_passcodes_digits_check check (digits=4 or digits between 6 and 10);
create or replace function public.matmove_customer_passcode(p_action text,p_pin text default null,p_new_pin text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare uid uuid:=auth.uid();r public.matmove_customer_passcodes%rowtype;ok boolean:=false;result_code text:='status';wait_seconds integer:=0;recovery_claims jsonb;recovery_timestamp numeric;
begin
 if uid is null then raise exception 'AUTH: Sign in to continue.';end if;
 perform public.matmove_preferences_role(uid);
 if exists(select 1 from public.matmove_staff_access where id=uid and is_active=true and removed_at is null) then raise exception 'ACCESS: Customer account required.';end if;
 if p_action is null or p_action not in ('status','create','verify','change','recover') then raise exception 'INVALID: Unsupported passcode action.';end if;
 if p_action='status' and (p_pin is not null or p_new_pin is not null) then raise exception 'INVALID: Status does not accept a passcode.';end if;
 if p_action in ('create','change','recover') and (p_new_pin is null or p_new_pin !~ '^[0-9]{6,10}$') then raise exception 'INVALID: Choose between 6 and 10 digits.';end if;
 if p_action in ('create','recover') and p_pin is not null then raise exception 'INVALID: This action does not accept an old passcode.';end if;
 if p_action='verify' and p_new_pin is not null then raise exception 'INVALID: Verification does not change the passcode.';end if;
 perform pg_advisory_xact_lock(hashtextextended('matmove-passcode:'||uid::text,0));
 insert into public.matmove_customer_passcodes(user_id) values(uid) on conflict(user_id) do nothing;
 select * into r from public.matmove_customer_passcodes where user_id=uid for update;
 if r.blocked_until>clock_timestamp() and p_action<>'recover' then
  result_code:='cooldown';wait_seconds:=greatest(1,ceil(extract(epoch from(r.blocked_until-clock_timestamp())))::integer);
 elsif p_action='create' then
  if r.pin_hash is not null then result_code:='already_configured';
  else update public.matmove_customer_passcodes set pin_hash=public.matmove_pin_crypt(p_new_pin),digits=char_length(p_new_pin),failures=0,blocked_until=null,updated_at=clock_timestamp() where user_id=uid returning * into r;ok:=true;result_code:='saved';end if;
 elsif p_action='recover' then
  recovery_claims:=auth.jwt()->'amr';
  recovery_timestamp:=case when coalesce(recovery_claims->0->>'timestamp','') ~ '^[0-9]+$' then (recovery_claims->0->>'timestamp')::numeric else null end;
  if coalesce(recovery_claims->0->>'method','')<>'recovery' or recovery_timestamp is null or
     recovery_timestamp < extract(epoch from clock_timestamp())-900 or
     recovery_timestamp > extract(epoch from clock_timestamp())+60 then
   raise exception 'AUTH: A recent verified email recovery is required to reset the passcode.';
  end if;
  update public.matmove_customer_passcodes set pin_hash=public.matmove_pin_crypt(p_new_pin),digits=char_length(p_new_pin),failures=0,blocked_until=null,updated_at=clock_timestamp() where user_id=uid returning * into r;
  ok:=true;result_code:='saved';
 elsif p_action in ('verify','change') then
  if p_action='change' and (p_new_pin is null or p_new_pin !~ '^[0-9]{6,10}$') then raise exception 'INVALID: Choose between 6 and 10 digits.';end if;
  if r.pin_hash is null then result_code:='setup_required';
  elsif p_pin is null or p_pin !~ '^[0-9]{4,10}$' or char_length(p_pin)<>r.digits then
   raise exception 'INVALID: Enter your current passcode.';
  elsif public.matmove_pin_crypt(p_pin,r.pin_hash)=r.pin_hash then
   update public.matmove_customer_passcodes set failures=0,blocked_until=null where user_id=uid returning * into r;
   if p_action='change' then
    update public.matmove_customer_passcodes set pin_hash=public.matmove_pin_crypt(p_new_pin),digits=char_length(p_new_pin),updated_at=clock_timestamp() where user_id=uid returning * into r;
    ok:=true;result_code:='saved';
   else
    ok:=true;result_code:=case when r.digits=4 then 'upgrade_required' else 'verified' end;
   end if;
  else
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
