-- Admin money stage 2. Adds claims and receipt checks; sends no payments.
begin;
do $$ begin
 if to_regclass('public.matmove_admin_payroll') is null or to_regclass('public.matmove_admin_refunds') is null
 or to_regclass('public.matmove_staff_access') is null then raise exception 'Install and verify Admin money ledgers and staff access first.';end if;
end $$;
alter table public.matmove_admin_payroll enable row level security;
alter table public.matmove_admin_refunds enable row level security;
revoke all on public.matmove_admin_payroll,public.matmove_admin_refunds from public,anon,authenticated;
alter table public.matmove_admin_payroll add column if not exists attempted_at timestamptz;
alter table public.matmove_admin_payroll add column if not exists verified_receipt jsonb;
alter table public.matmove_admin_refunds add column if not exists attempted_at timestamptz;
alter table public.matmove_admin_refunds add column if not exists verified_receipt jsonb;
-- Only rows created through stage-2 prepare are claimable. Preserve this on reruns.
alter table public.matmove_admin_payroll add column if not exists claimable boolean not null default false;
alter table public.matmove_admin_refunds add column if not exists claimable boolean not null default false;
-- Old requests might already have reached the provider. Never authorize another POST.
update public.matmove_admin_payroll set attempted_at=created_at where attempted_at is null and not claimable;
update public.matmove_admin_refunds set attempted_at=created_at where attempted_at is null and not claimable;
create table if not exists public.matmove_admin_money_receipts(
 provider_id text primary key,kind text not null check(kind in ('payroll','refund')),request_key uuid not null,
 unique(kind,request_key)
);
alter table public.matmove_admin_money_receipts enable row level security;
revoke all on public.matmove_admin_money_receipts from public,anon,authenticated;
grant select,insert on public.matmove_admin_money_receipts to service_role;
create or replace function public.matmove_admin_money_actor(p_actor uuid,p_kind text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select p_kind in ('payroll','refund') and exists(select 1 from public.matmove_staff_access a
 where a.id=p_actor and a.is_active and a.removed_at is null and
 (a.is_owner or a.permissions ? 'special' or (p_kind='refund' and a.permissions ? 'financials')));
$$;
create or replace function public.matmove_admin_money_recipient(p_kind text,p_user uuid,p_account text)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare profile jsonb;wallet jsonb;count_wallets integer;wallet_id uuid;
begin
 select to_jsonb(p) into profile from public.profiles p where id=p_user for share;
 if not found or (p_kind='payroll' and coalesce(profile->>'role','')<>'staff')
 or (p_kind='refund' and coalesce(profile->>'role','') not in ('rider','driver','merchant'))
 or coalesce(profile->>'is_wallet_frozen','false')<>'false'
 or profile->>'is_active'='false' or profile->>'status' in ('inactive','deactivated','removed') then
 raise exception 'FORBIDDEN: Recipient is not eligible or the account is frozen.';end if;
 if exists(select 1 from public.matmove_staff_access where id=p_user and (not is_active or removed_at is not null)) then
 raise exception 'FORBIDDEN: Removed or inactive staff cannot receive this payment.';end if;
 select count(*) into count_wallets from public.wallets where user_id=p_user and currency='SLE';
 if count_wallets<>1 then raise exception 'INVALID: Recipient needs exactly one SLE wallet.';end if;
 select to_jsonb(w) into wallet from public.wallets w where user_id=p_user and currency='SLE' for share;
 if coalesce(wallet->>'is_frozen','false')<>'false' or coalesce(wallet->>'monime_account_id',wallet->'metadata'->>'monime_account_id') is distinct from p_account
 or (wallet->>'monime_account_id' is not null and wallet->'metadata'->>'monime_account_id' is not null and wallet->>'monime_account_id'<>wallet->'metadata'->>'monime_account_id') then
 raise exception 'INVALID: Recipient wallet is frozen or its account link changed.';end if;
 if (select count(*) from public.wallets w where coalesce(to_jsonb(w)->>'monime_account_id',to_jsonb(w)->'metadata'->>'monime_account_id')=p_account)<>1 then
 raise exception 'INVALID: Recipient account is shared or ambiguous.';end if;
 wallet_id:=(wallet->>'id')::uuid;return wallet_id;
end $$;
create or replace function public.matmove_admin_money_prepare(p_kind text,p_actor uuid,p_key uuid,p_user uuid,p_account text,p_source text,p_amount bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tab text;row jsonb;wallet_id uuid;
begin
 if public.matmove_admin_money_actor(p_actor,p_kind) is distinct from true then raise exception 'FORBIDDEN: Current financial assignment required.';end if;
 if p_key is null or p_user is null or p_amount is null or p_amount not between 1 and 1000000000000
 or p_source is null or p_account is null or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_account !~ '^fac-[A-Za-z0-9_-]+$'
 or p_source=p_account or p_reason is null or p_reason<>btrim(p_reason) or length(p_reason) not between 3 and (case when p_kind='payroll' then 140 else 300 end) then
 raise exception 'INVALID: Review the exact recipient, amount, reason and accounts.';end if;
 tab:=case when p_kind='payroll' then 'matmove_admin_payroll' else 'matmove_admin_refunds' end;
 perform pg_advisory_xact_lock(hashtextextended('matmove-admin-'||p_kind||p_key::text,0));
 execute format('select to_jsonb(t) from public.%I t where request_key=$1 for update',tab) into row using p_key;
 if row is not null then
  if row->>'initiated_by'<>p_actor::text or coalesce(row->>'staff_user_id',row->>'recipient_user_id')<>p_user::text
  or row->>'recipient_account_id'<>p_account or row->>'source_account_id'<>p_source or (row->>'amount_minor')::bigint<>p_amount or row->>'reason'<>p_reason then
   raise exception 'CONFLICT: Original payment details changed. Keep the original request.';end if;
  return row;
 end if;
 if exists(select 1 from public.wallets w where to_jsonb(w)->>'monime_account_id'=p_source or to_jsonb(w)->'metadata'->>'monime_account_id'=p_source) then
 raise exception 'INVALID: Payment source must be a dedicated business account.';end if;
 wallet_id:=public.matmove_admin_money_recipient(p_kind,p_user,p_account);
 if p_kind='payroll' then
  insert into public.matmove_admin_payroll(request_key,initiated_by,staff_user_id,wallet_id,source_account_id,recipient_account_id,amount_minor,reason,claimable)
  values(p_key,p_actor,p_user,wallet_id,p_source,p_account,p_amount,p_reason,true) returning to_jsonb(matmove_admin_payroll.*) into row;
 else
  insert into public.matmove_admin_refunds(request_key,initiated_by,recipient_user_id,source_account_id,recipient_account_id,amount_minor,reason,claimable)
  values(p_key,p_actor,p_user,p_source,p_account,p_amount,p_reason,true) returning to_jsonb(matmove_admin_refunds.*) into row;
 end if;
 return row;
end $$;
create or replace function public.matmove_admin_money_claim(p_kind text,p_actor uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tab text;row jsonb;recipient uuid;
begin
 if public.matmove_admin_money_actor(p_actor,p_kind) is distinct from true then raise exception 'FORBIDDEN: Current financial assignment required.';end if;
 tab:=case when p_kind='payroll' then 'matmove_admin_payroll' else 'matmove_admin_refunds' end;
 perform pg_advisory_xact_lock(hashtextextended('matmove-admin-'||p_kind||p_key::text,0));
 execute format('select to_jsonb(t) from public.%I t where request_key=$1 for update',tab) into row using p_key;
 if row is null or row->>'initiated_by'<>p_actor::text then raise exception 'FORBIDDEN: Original payment request required.';end if;
 if row->'claimable'='true'::jsonb and row->>'attempted_at' is null and row->>'state'='initiating' and row->>'provider_transfer_id' is null then
  recipient:=coalesce(row->>'staff_user_id',row->>'recipient_user_id')::uuid;
  perform public.matmove_admin_money_recipient(p_kind,recipient,row->>'recipient_account_id');
  if exists(select 1 from public.wallets w where to_jsonb(w)->>'monime_account_id'=row->>'source_account_id' or to_jsonb(w)->'metadata'->>'monime_account_id'=row->>'source_account_id') then raise exception 'INVALID: Source is linked to a customer wallet.';end if;
  execute format('update public.%I t set attempted_at=clock_timestamp(),state=''pending'',provider_status=''pending'',updated_at=clock_timestamp() where request_key=$1 returning to_jsonb(t)',tab) into row using p_key;
  return row||jsonb_build_object('can_create',true);
 end if;
 return row||jsonb_build_object('can_create',false);
end $$;
create or replace function public.matmove_admin_money_record(p_kind text,p_actor uuid,p_key uuid,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tab text;row jsonb;provider text;status text;mapping public.matmove_admin_money_receipts%rowtype;recipient text;key_name text;user_name text;
begin
 if public.matmove_admin_money_actor(p_actor,p_kind) is distinct from true then raise exception 'FORBIDDEN: Current financial assignment required.';end if;
 tab:=case when p_kind='payroll' then 'matmove_admin_payroll' else 'matmove_admin_refunds' end;
 perform pg_advisory_xact_lock(hashtextextended('matmove-admin-'||p_kind||p_key::text,0));
 execute format('select to_jsonb(t) from public.%I t where request_key=$1 for update',tab) into row using p_key;
 if row is null or row->>'initiated_by'<>p_actor::text or row->>'attempted_at' is null then raise exception 'FORBIDDEN: An original attempted request is required.';end if;
 provider:=p_receipt->>'id';status:=p_receipt->>'status';recipient:=coalesce(row->>'staff_user_id',row->>'recipient_user_id');
 key_name:=case when p_kind='payroll' then 'matmovePayrollRequestKey' else 'matmoveRefundRequestKey' end;
 user_name:=case when p_kind='payroll' then 'staffUserId' else 'recipientUserId' end;
 if provider is null or provider !~ '^trn-[A-Za-z0-9_-]{1,116}$' or status is null or status not in ('pending','processing','completed','failed')
 or p_receipt->'amount'->>'currency' is distinct from 'SLE' or jsonb_typeof(p_receipt->'amount'->'value') is distinct from 'number'
 or coalesce(p_receipt->'amount'->>'value','') !~ '^[0-9]{1,13}$'
 or p_receipt->'sourceFinancialAccount'->>'id' is distinct from row->>'source_account_id'
 or p_receipt->'destinationFinancialAccount'->>'id' is distinct from row->>'recipient_account_id'
 or p_receipt->'metadata'->>key_name is distinct from p_key::text or p_receipt->'metadata'->>user_name is distinct from recipient
 or p_receipt->'metadata'->>'initiatedBy' is distinct from p_actor::text then raise exception 'INVALID: Provider receipt does not match the original request.';end if;
 if (p_receipt->'amount'->>'value')::bigint<>(row->>'amount_minor')::bigint then raise exception 'INVALID: Provider amount differs from the original request.';end if;
 if row->>'provider_transfer_id' is not null and row->>'provider_transfer_id'<>provider then raise exception 'CONFLICT: Original provider transfer cannot change.';end if;
 insert into public.matmove_admin_money_receipts(provider_id,kind,request_key) values(provider,p_kind,p_key) on conflict do nothing;
 select * into mapping from public.matmove_admin_money_receipts where provider_id=provider;
 if not found or mapping.kind<>p_kind or mapping.request_key<>p_key then raise exception 'CONFLICT: Provider receipt belongs to another payment.';end if;
 if row->>'state' in ('completed','failed') and row->>'state'<>status then return row;end if;
 if row->>'state'='processing' and status='pending' then return row;end if;
 execute format('update public.%I t set state=$2,provider_status=$2,provider_transfer_id=$3,verified_receipt=$4,completed_at=case when $2=''completed'' then coalesce(completed_at,clock_timestamp()) else completed_at end,failure_detail=null,updated_at=clock_timestamp() where request_key=$1 returning to_jsonb(t)',tab)
 into row using p_key,status,provider,p_receipt;
 return row;
end $$;
create or replace function public.matmove_admin_money_review(p_kind text,p_actor uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare tab text;row jsonb;
begin
 if public.matmove_admin_money_actor(p_actor,p_kind) is distinct from true then raise exception 'FORBIDDEN: Current financial assignment required.';end if;
 tab:=case when p_kind='payroll' then 'matmove_admin_payroll' else 'matmove_admin_refunds' end;
 perform pg_advisory_xact_lock(hashtextextended('matmove-admin-'||p_kind||p_key::text,0));
 execute format('update public.%I t set state=case when state in (''completed'',''failed'') then state else ''review_required'' end,updated_at=clock_timestamp() where request_key=$1 and initiated_by=$2 returning to_jsonb(t)',tab) into row using p_key,p_actor;
 return row;
end $$;
do $permissions$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('matmove_admin_money_actor','matmove_admin_money_recipient','matmove_admin_money_prepare','matmove_admin_money_claim','matmove_admin_money_record','matmove_admin_money_review') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $permissions$;
notify pgrst,'reload schema';
commit;
