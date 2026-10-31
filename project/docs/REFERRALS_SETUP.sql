
-- CUSTOMER: docs/REFERRALS_SETUP.sql. Run the COMPLETE file in shared Supabase.
-- Referral attribution and private account view only. NO transfers are sent.
-- Campaign starts paused; later payment setup must verify the dedicated treasury.
begin;
do $prerequisite$ begin
 if to_regprocedure('public.matmove_preferences_role(uuid)') is null or to_regclass('public.matmove_staff_access') is null
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='customer_account_started_at') then
  raise exception 'Run the current customer onboarding, Home preferences and staff setup first.';
 end if;
end $prerequisite$;
create table if not exists public.matmove_referral_campaign (
 singleton boolean primary key default true check(singleton),
 version bigint not null default 1 check(version>0),
 accepting_referrals boolean not null default false,
 payments_enabled boolean not null default false,
 reward_minor bigint not null default 100 check(reward_minor=100),
 currency text not null default 'SLE' check(currency='SLE'),
 registration_opens_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(not payments_enabled or accepting_referrals)
);
insert into public.matmove_referral_campaign(singleton) values(true) on conflict do nothing;
create table if not exists public.matmove_referral_codes (
 user_id uuid primary key references auth.users(id),
 code text not null unique check(code ~ '^MM[A-F0-9]{12}$'),
 created_at timestamptz not null default now()
);
create table if not exists public.matmove_referrals (
 new_user_id uuid primary key references auth.users(id),
 referrer_id uuid not null references auth.users(id),
 code text not null references public.matmove_referral_codes(code),
 reward_minor bigint not null default 100 check(reward_minor=100),
 currency text not null default 'SLE' check(currency='SLE'),
 campaign_version bigint not null,
 created_at timestamptz not null default now(),
 check(new_user_id<>referrer_id)
);
create index if not exists matmove_referrals_inviter on public.matmove_referrals(referrer_id,created_at desc);
create table if not exists public.matmove_referral_rewards (
 id uuid primary key default gen_random_uuid(),
 new_user_id uuid not null references public.matmove_referrals(new_user_id),
 beneficiary_id uuid not null references auth.users(id),
 kind text not null check(kind in ('inviter','new_user')),
 amount_minor bigint not null default 100 check(amount_minor=100),
 currency text not null default 'SLE' check(currency='SLE'),
 state text not null default 'pending' check(state in ('pending','processing','completed','review_required','failed')),
 request_key uuid not null unique default gen_random_uuid(),
 provider_id text unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(new_user_id,kind),unique(new_user_id,beneficiary_id),
 check(state<>'completed' or nullif(btrim(provider_id),'') is not null)
);
create index if not exists matmove_referral_reward_owner on public.matmove_referral_rewards(beneficiary_id,created_at desc);
alter table public.matmove_referral_campaign enable row level security;
alter table public.matmove_referral_codes enable row level security;
alter table public.matmove_referrals enable row level security;
alter table public.matmove_referral_rewards enable row level security;
revoke all on public.matmove_referral_campaign,public.matmove_referral_codes,public.matmove_referrals,public.matmove_referral_rewards from public,anon,authenticated;

create or replace function public.matmove_referral_customer(p_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $referral$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_id and p.role::text in ('rider','driver','merchant')
 and (not exists(select 1 from public.user_roles r where r.profile_id=p.id) or exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text=p.role::text))
 and not exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text not in ('rider','driver','merchant'))
 and not exists(select 1 from public.matmove_staff_access a where a.id=p.id and a.is_active and coalesce(to_jsonb(a)->>'removed_at','')=''));
$referral$;
create or replace function public.matmove_referral_my_code()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare v public.matmove_referral_codes%rowtype;candidate text;
begin
 perform public.matmove_preferences_role(auth.uid());
 if not public.matmove_referral_customer(auth.uid()) then raise exception 'ACCESS: Customer account required.';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select * into v from public.matmove_referral_codes where user_id=auth.uid();
 if not found then
  loop
   candidate:='MM'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
   begin insert into public.matmove_referral_codes(user_id,code) values(auth.uid(),candidate) returning * into v;exit;
   exception when unique_violation then null;end;
  end loop;
 end if;
 return jsonb_build_object('user_id',auth.uid(),'code',v.code);
end $referral$;

-- Called during NEW account setup, before KYC. It creates no wallet transactions.
create or replace function public.matmove_referral_register(p_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $referral$
declare clean text:=upper(btrim(coalesce(p_code,'')));c public.matmove_referral_campaign%rowtype;
 inviter uuid;existing public.matmove_referrals%rowtype;joined_at timestamptz;account_at timestamptz;kyc text;
begin
 perform public.matmove_preferences_role(auth.uid());
 if not public.matmove_referral_customer(auth.uid()) then raise exception 'ACCESS: Customer account required.';end if;
 if clean !~ '^MM[A-F0-9]{12}$' then raise exception 'INVALID: Enter a valid MatMove referral code.';end if;
 -- Serialize attribution/cycle checks. The new user can have only one referrer.
 perform pg_advisory_xact_lock(87192813);
 select * into existing from public.matmove_referrals where new_user_id=auth.uid();
 if found then
  if existing.code<>clean then raise exception 'CONFLICT: Your referral code is already recorded and cannot be changed.';end if;
  return jsonb_build_object('user_id',auth.uid(),'recorded',true,'code',existing.code);
 end if;
 select * into c from public.matmove_referral_campaign where singleton for share;
 if not c.accepting_referrals then raise exception 'PAUSED: Referral registration is not active yet. You can still create your account.';end if;
 select u.created_at,p.customer_account_started_at,p.kyc_status::text into joined_at,account_at,kyc
 from auth.users u join public.profiles p on p.id=u.id where u.id=auth.uid();
 if joined_at is null or account_at is null or joined_at<c.registration_opens_at or account_at<c.registration_opens_at or kyc='approved' then
  raise exception 'INELIGIBLE: Referral codes must be recorded during a new account setup before verification.';
 end if;
 select user_id into inviter from public.matmove_referral_codes where code=clean;
 if inviter is null or not public.matmove_referral_customer(inviter) then raise exception 'INVALID: This referral code is unavailable.';end if;
 if inviter=auth.uid() then raise exception 'INVALID: You cannot use your own referral code.';end if;
 if exists(with recursive ancestors(id) as (
  select inviter union select r.referrer_id from public.matmove_referrals r join ancestors a on r.new_user_id=a.id
 ) select 1 from ancestors where id=auth.uid()) then raise exception 'INVALID: Reciprocal and circular referrals are not eligible.';end if;
 insert into public.matmove_referrals(new_user_id,referrer_id,code,reward_minor,currency,campaign_version)
 values(auth.uid(),inviter,clean,c.reward_minor,c.currency,c.version);
 insert into public.matmove_referral_rewards(new_user_id,beneficiary_id,kind,amount_minor)
 values(auth.uid(),inviter,'inviter',c.reward_minor),(auth.uid(),auth.uid(),'new_user',c.reward_minor);
 return jsonb_build_object('user_id',auth.uid(),'recorded',true,'code',clean);
end $referral$;

create or replace function public.matmove_referrals_me()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $referral$
declare c public.matmove_referral_campaign%rowtype;own_code text;registered boolean;pending bigint;paid bigint;review bigint;count_invited bigint;
begin
 perform public.matmove_preferences_role(auth.uid());
 if not public.matmove_referral_customer(auth.uid()) then raise exception 'ACCESS: Customer account required.';end if;
 select * into c from public.matmove_referral_campaign where singleton;
 select code into own_code from public.matmove_referral_codes where user_id=auth.uid();
 select exists(select 1 from public.matmove_referrals where new_user_id=auth.uid()) into registered;
 select count(*) into count_invited from public.matmove_referrals where referrer_id=auth.uid();
 select coalesce(sum(amount_minor) filter(where state in ('pending','processing')),0),
 coalesce(sum(amount_minor) filter(where state='completed' and nullif(btrim(provider_id),'') is not null),0),
 count(*) filter(where state in ('review_required','failed')) into pending,paid,review
 from public.matmove_referral_rewards where beneficiary_id=auth.uid();
 return jsonb_build_object('user_id',auth.uid(),'code',own_code,'registered_with_code',registered,
 'campaign',jsonb_build_object('accepting',c.accepting_referrals,'payments_enabled',c.payments_enabled,'reward_minor',c.reward_minor::text,'currency',c.currency),
 'invited_count',count_invited::text,'pending_minor',pending::text,'credited_minor',paid::text,'review_count',review::text);
end $referral$;
revoke all on function public.matmove_referral_customer(uuid) from public,anon,authenticated;
revoke all on function public.matmove_referral_my_code(),public.matmove_referral_register(text),public.matmove_referrals_me() from public,anon,authenticated;
grant execute on function public.matmove_referral_my_code(),public.matmove_referral_register(text),public.matmove_referrals_me() to authenticated;
notify pgrst,'reload schema';
commit;
