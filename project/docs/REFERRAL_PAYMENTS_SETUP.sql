
-- CUSTOMER: run the COMPLETE file in shared Supabase after REFERRALS_SETUP.sql.
-- Server-only reward processing. This does NOT activate or fund the campaign.
begin;
do $preflight$ begin
 if to_regprocedure('public.matmove_referral_register(text)') is null
 or to_regprocedure('public.matmove_customer_phone(text)') is null or to_regclass('public.kyc_submissions') is null then
  raise exception 'Run current referral and customer onboarding setup first.';
 end if;
end $preflight$;
alter table public.matmove_referral_campaign add column if not exists treasury_account text;
alter table public.matmove_referral_campaign add column if not exists budget_minor bigint not null default 0 check(budget_minor>=0);
alter table public.matmove_referral_rewards add column if not exists wallet_id uuid references public.wallets(id);
alter table public.matmove_referral_rewards add column if not exists source_account text;
alter table public.matmove_referral_rewards add column if not exists destination_account text;
alter table public.matmove_referral_rewards add column if not exists reserved_at timestamptz;
alter table public.matmove_referral_rewards add column if not exists claimed_at timestamptz;
alter table public.matmove_referral_rewards add column if not exists error text;
create index if not exists matmove_referral_treasury_reserves on public.matmove_referral_rewards(source_account,state,updated_at) where reserved_at is not null;
create table if not exists public.matmove_referral_identity_claims (
 kind text not null check(kind in ('phone','identity')),fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 new_user_id uuid not null references public.matmove_referrals(new_user_id),created_at timestamptz not null default now(),
 primary key(kind,fingerprint),unique(new_user_id,kind)
);
alter table public.matmove_referral_identity_claims enable row level security;
revoke all on public.matmove_referral_identity_claims from public,anon,authenticated;

create or replace function public.matmove_referral_wallet(p_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare p public.profiles%rowtype;w public.wallets%rowtype;account_id text;phone text;name text;dob text;
begin
 if not public.matmove_referral_customer(p_user) then raise exception 'FORBIDDEN: Customer referral eligibility could not be verified.';end if;
 select * into p from public.profiles where id=p_user for update;
 if p.kyc_status::text is distinct from 'approved' or coalesce((to_jsonb(p)->>'is_wallet_frozen')::boolean,false)
 or exists(select 1 from public.wallets where user_id=p_user and coalesce(is_frozen,false)) then
  raise exception 'FORBIDDEN: Both customers need approved verification and unfrozen wallets.';
 end if;
 if not exists(select 1 from public.kyc_submissions s where s.profile_id=p_user and s.target_role::text=p.role::text and s.status::text='approved'
 and (p.role::text='rider' or s.reviewer_id is not null)) then raise exception 'FORBIDDEN: A confirmed KYC approval is required for both customers.';end if;
 if (select count(*) from public.wallets where user_id=p_user and currency='SLE')<>1 then raise exception 'FORBIDDEN: One owned SLE wallet is required.';end if;
 select * into w from public.wallets where user_id=p_user and currency='SLE' for update;
 account_id:=coalesce(w.monime_account_id,w.metadata->>'monime_account_id');
 if account_id is null or account_id !~ '^fac-[A-Za-z0-9_-]+$'
 or (w.monime_account_id is not null and w.metadata->>'monime_account_id' is not null and w.monime_account_id<>w.metadata->>'monime_account_id')
 or (select count(*) from public.wallets where monime_account_id=account_id or metadata->>'monime_account_id'=account_id)<>1 then
  raise exception 'FORBIDDEN: Wallet account links must be unique and verified.';
 end if;
 phone:=public.matmove_customer_phone(coalesce(nullif(to_jsonb(p)->>'phone',''),to_jsonb(p)->>'phone_number'));
 name:=lower(regexp_replace(coalesce(nullif(btrim(to_jsonb(p)->>'full_name'),''),btrim(coalesce(to_jsonb(p)->>'first_name','')||' '||coalesce(to_jsonb(p)->>'last_name',''))),'[[:space:]]+',' ','g'));
 dob:=to_jsonb(p)->>'date_of_birth';
 if length(name)<3 or nullif(dob,'') is null then raise exception 'FORBIDDEN: Verified identity details are incomplete.';end if;
 return jsonb_build_object('user_id',p_user,'wallet_id',w.id,'account_id',account_id,
 'phone_fingerprint',encode(sha256(convert_to(phone,'UTF8')),'hex'),
 'identity_fingerprint',encode(sha256(convert_to(name||'|'||dob,'UTF8')),'hex'));
end $referral$;
create or replace function public.matmove_referral_participants(p_new_user uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare r public.matmove_referrals%rowtype;a jsonb;b jsonb;begin
 -- Same ordering as claims, reservations and receipt recording.
 perform pg_advisory_xact_lock(87192814);
 select * into r from public.matmove_referrals where new_user_id=p_new_user;
 if not found then raise exception 'NOT_FOUND: Referral not found.';end if;
 a:=public.matmove_referral_wallet(r.referrer_id);b:=public.matmove_referral_wallet(r.new_user_id);
 if a->>'account_id'=b->>'account_id' or a->>'phone_fingerprint'=b->>'phone_fingerprint' or a->>'identity_fingerprint'=b->>'identity_fingerprint' then
  raise exception 'FORBIDDEN: Referral identity needs review. Self-referrals are not eligible.';
 end if;
 return jsonb_build_object('new_user_id',r.new_user_id,'inviter',a,'new_user',b);
end $referral$;
create or replace function public.matmove_referral_prepare(p_new_user uuid,p_source text,p_balance bigint,p_observed timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare c public.matmove_referral_campaign%rowtype;p jsonb;reserved bigint;budget_used bigint;already integer;new_identity jsonb;v_kind text;fp text;
begin
 perform pg_advisory_xact_lock(87192814);
 select * into c from public.matmove_referral_campaign where singleton for update;
 if not c.payments_enabled then raise exception 'PAUSED: Referral payments are paused.';end if;
 if p_source is null or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_source is distinct from c.treasury_account
 or exists(select 1 from public.wallets where monime_account_id=p_source or metadata->>'monime_account_id'=p_source) then raise exception 'INVALID: A dedicated referral treasury is required.';end if;
 p:=public.matmove_referral_participants(p_new_user);new_identity:=p->'new_user';
 if (select count(*) from public.matmove_referral_rewards where new_user_id=p_new_user)<>2
 or exists(select 1 from public.matmove_referral_rewards r where r.new_user_id=p_new_user and (r.amount_minor<>100 or r.currency<>'SLE'
 or r.beneficiary_id::text is distinct from (case when r.kind='inviter' then p->'inviter' else p->'new_user' end)->>'user_id')) then raise exception 'INVALID: Referral reward records need review.';end if;
 select count(*) into already from public.matmove_referral_rewards where new_user_id=p_new_user and reserved_at is not null;
 if already>0 then
  if already<>2 or exists(select 1 from public.matmove_referral_rewards r where r.new_user_id=p_new_user and
   (r.source_account is distinct from p_source or r.wallet_id::text is distinct from (case when r.kind='inviter' then p->'inviter' else p->'new_user' end)->>'wallet_id'
    or r.destination_account is distinct from (case when r.kind='inviter' then p->'inviter' else p->'new_user' end)->>'account_id')) then raise exception 'CONFLICT: Reserved referral accounts changed. Review the original payments.';end if;
  return jsonb_build_object('new_user_id',p_new_user,'reserved',true);
 end if;
 if exists(select 1 from public.matmove_referral_rewards where new_user_id=p_new_user and (state<>'pending' or claimed_at is not null or provider_id is not null)) then raise exception 'CONFLICT: Unreserved reward receipts need review.';end if;
 if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 then raise exception 'INVALID: Refresh the referral treasury balance.';end if;
 select coalesce(sum(amount_minor),0) into budget_used from public.matmove_referral_rewards where reserved_at is not null;
 if c.budget_minor<budget_used+200 then raise exception 'CAPACITY: Referral campaign budget is insufficient.';end if;
 -- Retain recently released reservations when a balance snapshot predates a completion.
 select coalesce(sum(amount_minor),0) into reserved from public.matmove_referral_rewards
 where source_account=p_source and reserved_at is not null and (state<>'completed' or updated_at>=p_observed);
 if p_balance<reserved+200 then raise exception 'CAPACITY: Referral funds are reserved or insufficient. Rewards remain pending.';end if;
 foreach v_kind in array array['phone','identity'] loop
  fp:=new_identity->>(v_kind||'_fingerprint');
  if exists(select 1 from public.matmove_referral_identity_claims where matmove_referral_identity_claims.kind=v_kind and fingerprint=fp and new_user_id<>p_new_user) then
   raise exception 'FORBIDDEN: This referral identity has already qualified. Review required.';
  end if;
  insert into public.matmove_referral_identity_claims(kind,fingerprint,new_user_id) values(v_kind,fp,p_new_user) on conflict do nothing;
 end loop;
 update public.matmove_referral_rewards r set source_account=p_source,
 wallet_id=((case when r.kind='inviter' then p->'inviter' else p->'new_user' end)->>'wallet_id')::uuid,
 destination_account=(case when r.kind='inviter' then p->'inviter' else p->'new_user' end)->>'account_id',
 reserved_at=clock_timestamp(),updated_at=clock_timestamp() where new_user_id=p_new_user;
 return jsonb_build_object('new_user_id',p_new_user,'reserved',true);
end $referral$;
create or replace function public.matmove_referral_claim(p_reward uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare r public.matmove_referral_rewards%rowtype;p jsonb;recipient jsonb;c public.matmove_referral_campaign%rowtype;
begin
 perform pg_advisory_xact_lock(87192814);
 select * into r from public.matmove_referral_rewards where id=p_reward for update;
 if not found then raise exception 'NOT_FOUND: Referral reward not found.';end if;
 if r.state in ('completed','failed') then return to_jsonb(r)||jsonb_build_object('can_create',false);end if;
 -- Receipt polling does not authorize new money movement, even after a freeze/pause.
 if r.provider_id is not null then return to_jsonb(r)||jsonb_build_object('can_create',false);end if;
 if r.claimed_at is not null then
  update public.matmove_referral_rewards set state='review_required',error='Original provider response unavailable. Attach its verified receipt; never resend.',updated_at=clock_timestamp() where id=r.id returning * into r;
  return to_jsonb(r)||jsonb_build_object('can_create',false);
 end if;
 if r.reserved_at is null or r.source_account is null or r.destination_account is null then raise exception 'CONFLICT: Reserve both referral rewards first.';end if;
 select * into c from public.matmove_referral_campaign where singleton;
 if not c.payments_enabled or c.treasury_account is distinct from r.source_account then raise exception 'PAUSED: New referral reward transfers are paused.';end if;
 p:=public.matmove_referral_participants(r.new_user_id);recipient:=case when r.kind='inviter' then p->'inviter' else p->'new_user' end;
 if recipient->>'user_id'<>r.beneficiary_id::text or recipient->>'wallet_id'<>r.wallet_id::text or recipient->>'account_id'<>r.destination_account
 or exists(select 1 from public.wallets where monime_account_id=r.source_account or metadata->>'monime_account_id'=r.source_account)
 or not exists(select 1 from public.matmove_referral_identity_claims where kind='phone' and new_user_id=r.new_user_id and fingerprint=p->'new_user'->>'phone_fingerprint')
 or not exists(select 1 from public.matmove_referral_identity_claims where kind='identity' and new_user_id=r.new_user_id and fingerprint=p->'new_user'->>'identity_fingerprint') then raise exception 'FORBIDDEN: Referral account or identity changed. Review required.';end if;
 update public.matmove_referral_rewards set claimed_at=clock_timestamp(),state='processing',updated_at=clock_timestamp() where id=r.id returning * into r;
 return to_jsonb(r)||jsonb_build_object('can_create',true);
end $referral$;
create or replace function public.matmove_referral_record(p_reward uuid,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare r public.matmove_referral_rewards%rowtype;matches boolean;next_state text;
begin
 perform pg_advisory_xact_lock(87192814);
 select * into r from public.matmove_referral_rewards where id=p_reward for update;
 if not found then raise exception 'NOT_FOUND: Referral reward not found.';end if;
 if r.claimed_at is null or r.reserved_at is null then raise exception 'CONFLICT: Reward was never authorized for transfer.';end if;
 matches:=coalesce(p_receipt->>'id' ~ '^trn-[A-Za-z0-9_-]+$',false)
 and (r.provider_id is null or r.provider_id=p_receipt->>'id')
 and p_receipt#>>'{amount,currency}'='SLE' and jsonb_typeof(p_receipt#>'{amount,value}')='number' and p_receipt#>>'{amount,value}'='100'
 and p_receipt#>>'{sourceFinancialAccount,id}'=r.source_account and p_receipt#>>'{destinationFinancialAccount,id}'=r.destination_account
 and p_receipt#>>'{metadata,matmoveReferralRewardId}'=r.id::text and p_receipt#>>'{metadata,matmoveReferralNewUserId}'=r.new_user_id::text
 and p_receipt#>>'{metadata,matmoveReferralKind}'=r.kind and p_receipt#>>'{metadata,matmoveReferralRequestKey}'=r.request_key::text
 and p_receipt->>'status' in ('pending','processing','completed','failed');
 if r.state='completed' then
  if not coalesce(matches,false) then raise exception 'CONFLICT: Completed reward receipt cannot be replaced.';end if;
  return to_jsonb(r);
 end if;
 if r.state='failed' then return to_jsonb(r);end if;
 if not coalesce(matches,false) then
  update public.matmove_referral_rewards set state='review_required',error='Receipt unavailable or does not match the exact referral payment. Never resend.',updated_at=clock_timestamp() where id=r.id returning * into r;
 else
  next_state:=case when p_receipt->>'status' in ('completed','failed') then p_receipt->>'status' else 'processing' end;
  update public.matmove_referral_rewards set provider_id=p_receipt->>'id',state=next_state,
   error=case when next_state='failed' then 'Provider confirmed the original transfer failed. Review required; no automatic resend.' else null end,
   updated_at=clock_timestamp() where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $referral$;
-- Rotate deferred work without releasing reservations or altering receipt states.
create or replace function public.matmove_referral_defer(p_new_user uuid,p_error text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $referral$
begin
 perform pg_advisory_xact_lock(87192814);
 update public.matmove_referral_rewards set updated_at=clock_timestamp(),error=coalesce(error,left(p_error,300))
 where new_user_id=p_new_user and state not in ('completed','failed');
end $referral$;
revoke all on function public.matmove_referral_defer(uuid,text) from public,anon,authenticated;
grant execute on function public.matmove_referral_defer(uuid,text) to service_role;
revoke all on function public.matmove_referral_wallet(uuid),public.matmove_referral_participants(uuid),public.matmove_referral_prepare(uuid,text,bigint,timestamptz),public.matmove_referral_claim(uuid),public.matmove_referral_record(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_referral_participants(uuid),public.matmove_referral_prepare(uuid,text,bigint,timestamptz),public.matmove_referral_claim(uuid),public.matmove_referral_record(uuid,jsonb) to service_role;
grant select on public.matmove_referrals,public.matmove_referral_rewards,public.matmove_referral_campaign to service_role;
notify pgrst,'reload schema';
commit;
