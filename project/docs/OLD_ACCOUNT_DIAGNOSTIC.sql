-- Diagnostic for the owner's reported legacy sign-in. No changes are retained.
begin;
create temporary table matmove_old_account_check(user_id uuid,profile_role text,customer_roles jsonb,active_staff boolean,status_code text,detail text) on commit drop;
do $probe$
declare u record;result_code text;message text;
begin
 for u in select id from auth.users where lower(email)='sahrrichardm@gmail.com' loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u.id::text,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',u.id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
   perform public.matmove_customer_passcode('status',null,null);result_code:='OK';message:='Passcode status completed.';
  exception when others then result_code:=sqlstate;message:=sqlerrm;
  end;
  insert into matmove_old_account_check values(u.id,(select role::text from public.profiles where id=u.id),(select coalesce(jsonb_agg(role::text),'[]'::jsonb) from public.user_roles where profile_id=u.id),exists(select 1 from public.matmove_staff_access where id=u.id and is_active=true and removed_at is null),result_code,message);
 end loop;
end;
$probe$;
select * from matmove_old_account_check;
select accepting_referrals,payments_enabled,reward_minor,currency from public.matmove_referral_campaign where singleton;
rollback;
