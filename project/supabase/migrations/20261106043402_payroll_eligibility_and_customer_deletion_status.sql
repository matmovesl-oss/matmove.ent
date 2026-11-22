
create or replace function public.matmove_admin_money_recipient(p_kind text,p_user uuid,p_account text)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  profile jsonb;
  wallet jsonb;
  count_wallets integer;
  wallet_id uuid;
begin
  select to_jsonb(p) into profile
  from public.profiles p
  where id=p_user
  for share;

  if not found
     or (p_kind='payroll' and (
       coalesce(profile->>'is_payroll_staff','false')<>'true'
       or coalesce(profile->>'role','') not in ('rider','driver','merchant')
     ))
     or (p_kind='refund' and coalesce(profile->>'role','') not in ('rider','driver','merchant'))
     or coalesce(profile->>'is_wallet_frozen','false')<>'false'
     or profile->>'is_active'='false'
     or profile->>'status' in ('inactive','deactivated','removed') then
    raise exception 'FORBIDDEN: Recipient is not eligible or the account is frozen.';
  end if;

  if exists(
    select 1 from public.matmove_staff_access
    where id=p_user and (not is_active or removed_at is not null)
  ) then
    raise exception 'FORBIDDEN: Removed or inactive staff cannot receive this payment.';
  end if;

  select count(*) into count_wallets
  from public.wallets
  where user_id=p_user and currency='SLE';

  if count_wallets<>1 then
    raise exception 'INVALID: Recipient needs exactly one SLE wallet.';
  end if;

  select to_jsonb(w) into wallet
  from public.wallets w
  where user_id=p_user and currency='SLE'
  for share;

  if coalesce(wallet->>'is_frozen','false')<>'false'
     or coalesce(wallet->>'monime_account_id',wallet->'metadata'->>'monime_account_id') is distinct from p_account
     or (wallet->>'monime_account_id' is not null and wallet->'metadata'->>'monime_account_id' is not null
         and wallet->>'monime_account_id'<>wallet->'metadata'->>'monime_account_id') then
    raise exception 'INVALID: Recipient wallet is frozen or its account link changed.';
  end if;

  if (select count(*) from public.wallets w
      where coalesce(to_jsonb(w)->>'monime_account_id',to_jsonb(w)->'metadata'->>'monime_account_id')=p_account)<>1 then
    raise exception 'INVALID: Recipient account is shared or ambiguous.';
  end if;

  wallet_id:=(wallet->>'id')::uuid;
  return wallet_id;
end;
$function$;

revoke all on function public.matmove_admin_money_recipient(text,uuid,text) from public,anon;
grant execute on function public.matmove_admin_money_recipient(text,uuid,text) to authenticated;

create or replace function public.matmove_customer_account_deletion_status()
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  uid uuid:=auth.uid();
  r public.matmove_account_deletion_requests%rowtype;
begin
  if uid is null then raise exception 'FORBIDDEN: Sign in first.'; end if;
  select * into r
  from public.matmove_account_deletion_requests
  where user_id=uid
  order by requested_at desc
  limit 1;

  if not found then return jsonb_build_object('status',null,'requestedAt',null,'reviewNote',null); end if;
  return jsonb_build_object('status',r.status,'requestedAt',r.requested_at,'reviewNote',r.review_note);
end;
$function$;
revoke all on function public.matmove_customer_account_deletion_status() from public,anon;
grant execute on function public.matmove_customer_account_deletion_status() to authenticated;

notify pgrst,'reload schema';
