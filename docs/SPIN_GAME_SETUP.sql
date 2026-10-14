
-- Paste this ENTIRE file into Supabase SQL Editor and run as postgres.
-- This migration enables RLS itself. Do not let an editor generate extra ALTERs.
begin;
alter table public.profiles add column if not exists is_wallet_frozen boolean not null default false;
alter table public.wallets add column if not exists is_frozen boolean not null default false;
alter table public.admins add column if not exists permissions jsonb not null default '[]'::jsonb;

create table if not exists public.matmove_spin_configs (
 id bigint generated always as identity primary key,
 enabled boolean not null default false,
 sectors jsonb not null,
 created_at timestamptz not null default now(),
 created_by uuid
);
create table if not exists public.matmove_spin_access (
 user_id uuid primary key references public.profiles(id),
 verified_adult boolean not null default false,
 approved boolean not null default false,
 daily_limit_minor bigint not null default 1000 check(daily_limit_minor between 500 and 10000),
 updated_at timestamptz not null default now(),
 updated_by uuid
);
create table if not exists public.matmove_spin_rounds (
 id uuid primary key default gen_random_uuid(),
 request_key text unique not null,
 user_id uuid not null references public.profiles(id),
 wallet_id uuid not null references public.wallets(id),
 config_id bigint not null references public.matmove_spin_configs(id),
 sectors jsonb not null,
 lucky_digit text not null,
 source_account text not null,
 spin_account text not null,
 state text not null default 'entry_pending' check(state in ('entry_pending','active','win_pending','completed','failed','review_required')),
 entry_minor bigint not null default 500 check(entry_minor=500),
 reserve_minor bigint not null default 6000 check(reserve_minor=6000),
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists matmove_spin_one_open_round
 on public.matmove_spin_rounds(user_id) where state not in ('completed','failed');
create table if not exists public.matmove_spin_legs (
 id uuid primary key default gen_random_uuid(),
 round_id uuid not null references public.matmove_spin_rounds(id),
 kind text not null check(kind in ('entry','win')),
 spin_index integer not null check(spin_index between 0 and 3),
 sector_index integer,
 digit text,
 amount_minor bigint not null,
 source_account text not null,
 destination_account text not null,
 request_key text unique not null,
 provider_id text unique,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','review_required')),
 claimed_at timestamptz,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(round_id,spin_index),
 check((kind='entry' and spin_index=0 and sector_index is null and amount_minor=500) or
       (kind='win' and spin_index between 1 and 3 and sector_index>=0 and amount_minor in (100,500,1000,1500,2000)))
);
create table if not exists public.matmove_spin_canceled_entries (request_key text primary key, user_id uuid not null, created_at timestamptz not null default now());

create table if not exists public.matmove_spin_admin_log (
 id bigint generated always as identity primary key,
 admin_id uuid not null,
 action text not null,
 details jsonb not null,
 created_at timestamptz not null default now()
);

create or replace function public.matmove_spin_validate(p_sectors jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare s jsonb; seen text[] := '{}'; prizes integer[] := '{}';
begin
 if p_sectors is null or jsonb_typeof(p_sectors)<>'array' then raise exception 'INVALID: Wheel must be an array.'; end if;
 if jsonb_array_length(p_sectors) not between 5 and 120 then raise exception 'INVALID: Use 5 to 120 numbers.'; end if;
 for s in select value from jsonb_array_elements(p_sectors) loop
  if s->>'digit' is null or (s->>'digit') !~ '^\d{1,3}$' or s->>'digit'=any(seen)
     or jsonb_typeof(s->'digit')<>'string' or jsonb_typeof(s->'prizeMinor')<>'number'
     or (s->>'prizeMinor') not in ('100','500','1000','1500','2000') then
   raise exception 'INVALID: Unique digits and valid SLE prizes required.';
  end if;
  seen:=array_append(seen,s->>'digit'); prizes:=array_append(prizes,(s->>'prizeMinor')::integer);
 end loop;
 if not array[100,500,1000,1500,2000] <@ prizes then raise exception 'INVALID: All five prizes must be available.'; end if;
end;
$fn$;

-- This seed has 100 equal-probability numbers: 96 x SLE 1 plus each larger prize.
insert into public.matmove_spin_configs(enabled,sectors)
select false,jsonb_agg(jsonb_build_object('digit',n::text,'prizeMinor',case n when 5 then 500 when 10 then 1000 when 15 then 1500 when 20 then 2000 else 100 end) order by n)
from generate_series(0,99) n
having not exists(select 1 from public.matmove_spin_configs);

create or replace function public.matmove_spin_admin_allowed()
returns boolean language sql security definer set search_path=pg_catalog,public as $fn$
 select exists(select 1 from public.admins a where a.id=auth.uid()
  and coalesce((to_jsonb(a)->>'is_active')::boolean,true)
  and (coalesce((to_jsonb(a)->>'is_owner')::boolean,false)
       or to_jsonb(a)->>'role'='super_admin'
       or coalesce(to_jsonb(a)->'permissions','[]'::jsonb) ? 'games'));
$fn$;

create or replace function public.matmove_spin_admin_save(p_expected bigint,p_enabled boolean,p_sectors jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare c public.matmove_spin_configs%rowtype;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 perform pg_advisory_xact_lock(91837451);
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_expected then raise exception 'CONFLICT: Configuration changed. Reload before publishing.'; end if;
 perform public.matmove_spin_validate(p_sectors);
 if p_enabled is null then raise exception 'INVALID: Enable setting required.'; end if;
 insert into public.matmove_spin_configs(enabled,sectors,created_by) values(p_enabled,p_sectors,auth.uid()) returning * into c;
 insert into public.matmove_spin_admin_log(admin_id,action,details) values(auth.uid(),'PUBLISH_CONFIG',to_jsonb(c));
 return to_jsonb(c);
end;
$fn$;

create or replace function public.matmove_spin_admin_access(p_user uuid,p_verified_adult boolean,p_approved boolean,p_daily_limit bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a public.matmove_spin_access%rowtype;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 if p_verified_adult is null or p_approved is null or p_daily_limit is null or p_daily_limit not between 500 and 10000 or (p_approved and not p_verified_adult) then raise exception 'INVALID: Verify adult identity and set a daily entry limit.'; end if;
 if not exists(select 1 from public.profiles where id=p_user and kyc_status='approved' and role in ('rider','driver','merchant')) then raise exception 'INVALID: An approved customer identity is required.'; end if;
 insert into public.matmove_spin_access(user_id,verified_adult,approved,daily_limit_minor,updated_by) values(p_user,p_verified_adult,p_approved,p_daily_limit,auth.uid())
 on conflict(user_id) do update set verified_adult=excluded.verified_adult,approved=excluded.approved,daily_limit_minor=excluded.daily_limit_minor,updated_by=excluded.updated_by,updated_at=now() returning * into a;
 insert into public.matmove_spin_admin_log(admin_id,action,details) values(auth.uid(),'PLAYER_ACCESS',to_jsonb(a));
 return to_jsonb(a);
end;
$fn$;

create or replace function public.matmove_spin_admin_snapshot()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 return jsonb_build_object(
  'config',(select to_jsonb(c) from public.matmove_spin_configs c order by id desc limit 1),
  'reservedMinor',coalesce((select sum(reserve_minor) from public.matmove_spin_rounds where state not in ('completed','failed')),0),
  'entryReceivedMinor',coalesce((select sum(amount_minor) from public.matmove_spin_legs where kind='entry' and status='completed'),0),
  'winsPaidMinor',coalesce((select sum(amount_minor) from public.matmove_spin_legs where kind='win' and status='completed'),0),
  'winsOwedMinor',coalesce((select sum(amount_minor) from public.matmove_spin_legs where kind='win' and status<>'completed'),0),
  'rounds',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.matmove_spin_rounds order by created_at desc limit 100) r),'[]'),
  'receipts',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.matmove_spin_legs order by created_at desc limit 400) t),'[]'),
  'access',coalesce((select jsonb_agg(to_jsonb(a)) from (select * from public.matmove_spin_access order by updated_at desc limit 100) a),'[]')
 );
end;
$fn$;

create or replace function public.matmove_spin_prepare(p_key text,p_user uuid,p_wallet uuid,p_config bigint,p_digit text,p_source text,p_spin text,p_balance bigint,p_observed timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare c public.matmove_spin_configs%rowtype; r public.matmove_spin_rounds%rowtype; a public.matmove_spin_access%rowtype; reserved bigint; spent bigint;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_spin_rounds where request_key=p_key for update;
 if found then
  if r.user_id<>p_user or r.wallet_id<>p_wallet or r.config_id<>p_config or r.lucky_digit<>p_digit or r.source_account<>p_source or r.spin_account<>p_spin then raise exception 'CONFLICT: Entry request changed.'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.matmove_spin_canceled_entries where request_key=p_key) then raise exception 'CONFLICT: This unstarted entry was canceled. Create a new entry.'; end if;
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_source is null or p_spin is null or p_source=p_spin or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_spin !~ '^fac-[A-Za-z0-9_-]+$' then raise exception 'INVALID: Account configuration invalid.'; end if;
 if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 then raise exception 'INVALID: Refresh treasury balance.'; end if;
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_config or not c.enabled then raise exception 'CONFLICT: Game paused or rules changed. Review the rules again.'; end if;
 if not exists(select 1 from jsonb_array_elements(c.sectors) s where s->>'digit'=p_digit) then raise exception 'INVALID: Choose a wheel number.'; end if;
 perform 1 from public.profiles where id=p_user for update;
 select * into a from public.matmove_spin_access where user_id=p_user;
 if not found or not a.approved or not a.verified_adult then raise exception 'FORBIDDEN: Verified adult game access required.'; end if;
 if not exists(select 1 from public.profiles where id=p_user and role in ('rider','driver','merchant') and kyc_status='approved' and not coalesce(is_wallet_frozen,false)) then raise exception 'FORBIDDEN: Customer approval and an unfrozen wallet are required.'; end if;
 perform 1 from public.wallets where id=p_wallet and user_id=p_user and currency='SLE' and not coalesce(is_frozen,false)
  and coalesce(monime_account_id,metadata->>'monime_account_id')=p_source for update;
 if not found then raise exception 'FORBIDDEN: Invalid or frozen SLE wallet.'; end if;
 if exists(select 1 from public.matmove_spin_rounds where user_id=p_user and state not in ('completed','failed')) then raise exception 'CONFLICT: Finish your existing game first.'; end if;
 select coalesce(sum(entry_minor),0) into spent from public.matmove_spin_rounds where user_id=p_user and state<>'failed'
  and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+500>a.daily_limit_minor then raise exception 'FORBIDDEN: Your daily game entry limit has been reached.'; end if;
 -- Do not treat future entry money as prize reserves. Recent released reserves
 -- remain counted if their completion happened after the balance read began.
 select coalesce(sum(reserve_minor),0) into reserved from public.matmove_spin_rounds
  where spin_account=p_spin and (state not in ('completed','failed') or updated_at>=p_observed);
 if p_balance<reserved+6000 then raise exception 'CONFLICT: The Spin Account needs more prize funds before accepting entries.'; end if;
 insert into public.matmove_spin_rounds(request_key,user_id,wallet_id,config_id,sectors,lucky_digit,source_account,spin_account)
 values(p_key,p_user,p_wallet,c.id,c.sectors,p_digit,p_source,p_spin) returning * into r;
 insert into public.matmove_spin_legs(round_id,kind,spin_index,amount_minor,source_account,destination_account,request_key)
 values(r.id,'entry',0,500,p_source,p_spin,p_key||':entry');
 return to_jsonb(r);
end;
$fn$;

create or replace function public.matmove_spin_draw(p_id uuid,p_user uuid,p_index integer,p_sector integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_spin_rounds%rowtype; t public.matmove_spin_legs%rowtype; s jsonb; next_index integer;
begin
 select * into r from public.matmove_spin_rounds where id=p_id for update;
 if not found or r.user_id is distinct from p_user then raise exception 'FORBIDDEN: This game does not belong to you.'; end if;
 select * into t from public.matmove_spin_legs where round_id=p_id and spin_index=p_index;
 if found then return to_jsonb(t); end if;
 if r.state<>'active' then raise exception 'CONFLICT: Complete the current payment before spinning.'; end if;
 if exists(select 1 from public.wallets where id=r.wallet_id and is_frozen) or exists(select 1 from public.profiles where id=p_user and is_wallet_frozen) then raise exception 'FORBIDDEN: Wallet frozen. Your paid round is retained.'; end if;
 select coalesce(max(spin_index),0)+1 into next_index from public.matmove_spin_legs where round_id=p_id;
 if p_index is null or p_index<>next_index or p_index>3 or p_sector is null or p_sector not between 0 and jsonb_array_length(r.sectors)-1 then raise exception 'INVALID: Invalid spin sequence.'; end if;
 s:=r.sectors->p_sector;
 insert into public.matmove_spin_legs(round_id,kind,spin_index,sector_index,digit,amount_minor,source_account,destination_account,request_key)
 values(p_id,'win',p_index,p_sector,s->>'digit',(s->>'prizeMinor')::bigint,r.spin_account,r.source_account,r.request_key||':spin:'||p_index) returning * into t;
 update public.matmove_spin_rounds set state='win_pending',updated_at=now() where id=p_id;
 return to_jsonb(t);
end;
$fn$;

create or replace function public.matmove_spin_claim(p_id uuid,p_index integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_spin_rounds%rowtype; t public.matmove_spin_legs%rowtype; allowed boolean:=false;
begin
 select * into r from public.matmove_spin_rounds where id=p_id for update;
 select * into t from public.matmove_spin_legs where round_id=p_id and spin_index=p_index for update;
 if t.id is null then raise exception 'NOT_FOUND: Game payment not found.'; end if;
 if t.status in ('completed','failed','review_required') then return to_jsonb(t)||jsonb_build_object('can_create',false); end if;
 if t.claimed_at is not null and t.provider_id is null then
  if t.claimed_at<now()-interval '90 seconds' then
   update public.matmove_spin_legs set status='review_required',error='Provider response missing. Verify the original request key; do not resend.' where id=t.id;
   update public.matmove_spin_rounds set state='review_required',error='A payment needs receipt review.',updated_at=now() where id=p_id;
  end if;
  return to_jsonb(t)||jsonb_build_object('can_create',false);
 end if;
 if t.claimed_at is null then
  if exists(select 1 from public.wallets where id=r.wallet_id and is_frozen) or exists(select 1 from public.profiles where id=r.user_id and is_wallet_frozen) then
   if p_index=0 then
    update public.matmove_spin_legs set status='failed',error='Wallet frozen before entry debit.' where id=t.id;
    update public.matmove_spin_rounds set state='failed',error='Wallet frozen before entry debit.',updated_at=now() where id=p_id;
   else
    update public.matmove_spin_legs set status='review_required',error='Wallet frozen before prize credit.' where id=t.id;
    update public.matmove_spin_rounds set state='review_required',error='Prize retained for frozen wallet.',updated_at=now() where id=p_id;
   end if;
   return to_jsonb(t)||jsonb_build_object('can_create',false);
  end if;
  update public.matmove_spin_legs set claimed_at=now(),status='processing',updated_at=now() where id=t.id returning * into t;
  allowed:=true;
 end if;
 return to_jsonb(t)||jsonb_build_object('can_create',allowed);
end;
$fn$;

create or replace function public.matmove_spin_record(p_id uuid,p_index integer,p_provider text,p_status text,p_error text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_spin_rounds%rowtype; t public.matmove_spin_legs%rowtype;
begin
 select * into r from public.matmove_spin_rounds where id=p_id for update;
 select * into t from public.matmove_spin_legs where round_id=p_id and spin_index=p_index for update;
 if t.id is null then raise exception 'NOT_FOUND: Game payment not found.'; end if;
 if p_status is null or p_status not in ('pending','processing','completed','failed','review_required') then raise exception 'INVALID: Invalid payment state.'; end if;
 if t.provider_id is not null and p_provider is distinct from t.provider_id then raise exception 'CONFLICT: Provider receipt changed.'; end if;
 if t.status='completed' then return to_jsonb(r); end if;
 if p_status='completed' and (p_provider is null or p_provider !~ '^trn-[A-Za-z0-9_-]+$') then raise exception 'INVALID: Completed provider receipt required.'; end if;
 update public.matmove_spin_legs set provider_id=coalesce(provider_id,p_provider),status=p_status,error=p_error,updated_at=now() where id=t.id;
 if p_status='completed' then
  update public.matmove_spin_rounds set state=case when p_index=3 then 'completed' else 'active' end,error=null,updated_at=now() where id=p_id;
 elsif p_status='failed' and p_index=0 then
  update public.matmove_spin_rounds set state='failed',error=p_error,updated_at=now() where id=p_id;
 elsif p_status in ('failed','review_required') then
  update public.matmove_spin_rounds set state='review_required',error=coalesce(p_error,'Prize payment needs review.'),updated_at=now() where id=p_id;
 end if;
 select * into r from public.matmove_spin_rounds where id=p_id;
 return to_jsonb(r);
end;
$fn$;

create or replace function public.matmove_spin_cancel_entry(p_key text,p_user uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_spin_rounds%rowtype;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_spin_rounds where request_key=p_key;
 if found then
  if r.user_id is distinct from p_user then raise exception 'FORBIDDEN: Entry belongs to another account.'; end if;
  return jsonb_build_object('canceled',false,'roundId',r.id);
 end if;
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_user is null then raise exception 'INVALID: Entry key required.'; end if;
 insert into public.matmove_spin_canceled_entries(request_key,user_id) values(p_key,p_user) on conflict do nothing;
 return jsonb_build_object('canceled',true);
end;
$fn$;

-- Receipt recovery attaches an existing provider receipt; it NEVER resends money.
create or replace function public.matmove_spin_admin_receipt(p_id uuid,p_index integer,p_provider text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare t public.matmove_spin_legs%rowtype;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 if p_provider is null or p_provider !~ '^trn-[A-Za-z0-9_-]+$' then raise exception 'INVALID: Enter the actual Monime transfer ID.'; end if;
 perform 1 from public.matmove_spin_rounds where id=p_id for update;
 select * into t from public.matmove_spin_legs where round_id=p_id and spin_index=p_index for update;
 if not found or t.status='completed' or (t.provider_id is not null and t.provider_id<>p_provider) then raise exception 'CONFLICT: Receipt cannot be changed.'; end if;
 update public.matmove_spin_legs set provider_id=p_provider,status='processing',updated_at=now() where id=t.id;
 update public.matmove_spin_rounds set state=case when p_index=0 then 'entry_pending' else 'win_pending' end,error=null,updated_at=now() where id=p_id;
 insert into public.matmove_spin_admin_log(admin_id,action,details) values(auth.uid(),'ATTACH_RECEIPT',jsonb_build_object('roundId',p_id,'index',p_index,'providerId',p_provider));
end;
$fn$;

alter table public.matmove_spin_canceled_entries enable row level security;
revoke all on public.matmove_spin_canceled_entries from anon,authenticated;
grant all on public.matmove_spin_canceled_entries to service_role;
alter table public.matmove_spin_configs enable row level security;
alter table public.matmove_spin_access enable row level security;
alter table public.matmove_spin_rounds enable row level security;
alter table public.matmove_spin_legs enable row level security;
alter table public.matmove_spin_admin_log enable row level security;
revoke all on public.matmove_spin_configs,public.matmove_spin_access,public.matmove_spin_rounds,public.matmove_spin_legs,public.matmove_spin_admin_log from anon,authenticated;
grant all on public.matmove_spin_configs,public.matmove_spin_access,public.matmove_spin_rounds,public.matmove_spin_legs,public.matmove_spin_admin_log to service_role;
grant usage,select on sequence public.matmove_spin_configs_id_seq,public.matmove_spin_admin_log_id_seq to service_role;

-- Restrict every function in this feature, including new overloads.
do $acl$
declare f record;
begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'matmove_spin_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end;
$acl$;
grant execute on function public.matmove_spin_admin_allowed(), public.matmove_spin_admin_snapshot(), public.matmove_spin_admin_save(bigint,boolean,jsonb), public.matmove_spin_admin_access(uuid,boolean,boolean,bigint), public.matmove_spin_admin_receipt(uuid,integer,text) to authenticated;
commit;
