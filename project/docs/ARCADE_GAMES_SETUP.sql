
-- MatMove account arcade: RICH DICE, Fruity Flue and CRANKLING.
-- Run the COMPLETE file as postgres in the ONE shared Supabase project.
-- Requires installed SPIN_GAME, SPIN_TIERS, SPIN_SIX_SEGMENTS, SPIN_BUNDLES_V2
-- and Customer onboarding/staff permission migrations. Run this AFTER those files.
-- Keeps RLS enabled. Does not replace existing wheel prices or prizes.
-- New games start paused; publish/enable them only after both deployments are ready.
begin;
do $preflight$
begin
 if to_regprocedure('public.matmove_spin_prepare_bundle(text,uuid,uuid,bigint,text,text,text,bigint,timestamp with time zone,integer)') is null
 or to_regprocedure('public.matmove_admin_any(text[])') is null then
  raise exception 'Install the current wheel bundles and staff permission setup first.';
 end if;
end;
$preflight$;

create table if not exists public.matmove_arcade_configs (
 id bigint generated always as identity primary key,
 settings jsonb not null,
 created_by uuid,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.matmove_arcade_rounds (
 id uuid primary key default gen_random_uuid(),
 request_key text not null unique check(request_key ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references public.profiles(id),
 wallet_id uuid not null references public.wallets(id),
 config_id bigint not null references public.matmove_arcade_configs(id),
 game text not null check(game in ('dice','fruity','crankling')),
 rules jsonb not null,
 prediction jsonb not null,
 source_account text not null,
 spin_account text not null check(spin_account <> source_account),
 entry_minor bigint not null check(entry_minor between 0 and 10000),
 attempt_count integer not null check(attempt_count between 1 and 3),
 reserve_minor bigint not null check(reserve_minor between 1 and 4000000),
 state text not null check(state in ('entry_pending','active','win_pending','completed','failed','review_required')),
 expires_at timestamptz,
 error text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists matmove_arcade_one_open_game on public.matmove_arcade_rounds(user_id,game) where state not in ('completed','failed');
create index if not exists matmove_arcade_user_history on public.matmove_arcade_rounds(user_id,created_at desc);
create index if not exists matmove_arcade_treasury on public.matmove_arcade_rounds(spin_account,state,updated_at);
create table if not exists public.matmove_arcade_outcomes (
 round_id uuid not null references public.matmove_arcade_rounds(id),
 attempt_index integer not null check(attempt_index between 1 and 3),
 reel_values integer[] not null,
 prize_minor bigint not null check(prize_minor between 0 and 4000000),
 created_at timestamptz not null default clock_timestamp(),
 primary key(round_id,attempt_index)
);
create table if not exists public.matmove_arcade_legs (
 id uuid primary key default gen_random_uuid(),
 round_id uuid not null references public.matmove_arcade_rounds(id),
 attempt_index integer not null check(attempt_index between 0 and 3),
 kind text not null check(kind in ('entry','win')),
 amount_minor bigint not null check(amount_minor between 1 and 4000000),
 source_account text not null,
 destination_account text not null check(destination_account<>source_account),
 request_key text not null unique,
 provider_id text unique,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','review_required')),
 claimed_at timestamptz,
 error text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(round_id,attempt_index),
 check((kind='entry' and attempt_index=0) or (kind='win' and attempt_index>0))
);
create table if not exists public.matmove_arcade_canceled_entries (
 request_key text primary key check(request_key ~ '^[a-f0-9]{64}$'),user_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.matmove_arcade_admin_events (
 id bigint generated always as identity primary key,admin_id uuid not null,action text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);

create or replace function public.matmove_arcade_validate(p_settings jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare d jsonb:=p_settings->'dice';f jsonb:=p_settings->'fruity';c jsonb:=p_settings->'crankling';v jsonb;k text;keys text[];
begin
 if p_settings is null or jsonb_typeof(p_settings)<>'object' or p_settings-ARRAY['dice','fruity','crankling'] <> '{}'::jsonb or not p_settings ?& ARRAY['dice','fruity','crankling'] then raise exception 'INVALID: Configure all three games.';end if;
 foreach k in array ARRAY['dice','fruity','crankling'] loop
  v:=p_settings->k;
  keys:=case k when 'dice' then ARRAY['enabled','minStakeMinor','maxStakeMinor','returnBps','dailyEntryLimitMinor'] when 'fruity' then ARRAY['enabled','prizeMinor','attempts','periodHours'] else ARRAY['enabled','entryMinor','prizeMinor','attempts','dailyEntryLimitMinor'] end;
  if jsonb_typeof(v) is distinct from 'object' or v-keys<>'{}'::jsonb or not v ?& keys or jsonb_typeof(v->'enabled') is distinct from 'boolean' then raise exception 'INVALID: Invalid game settings.';end if;
  foreach k in array keys loop
   if k<>'enabled' and (jsonb_typeof(v->k) is distinct from 'number' or v->>k !~ '^\d{1,7}$') then raise exception 'INVALID: Use integer SLE cents and valid game limits.';end if;
  end loop;
 end loop;
 if (d->>'minStakeMinor')::bigint not between 100 and 10000 or (d->>'maxStakeMinor')::bigint not between (d->>'minStakeMinor')::bigint and 10000 or (d->>'returnBps')::bigint not between 5000 and 10000 or (d->>'dailyEntryLimitMinor')::bigint not between (d->>'maxStakeMinor')::bigint and 100000 then raise exception 'INVALID: Invalid dice stake, target return or daily limit.';end if;
 if (f->>'prizeMinor')::bigint not between 100 and 100000 or (f->>'attempts')::int<>3 or (f->>'periodHours')::int<>24 then raise exception 'INVALID: Fruity Flue uses three attempts per rolling 24 hours.';end if;
 if (c->>'entryMinor')::bigint not between 100 and 10000 or (c->>'prizeMinor')::bigint not between 100 and 100000 or (c->>'attempts')::int<>3 or (c->>'dailyEntryLimitMinor')::bigint not between (c->>'entryMinor')::bigint and 100000 then raise exception 'INVALID: Invalid CRANKLING settings.';end if;
end;
$fn$;
insert into public.matmove_arcade_configs(settings)
select '{"dice":{"enabled":false,"minStakeMinor":100,"maxStakeMinor":2000,"returnBps":9000,"dailyEntryLimitMinor":10000},"fruity":{"enabled":false,"prizeMinor":5000,"attempts":3,"periodHours":24},"crankling":{"enabled":false,"entryMinor":2000,"prizeMinor":5000,"attempts":3,"dailyEntryLimitMinor":10000}}'::jsonb
where not exists(select 1 from public.matmove_arcade_configs);

-- Configurations are append-only. Purchased games keep their exact snapshot.
create or replace function public.matmove_arcade_config_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin raise exception 'FORBIDDEN: Publish a new configuration; purchased rules cannot be rewritten.';end;
$fn$;
drop trigger if exists matmove_arcade_config_immutable on public.matmove_arcade_configs;
create trigger matmove_arcade_config_immutable before update or delete on public.matmove_arcade_configs for each row execute function public.matmove_arcade_config_immutable();

create or replace function public.matmove_arcade_customer(p_user uuid,p_wallet uuid,p_source text)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where id=p_user for update;
 if not found or p.role not in ('rider','driver','merchant') or p.kyc_status is distinct from 'approved' or coalesce(p.is_wallet_frozen,false) or p.date_of_birth is null or p.date_of_birth::date > (clock_timestamp() at time zone 'UTC')::date-interval '18 years' then raise exception 'FORBIDDEN: Verified adult identity and an unfrozen customer wallet are required.';end if;
 perform 1 from public.wallets w where w.id=p_wallet and w.user_id=p_user and w.currency='SLE' and not coalesce(w.is_frozen,false) and coalesce(w.monime_account_id,w.metadata->>'monime_account_id')=p_source
 and (w.monime_account_id is null or w.metadata->>'monime_account_id' is null or w.monime_account_id=w.metadata->>'monime_account_id') for update;
 if not found or exists(select 1 from public.wallets where user_id=p_user and coalesce(is_frozen,false)) or (select count(*) from public.wallets where monime_account_id=p_source or metadata->>'monime_account_id'=p_source)<>1 then raise exception 'FORBIDDEN: An owned, uniquely linked, unfrozen SLE wallet is required.';end if;
end;
$fn$;

create or replace function public.matmove_arcade_dice_quote(p_rules jsonb,p_prediction jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare stake bigint;target integer;cmp text;wins integer;mult bigint;pay bigint;
begin
 if p_prediction is null or jsonb_typeof(p_prediction)<>'object' or p_prediction-ARRAY['stakeMinor','target','comparison']<>'{}'::jsonb or not p_prediction ?& ARRAY['stakeMinor','target','comparison'] or jsonb_typeof(p_prediction->'stakeMinor') is distinct from 'number' or jsonb_typeof(p_prediction->'target') is distinct from 'number' or p_prediction->>'stakeMinor' !~ '^\d{1,5}$' or p_prediction->>'target' !~ '^\d{1,2}$' then raise exception 'INVALID: Choose a valid dice stake and prediction.';end if;
 stake:=(p_prediction->>'stakeMinor')::bigint;target:=(p_prediction->>'target')::int;cmp:=p_prediction->>'comparison';
 if stake not between (p_rules->>'minStakeMinor')::bigint and (p_rules->>'maxStakeMinor')::bigint or target not between 2 and 12 or cmp is null or cmp not in ('above','equal','below') then raise exception 'INVALID: Choose a published dice stake and prediction.';end if;
 select count(*) into wins from generate_series(1,6) a cross join generate_series(1,6) b where case cmp when 'above' then a+b>target when 'below' then a+b<target else a+b=target end;
 if wins=0 then raise exception 'INVALID: This prediction cannot win.';end if;
 mult:=floor((p_rules->>'returnBps')::numeric*36/(wins*100));pay:=floor(stake::numeric*mult/100);
 return jsonb_build_object('wins',wins,'combinations',36,'multiplierHundredths',mult,'payoutMinor',pay);
end;
$fn$;

-- ONE treasury lock is shared with every installed wheel prepare RPC.
-- Expired, unused free attempts release capacity; pending prizes never expire.
create or replace function public.matmove_arcade_check_capacity(p_spin text,p_balance bigint,p_observed timestamptz,p_capacity bigint)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare reserved bigint;
begin
 perform pg_advisory_xact_lock(91837451);
 if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 or p_capacity is null or p_capacity<1 then raise exception 'INVALID: Refresh the Spin Account balance.';end if;
 update public.matmove_arcade_rounds set state='completed',updated_at=clock_timestamp() where game='fruity' and state='active' and expires_at<=clock_timestamp();
 select coalesce(sum(reserve_minor),0) into reserved from (
  select reserve_minor from public.matmove_spin_rounds where spin_account=p_spin and (state not in ('completed','failed') or updated_at>=p_observed)
  union all select reserve_minor from public.matmove_arcade_rounds where spin_account=p_spin and (state not in ('completed','failed') or updated_at>=p_observed)
 ) capacity;
 if p_balance<reserved+p_capacity then raise exception 'CONFLICT: The Spin Account needs more unreserved prize funds before a new game can start.';end if;
 perform set_config('matmove.arcade_capacity_ticket',p_spin||':'||p_capacity::text,true);
end;
$fn$;
create or replace function public.matmove_arcade_guard_reservation()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
begin
 if current_setting('matmove.arcade_capacity_ticket',true) is distinct from NEW.spin_account||':'||NEW.reserve_minor::text then raise exception 'CONFLICT: Shared treasury checks are required. Run ARCADE_GAMES_SETUP.sql after wheel migrations.';end if;
 perform set_config('matmove.arcade_capacity_ticket','',true);return NEW;
end;
$fn$;
drop trigger if exists matmove_arcade_guard_spin_reservation on public.matmove_spin_rounds;
create trigger matmove_arcade_guard_spin_reservation before insert on public.matmove_spin_rounds for each row execute function public.matmove_arcade_guard_reservation();
drop trigger if exists matmove_arcade_guard_arcade_reservation on public.matmove_arcade_rounds;
create trigger matmove_arcade_guard_arcade_reservation before insert on public.matmove_arcade_rounds for each row execute function public.matmove_arcade_guard_reservation();

-- Add the shared check to all FOUR existing entry functions, preserving their
-- original rules, signatures and grants. Re-running this migration is safe.
-- If an old wheel migration is accidentally re-run later, the insert guard
-- fails closed until this migration is run again; funds cannot be overbooked.
do $patch$
declare f record;definition text;needle text:='insert into public.matmove_spin_rounds(request_key';capacity text;n integer:=0;
begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('matmove_spin_prepare','matmove_spin_prepare_tier','matmove_spin_prepare_six','matmove_spin_prepare_bundle') loop
  definition:=pg_get_functiondef(f.oid);n:=n+1;
  if position('perform public.matmove_arcade_check_capacity(' in definition)=0 then
   if position(needle in definition)=0 then raise exception 'Unrecognized wheel entry function %. No changes applied.',f.proname;end if;
   capacity:=case f.proname when 'matmove_spin_prepare' then '6000' when 'matmove_spin_prepare_tier' then '15000' else 'capacity' end;
   definition:=replace(definition,needle,'perform public.matmove_arcade_check_capacity(p_spin,p_balance,p_observed,'||capacity||');'||chr(10)||' '||needle);
   execute definition;
  end if;
 end loop;
 if n<>4 then raise exception 'All four wheel migrations must be installed before Arcade setup.';end if;
end;
$patch$;

create or replace function public.matmove_arcade_prepare(p_key text,p_user uuid,p_wallet uuid,p_config bigint,p_game text,p_prediction jsonb,p_accepted bigint,p_accepted_prize bigint,p_source text,p_spin text,p_balance bigint,p_observed timestamptz)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;c public.matmove_arcade_configs%rowtype;rules jsonb;q jsonb;entry bigint;capacity bigint;attempts integer;spent bigint;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_arcade_rounds where request_key=p_key for update;
 if found then
  if r.user_id is distinct from p_user or r.wallet_id is distinct from p_wallet or r.config_id is distinct from p_config or r.game is distinct from p_game or r.prediction is distinct from p_prediction or r.entry_minor is distinct from p_accepted or r.source_account is distinct from p_source or r.spin_account is distinct from p_spin or (r.game='dice' and r.reserve_minor is distinct from p_accepted_prize) then raise exception 'CONFLICT: This game request changed.';end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.matmove_arcade_canceled_entries where request_key=p_key) then raise exception 'CONFLICT: This unstarted request was canceled. Create a fresh entry.';end if;
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_game is null or p_game not in ('dice','fruity','crankling') or p_source is null or p_spin is null or p_source=p_spin or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_spin !~ '^fac-[A-Za-z0-9_-]+$' or exists(select 1 from public.wallets where monime_account_id=p_spin or metadata->>'monime_account_id'=p_spin) then raise exception 'INVALID: Invalid game or financial accounts.';end if;
 select * into c from public.matmove_arcade_configs order by id desc limit 1 for update;
 if c.id is distinct from p_config then raise exception 'CONFLICT: Rules changed. Review the new game settings.';end if;
 perform public.matmove_arcade_validate(c.settings);rules:=c.settings->p_game;
 if not (rules->>'enabled')::boolean then raise exception 'CONFLICT: New entries for this game are paused.';end if;
 perform public.matmove_arcade_customer(p_user,p_wallet,p_source);
 if p_game='dice' then
  q:=public.matmove_arcade_dice_quote(rules,p_prediction);entry:=(p_prediction->>'stakeMinor')::bigint;attempts:=1;capacity:=(q->>'payoutMinor')::bigint;
  if capacity is distinct from p_accepted_prize then raise exception 'CONFLICT: Review and accept the quoted dice payout.';end if;
 elsif p_game='crankling' then
  if p_prediction is null or jsonb_typeof(p_prediction)<>'object' or p_prediction-ARRAY['luckyNumber']<>'{}'::jsonb or jsonb_typeof(p_prediction->'luckyNumber') is distinct from 'number' or p_prediction->>'luckyNumber' !~ '^([1-9]|10)$' then raise exception 'INVALID: Choose one number from 1 to 10 before paying.';end if;
  entry:=(rules->>'entryMinor')::bigint;attempts:=3;capacity:=(rules->>'prizeMinor')::bigint*3;
 else
  if p_prediction is distinct from '{}'::jsonb then raise exception 'INVALID: Fruity Flue has no player-selected result.';end if;
  entry:=0;attempts:=3;capacity:=(rules->>'prizeMinor')::bigint*3;
 end if;
 if p_accepted is distinct from entry then raise exception 'CONFLICT: Review the current entry amount.';end if;
 -- Keep unfinished games and any unpaid wins; never start another charge over them.
 if exists(select 1 from public.matmove_arcade_rounds where user_id=p_user and game=p_game and state not in ('completed','failed') and not (game='fruity' and state='active' and expires_at<=clock_timestamp())) then raise exception 'CONFLICT: Finish your existing game or wait for its payment confirmation.';end if;
 if p_game='fruity' and exists(select 1 from public.matmove_arcade_rounds where user_id=p_user and game='fruity' and created_at>clock_timestamp()-interval '24 hours') then raise exception 'CONFLICT: Your Fruity Flue attempts reset 24 hours after your first play.';end if;
 if p_game<>'fruity' then
  select coalesce(sum(entry_minor),0) into spent from public.matmove_arcade_rounds where user_id=p_user and game=p_game and state<>'failed' and created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  if spent+entry>(rules->>'dailyEntryLimitMinor')::bigint then raise exception 'FORBIDDEN: Your published daily entry limit has been reached.';end if;
 end if;
 perform public.matmove_arcade_check_capacity(p_spin,p_balance,p_observed,capacity);
 insert into public.matmove_arcade_rounds(request_key,user_id,wallet_id,config_id,game,rules,prediction,source_account,spin_account,entry_minor,attempt_count,reserve_minor,state,expires_at)
 values(p_key,p_user,p_wallet,c.id,p_game,rules,p_prediction,p_source,p_spin,entry,attempts,capacity,case when entry=0 then 'active' else 'entry_pending' end,case when p_game='fruity' then clock_timestamp()+interval '24 hours' else null end) returning * into r;
 if entry>0 then insert into public.matmove_arcade_legs(round_id,attempt_index,kind,amount_minor,source_account,destination_account,request_key) values(r.id,0,'entry',entry,p_source,p_spin,p_key||':entry');end if;
 return to_jsonb(r);
end;
$fn$;

create or replace function public.matmove_arcade_draw(p_id uuid,p_user uuid,p_index integer,p_values integer[])
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;o public.matmove_arcade_outcomes%rowtype;next_index integer;prize bigint:=0;total integer;q jsonb;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_arcade_rounds where id=p_id for update;
 if not found or r.user_id is distinct from p_user then raise exception 'FORBIDDEN: This game does not belong to you.';end if;
 select * into o from public.matmove_arcade_outcomes where round_id=p_id and attempt_index=p_index;
 if found then return to_jsonb(o);end if;
 if r.state<>'active' then raise exception 'CONFLICT: Complete the pending payment before playing.';end if;
 if r.expires_at is not null and r.expires_at<=clock_timestamp() then raise exception 'CONFLICT: These free attempts expired. Start a new daily game.';end if;
 perform public.matmove_arcade_customer(r.user_id,r.wallet_id,r.source_account);
 select count(*)+1 into next_index from public.matmove_arcade_outcomes where round_id=p_id;
 if p_index is null or p_index<>next_index or p_index>r.attempt_count or p_values is null or array_ndims(p_values) is distinct from 1 or array_lower(p_values,1)<>1 or exists(select 1 from unnest(p_values) n where n is null) then raise exception 'INVALID: Invalid attempt sequence or outcome.';end if;
 if r.game='fruity' then
  if cardinality(p_values)<>4 or exists(select 1 from unnest(p_values) n where n not between 0 and 49) then raise exception 'INVALID: Four valid fruit IDs required.';end if;
  if p_values[1]=p_values[2] and p_values[1]=p_values[3] and p_values[1]=p_values[4] then prize:=(r.rules->>'prizeMinor')::bigint;end if;
 elsif r.game='crankling' then
  if cardinality(p_values)<>3 or exists(select 1 from unnest(p_values) n where n not between 1 and 10) then raise exception 'INVALID: Three valid reel numbers required.';end if;
  if p_values[1]=(r.prediction->>'luckyNumber')::integer and p_values[2]=p_values[1] and p_values[3]=p_values[1] then prize:=(r.rules->>'prizeMinor')::bigint;end if;
 else
  if cardinality(p_values)<>2 or exists(select 1 from unnest(p_values) n where n not between 1 and 6) then raise exception 'INVALID: Two valid dice required.';end if;
  total:=p_values[1]+p_values[2];q:=public.matmove_arcade_dice_quote(r.rules,r.prediction);
  if (case r.prediction->>'comparison' when 'above' then total>(r.prediction->>'target')::integer when 'below' then total<(r.prediction->>'target')::integer else total=(r.prediction->>'target')::integer end) then prize:=(q->>'payoutMinor')::bigint;end if;
 end if;
 insert into public.matmove_arcade_outcomes(round_id,attempt_index,reel_values,prize_minor) values(p_id,p_index,p_values,prize) returning * into o;
 if prize>0 then
  insert into public.matmove_arcade_legs(round_id,attempt_index,kind,amount_minor,source_account,destination_account,request_key) values(p_id,p_index,'win',prize,r.spin_account,r.source_account,r.request_key||':win:'||p_index);
 end if;
 update public.matmove_arcade_rounds set state=case when prize>0 then 'win_pending' when p_index=attempt_count then 'completed' else 'active' end,updated_at=clock_timestamp() where id=p_id;
 return to_jsonb(o);
end;
$fn$;

create or replace function public.matmove_arcade_claim(p_id uuid,p_index integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;t public.matmove_arcade_legs%rowtype;allowed boolean:=false;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_arcade_rounds where id=p_id for update;
 select * into t from public.matmove_arcade_legs where round_id=p_id and attempt_index=p_index for update;
 if t.id is null then raise exception 'NOT_FOUND: Game payment not found.';end if;
 if t.status in ('completed','failed','review_required') then return to_jsonb(t)||jsonb_build_object('can_create',false);end if;
 if t.claimed_at is not null and t.provider_id is null then
  if t.claimed_at<clock_timestamp()-interval '90 seconds' then
   update public.matmove_arcade_legs set status='review_required',error='Missing provider response. Verify the original request key; never resend.',updated_at=clock_timestamp() where id=t.id returning * into t;
   update public.matmove_arcade_rounds set state='review_required',error=t.error,updated_at=clock_timestamp() where id=p_id;
  end if;
  return to_jsonb(t)||jsonb_build_object('can_create',false);
 end if;
 if t.claimed_at is null then
  begin perform public.matmove_arcade_customer(r.user_id,r.wallet_id,r.source_account);
  exception when others then
   update public.matmove_arcade_legs set status=case when p_index=0 then 'failed' else 'review_required' end,error='Wallet permissions changed. Contact support.',updated_at=clock_timestamp() where id=t.id returning * into t;
   update public.matmove_arcade_rounds set state=case when p_index=0 then 'failed' else 'review_required' end,error=t.error,updated_at=clock_timestamp() where id=p_id;
   return to_jsonb(t)||jsonb_build_object('can_create',false);
  end;
  update public.matmove_arcade_legs set claimed_at=clock_timestamp(),status='processing',updated_at=clock_timestamp() where id=t.id returning * into t;allowed:=true;
 end if;
 return to_jsonb(t)||jsonb_build_object('can_create',allowed);
end;
$fn$;

create or replace function public.matmove_arcade_record(p_id uuid,p_index integer,p_provider text,p_status text,p_error text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;t public.matmove_arcade_legs%rowtype;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_arcade_rounds where id=p_id for update;
 select * into t from public.matmove_arcade_legs where round_id=p_id and attempt_index=p_index for update;
 if t.id is null then raise exception 'NOT_FOUND: Payment not found.';end if;
 if t.status='completed' then return to_jsonb(r);end if;
 if p_status is null or p_status not in ('pending','processing','completed','failed','review_required') or (t.provider_id is not null and t.provider_id is distinct from p_provider) then raise exception 'CONFLICT: Invalid payment state or changed receipt.';end if;
 if t.claimed_at is null or (p_status='completed' and (p_provider is null or p_provider !~ '^trn-[A-Za-z0-9_-]+$')) then raise exception 'INVALID: Claimed payment and matched provider receipt required.';end if;
 update public.matmove_arcade_legs set provider_id=coalesce(provider_id,p_provider),status=p_status,error=left(p_error,2000),updated_at=clock_timestamp() where id=t.id;
 update public.matmove_arcade_rounds set state=case when p_status='completed' then case when p_index=attempt_count then 'completed' else 'active' end when p_status='failed' and p_index=0 then 'failed' when p_status in ('failed','review_required') then 'review_required' else case when p_index=0 then 'entry_pending' else 'win_pending' end end,error=case when p_status='completed' then null else left(p_error,2000) end,updated_at=clock_timestamp() where id=p_id returning * into r;
 return to_jsonb(r);
end;
$fn$;

create or replace function public.matmove_arcade_cancel(p_key text,p_user uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;
begin
 perform pg_advisory_xact_lock(91837451);
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_user is null then raise exception 'INVALID: Valid request key required.';end if;
 select * into r from public.matmove_arcade_rounds where request_key=p_key;
 if found then
  if r.user_id is distinct from p_user then raise exception 'FORBIDDEN: Request belongs to another player.';end if;
  return jsonb_build_object('canceled',false,'roundId',r.id);
 end if;
 insert into public.matmove_arcade_canceled_entries(request_key,user_id) values(p_key,p_user) on conflict do nothing;
 return jsonb_build_object('canceled',true);
end;
$fn$;

create or replace function public.matmove_arcade_admin_save(p_expected bigint,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare c public.matmove_arcade_configs%rowtype;
begin
 if auth.uid() is null or not public.matmove_admin_any(ARRAY['games.settings']) then raise exception 'FORBIDDEN: Game settings permission required.';end if;
 perform pg_advisory_xact_lock(91837451);
 perform public.matmove_arcade_validate(p_settings);
 select * into c from public.matmove_arcade_configs order by id desc limit 1 for update;
 if c.id is distinct from p_expected then raise exception 'CONFLICT: Settings changed. Refresh before publishing.';end if;
 insert into public.matmove_arcade_configs(settings,created_by) values(p_settings,auth.uid()) returning * into c;
 insert into public.matmove_arcade_admin_events(admin_id,action,details) values(auth.uid(),'PUBLISH_ARCADE',to_jsonb(c));
 return to_jsonb(c);
end;
$fn$;

create or replace function public.matmove_arcade_admin_receipt(p_id uuid,p_index integer,p_provider text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare r public.matmove_arcade_rounds%rowtype;t public.matmove_arcade_legs%rowtype;
begin
 if auth.uid() is null or not public.matmove_admin_any(ARRAY['games.recovery']) then raise exception 'FORBIDDEN: Game recovery permission required.';end if;
 if p_provider is null or p_provider !~ '^trn-[A-Za-z0-9_-]+$' then raise exception 'INVALID: Enter an existing Monime transfer ID.';end if;
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_arcade_rounds where id=p_id for update;
 select * into t from public.matmove_arcade_legs where round_id=p_id and attempt_index=p_index for update;
 if t.id is null or r.state='failed' or t.claimed_at is null or t.status not in ('review_required','failed','pending','processing') or (t.provider_id is not null and t.provider_id<>p_provider) then raise exception 'CONFLICT: This receipt cannot be attached or changed.';end if;
 update public.matmove_arcade_legs set provider_id=p_provider,status='processing',error=null,updated_at=clock_timestamp() where id=t.id;
 update public.matmove_arcade_rounds set state=case when p_index=0 then 'entry_pending' else 'win_pending' end,error=null,updated_at=clock_timestamp() where id=p_id;
 insert into public.matmove_arcade_admin_events(admin_id,action,details) values(auth.uid(),'ATTACH_ARCADE_RECEIPT',jsonb_build_object('roundId',p_id,'index',p_index,'providerId',p_provider));
 -- Server reconciliation must independently match amount, both accounts and metadata.
end;
$fn$;

-- Granular reports. Settings-only staff never receive another customer's data.
create or replace function public.matmove_arcade_admin_report(p_view text,p_game text default 'all',p_page integer default 1,p_player uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare permission text;rows jsonb;total bigint;offset_n integer;c jsonb;
begin
 permission:=case p_view when 'settings' then 'games.settings' when 'rounds' then 'games.overview' when 'players' then 'games.players' when 'entries' then 'games.entries' when 'winnings' then 'games.winnings' else null end;
 if permission is null or auth.uid() is null or not public.matmove_admin_any(ARRAY[permission]) then raise exception 'FORBIDDEN: This game section is not assigned to you.';end if;
 if p_game is null or p_game not in ('all','dice','fruity','crankling') or p_page is null or p_page not between 1 and 10000 then raise exception 'INVALID: Invalid report filter.';end if;
 offset_n:=(p_page-1)*25;
 if p_view='settings' then
  select to_jsonb(x) into c from public.matmove_arcade_configs x order by id desc limit 1;
  return jsonb_build_object('config',c,'asOf',clock_timestamp());
 elsif p_view='rounds' then
  select count(*) into total from public.matmove_arcade_rounds r where (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rows from (select r.id,r.game,r.user_id,r.state,r.entry_minor,r.attempt_count,r.created_at,r.expires_at,r.error,p.email as customer_email,p.full_name as customer_name,
   (select coalesce(jsonb_agg(to_jsonb(o) order by o.attempt_index),'[]'::jsonb) from public.matmove_arcade_outcomes o where o.round_id=r.id) outcomes
   from public.matmove_arcade_rounds r join public.profiles p on p.id=r.user_id where (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player) order by r.created_at desc,r.id desc limit 25 offset offset_n) x;
 elsif p_view='players' then
  select count(distinct r.user_id) into total from public.matmove_arcade_rounds r where (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rows from (select r.user_id,p.email as customer_email,p.full_name as customer_name,count(*) rounds,max(r.created_at) last_play_at,
   (select coalesce(sum(l.amount_minor),0) from public.matmove_arcade_legs l join public.matmove_arcade_rounds a on a.id=l.round_id where a.user_id=r.user_id and (p_game='all' or a.game=p_game) and l.kind='entry' and l.status='completed') entries_received_minor,
   (select coalesce(sum(l.amount_minor),0) from public.matmove_arcade_legs l join public.matmove_arcade_rounds a on a.id=l.round_id where a.user_id=r.user_id and (p_game='all' or a.game=p_game) and l.kind='win' and l.status='completed') wins_paid_minor
   from public.matmove_arcade_rounds r join public.profiles p on p.id=r.user_id where (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player) group by r.user_id,p.email,p.full_name order by max(r.created_at) desc,r.user_id limit 25 offset offset_n) x;
 else
  select count(*) into total from public.matmove_arcade_legs l join public.matmove_arcade_rounds r on r.id=l.round_id where l.kind=case when p_view='entries' then 'entry' else 'win' end and (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rows from (select l.*,r.game,r.user_id,p.email as customer_email,p.full_name as customer_name from public.matmove_arcade_legs l join public.matmove_arcade_rounds r on r.id=l.round_id join public.profiles p on p.id=r.user_id where l.kind=case when p_view='entries' then 'entry' else 'win' end and (p_game='all' or r.game=p_game) and (p_player is null or r.user_id=p_player) order by l.created_at desc,l.id desc limit 25 offset offset_n) x;
 end if;
 return jsonb_build_object('view',p_view,'game',p_game,'page',p_page,'pageSize',25,'total',total,'rows',rows,'asOf',clock_timestamp());
end;
$fn$;

-- All payment writes remain service-only. The only browser RPCs are guarded Admin operations.
do $acl$
declare t text;f record;
begin
 foreach t in array ARRAY['matmove_arcade_configs','matmove_arcade_rounds','matmove_arcade_outcomes','matmove_arcade_legs','matmove_arcade_canceled_entries','matmove_arcade_admin_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'matmove_arcade_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end;
$acl$;
grant usage,select on sequence public.matmove_arcade_configs_id_seq,public.matmove_arcade_admin_events_id_seq to service_role;
grant execute on function public.matmove_arcade_admin_save(bigint,jsonb),public.matmove_arcade_admin_receipt(uuid,integer,text),public.matmove_arcade_admin_report(text,text,integer,uuid) to authenticated;
NOTIFY pgrst, 'reload schema';
commit;
