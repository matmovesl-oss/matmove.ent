
-- Run the ENTIRE file as postgres after the original SPIN_GAME_SETUP.sql.
-- Adds three-spin SLE 5 / 10 / 20 bundles. Existing paid rounds stay unchanged.
begin;
alter table public.matmove_spin_configs add column if not exists tiers jsonb;
alter table public.matmove_spin_rounds drop constraint if exists matmove_spin_rounds_entry_minor_check;
alter table public.matmove_spin_rounds drop constraint if exists matmove_spin_rounds_reserve_minor_check;
alter table public.matmove_spin_legs drop constraint if exists matmove_spin_legs_check;
alter table public.matmove_spin_rounds add constraint matmove_spin_rounds_entry_minor_check check(entry_minor in (500,1000,2000));
alter table public.matmove_spin_rounds add constraint matmove_spin_rounds_reserve_minor_check check(reserve_minor in (6000,15000));
alter table public.matmove_spin_legs add constraint matmove_spin_legs_check check(
 (kind='entry' and spin_index=0 and sector_index is null and amount_minor in (500,1000,2000)) or
 (kind='win' and spin_index between 1 and 3 and sector_index>=0 and ((amount_minor between 100 and 2000 and amount_minor%100=0) or amount_minor=5000))
);

create or replace function public.matmove_spin_validate_tiers(p_tiers jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $tier$
declare t jsonb; s jsonb; seen text[]; amounts integer[]; fees integer[]:='{}'; required integer[]; w bigint; total bigint; jackpot bigint; previous_total bigint:=null; previous_jackpot bigint:=null;
begin
 if p_tiers is null or jsonb_typeof(p_tiers)<>'array' or jsonb_array_length(p_tiers)<>3 then raise exception 'INVALID: Configure three price tiers.'; end if;
 select array_agg(n*100) into required from generate_series(1,20) n;required:=array_append(required,5000);
 for t in select value from jsonb_array_elements(p_tiers) order by (value->>'entryMinor')::integer loop
  if jsonb_typeof(t->'entryMinor') is distinct from 'number' or coalesce(t->>'entryMinor','') not in ('500','1000','2000') or (t->>'entryMinor')::integer=any(fees) or t->>'spinCount' is distinct from '3' then raise exception 'INVALID: Each SLE 5, 10 and 20 tier must buy three spins.'; end if;
  fees:=array_append(fees,(t->>'entryMinor')::integer);
  if jsonb_typeof(t->'sectors') is distinct from 'array' or jsonb_array_length(t->'sectors') not between 21 and 120 then raise exception 'INVALID: Each tier needs all 21 prize amounts.'; end if;
  seen:='{}';amounts:='{}';total:=0;jackpot:=0;
  for s in select value from jsonb_array_elements(t->'sectors') loop
   if jsonb_typeof(s->'digit') is distinct from 'string' or s->>'digit' !~ '^\d{1,3}$' or s->>'digit'=any(seen)
    or jsonb_typeof(s->'prizeMinor') is distinct from 'number' or s->>'prizeMinor' !~ '^\d+$'
    or not (s->>'prizeMinor')::integer=any(required)
    or jsonb_typeof(s->'weight') is distinct from 'number' or s->>'weight' !~ '^\d+$' then raise exception 'INVALID: Invalid wheel number, prize or probability weight.'; end if;
   w:=(s->>'weight')::bigint;
   if w not between 1 and 1000000 then raise exception 'INVALID: Probability weights must be positive integers.'; end if;
   seen:=array_append(seen,s->>'digit');amounts:=array_append(amounts,(s->>'prizeMinor')::integer);total:=total+w;
   if s->>'prizeMinor'='5000' then jackpot:=jackpot+w;end if;
  end loop;
  if total>1000000 or not required <@ amounts then raise exception 'INVALID: All prizes SLE 1–20 and SLE 50 must be possible.'; end if;
  if previous_total is not null and jackpot*previous_total<=previous_jackpot*total then raise exception 'INVALID: Higher-price tiers must have a higher SLE 50 chance.'; end if;
  previous_total:=total;previous_jackpot:=jackpot;
 end loop;
end;
$tier$;

create or replace function public.matmove_spin_admin_save_tiers(p_expected bigint,p_enabled boolean,p_tiers jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $tier$
declare c public.matmove_spin_configs%rowtype;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 perform pg_advisory_xact_lock(91837451);
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_expected then raise exception 'CONFLICT: Settings changed. Reload before publishing.'; end if;
 if p_enabled is null then raise exception 'INVALID: Enable setting required.'; end if;
 perform public.matmove_spin_validate_tiers(p_tiers);
 insert into public.matmove_spin_configs(enabled,sectors,tiers,created_by) values(p_enabled,p_tiers->0->'sectors',p_tiers,auth.uid()) returning * into c;
 insert into public.matmove_spin_admin_log(admin_id,action,details) values(auth.uid(),'PUBLISH_TIERS',to_jsonb(c));
 return to_jsonb(c);
end;
$tier$;

create or replace function public.matmove_spin_prepare_tier(p_key text,p_user uuid,p_wallet uuid,p_config bigint,p_digit text,p_source text,p_spin text,p_balance bigint,p_observed timestamptz,p_tier integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $tier$
declare c public.matmove_spin_configs%rowtype;r public.matmove_spin_rounds%rowtype;selected jsonb;reserved bigint;profile_json jsonb;birth date;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_spin_rounds where request_key=p_key for update;
 if found then
  if r.user_id<>p_user or r.wallet_id<>p_wallet or r.config_id<>p_config or r.lucky_digit<>p_digit or r.source_account<>p_source or r.spin_account<>p_spin or r.entry_minor<>p_tier then raise exception 'CONFLICT: Entry request changed.'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.matmove_spin_canceled_entries where request_key=p_key) then raise exception 'CONFLICT: This unstarted entry was canceled. Start a new entry.'; end if;
 if p_tier is null or p_tier not in (500,1000,2000) or p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_source is null or p_spin is null or p_source=p_spin or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_spin !~ '^fac-[A-Za-z0-9_-]+$' then raise exception 'INVALID: Invalid tier or financial accounts.'; end if;
 if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 then raise exception 'INVALID: Refresh treasury balance.'; end if;
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_config or not c.enabled or c.tiers is null then raise exception 'CONFLICT: Game paused or rules changed. Review the current prices and chances.'; end if;
 perform public.matmove_spin_validate_tiers(c.tiers);
 select value into selected from jsonb_array_elements(c.tiers) where value->>'entryMinor'=p_tier::text;
 if selected is null or not exists(select 1 from jsonb_array_elements(selected->'sectors') s where s->>'digit'=p_digit) then raise exception 'INVALID: Select a valid tier and number.'; end if;
 select to_jsonb(p) into profile_json from public.profiles p where id=p_user for update;
 if profile_json is null or profile_json->>'role' not in ('rider','driver','merchant') or profile_json->>'kyc_status' is distinct from 'approved' or coalesce((profile_json->>'is_wallet_frozen')::boolean,false) then raise exception 'FORBIDDEN: Customer identity verification and an unfrozen wallet are required.'; end if;
 if profile_json->>'date_of_birth' is null or profile_json->>'date_of_birth' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'FORBIDDEN: Adult date of birth required.'; end if;
 begin birth:=(profile_json->>'date_of_birth')::date;exception when others then raise exception 'FORBIDDEN: Valid adult date of birth required.';end;
 if birth>(now() at time zone 'UTC')::date-interval '18 years' then raise exception 'FORBIDDEN: This game is for adults aged 18 or older.'; end if;
 perform 1 from public.wallets where id=p_wallet and user_id=p_user and currency='SLE' and not coalesce(is_frozen,false) and coalesce(monime_account_id,metadata->>'monime_account_id')=p_source for update;
 if not found or exists(select 1 from public.wallets where user_id=p_user and coalesce(is_frozen,false)) then raise exception 'FORBIDDEN: Invalid or frozen wallet.'; end if;
 if exists(select 1 from public.matmove_spin_rounds where user_id=p_user and state not in ('completed','failed')) then raise exception 'CONFLICT: Finish your existing game first.'; end if;
 -- No separate game-access approval. Existing customer KYC, adulthood and wallet
 -- checks still apply. Prize probabilities never depend on wallet balance.
 select coalesce(sum(reserve_minor),0) into reserved from public.matmove_spin_rounds where spin_account=p_spin and (state not in ('completed','failed') or updated_at>=p_observed);
 if p_balance<reserved+15000 then raise exception 'CONFLICT: Fund the Spin Account prize reserve before accepting entries.'; end if;
 insert into public.matmove_spin_rounds(request_key,user_id,wallet_id,config_id,sectors,lucky_digit,source_account,spin_account,entry_minor,reserve_minor)
 values(p_key,p_user,p_wallet,c.id,selected->'sectors',p_digit,p_source,p_spin,p_tier,15000) returning * into r;
 insert into public.matmove_spin_legs(round_id,kind,spin_index,amount_minor,source_account,destination_account,request_key) values(r.id,'entry',0,p_tier,p_source,p_spin,p_key||':entry');
 return to_jsonb(r);
end;
$tier$;

-- Preserve original prepare RPC for legacy versions, but prevent it accepting
-- a new weighted-tier configuration with the old SLE 60 prize reserve.
create or replace function public.matmove_spin_block_legacy_insert()
returns trigger language plpgsql set search_path=pg_catalog,public as $tier$
begin
 if new.reserve_minor=6000 and exists(select 1 from public.matmove_spin_configs where id=new.config_id and tiers is not null) then raise exception 'CONFLICT: Reload the app to use the updated tier payments.';end if;
 return new;
end;
$tier$;
drop trigger if exists matmove_spin_block_legacy_insert on public.matmove_spin_rounds;
create trigger matmove_spin_block_legacy_insert before insert on public.matmove_spin_rounds for each row execute function public.matmove_spin_block_legacy_insert();

revoke all on function public.matmove_spin_validate_tiers(jsonb),public.matmove_spin_prepare_tier(text,uuid,uuid,bigint,text,text,text,bigint,timestamptz,integer),public.matmove_spin_block_legacy_insert() from public,anon,authenticated;
grant execute on function public.matmove_spin_validate_tiers(jsonb),public.matmove_spin_prepare_tier(text,uuid,uuid,bigint,text,text,text,bigint,timestamptz,integer),public.matmove_spin_block_legacy_insert() to service_role;
-- Old cached admin pages must not replace the new tier config with a legacy wheel.
revoke execute on function public.matmove_spin_admin_save(bigint,boolean,jsonb) from authenticated;
revoke all on function public.matmove_spin_admin_save_tiers(bigint,boolean,jsonb) from public,anon;
grant execute on function public.matmove_spin_admin_save_tiers(bigint,boolean,jsonb) to authenticated,service_role;

-- Default tier config is seeded once, PAUSED. Existing configurations and rounds are retained.
insert into public.matmove_spin_configs(enabled,sectors,tiers)
select false, j->0->'sectors', j from (select '[{"entryMinor":500,"spinCount":3,"sectors":[{"digit":"0","prizeMinor":100,"weight":26611},{"digit":"1","prizeMinor":200,"weight":3341},{"digit":"2","prizeMinor":300,"weight":1},{"digit":"3","prizeMinor":400,"weight":1},{"digit":"4","prizeMinor":500,"weight":1},{"digit":"5","prizeMinor":600,"weight":1},{"digit":"6","prizeMinor":700,"weight":1},{"digit":"7","prizeMinor":800,"weight":1},{"digit":"8","prizeMinor":900,"weight":1},{"digit":"9","prizeMinor":1000,"weight":1},{"digit":"10","prizeMinor":1100,"weight":1},{"digit":"11","prizeMinor":1200,"weight":1},{"digit":"12","prizeMinor":1300,"weight":1},{"digit":"13","prizeMinor":1400,"weight":1},{"digit":"14","prizeMinor":1500,"weight":1},{"digit":"15","prizeMinor":1600,"weight":1},{"digit":"16","prizeMinor":1700,"weight":1},{"digit":"17","prizeMinor":1800,"weight":1},{"digit":"18","prizeMinor":1900,"weight":1},{"digit":"19","prizeMinor":2000,"weight":1},{"digit":"20","prizeMinor":5000,"weight":30}]},{"entryMinor":1000,"spinCount":3,"sectors":[{"digit":"0","prizeMinor":100,"weight":13601},{"digit":"1","prizeMinor":200,"weight":1},{"digit":"2","prizeMinor":300,"weight":16231},{"digit":"3","prizeMinor":400,"weight":1},{"digit":"4","prizeMinor":500,"weight":1},{"digit":"5","prizeMinor":600,"weight":1},{"digit":"6","prizeMinor":700,"weight":1},{"digit":"7","prizeMinor":800,"weight":1},{"digit":"8","prizeMinor":900,"weight":1},{"digit":"9","prizeMinor":1000,"weight":1},{"digit":"10","prizeMinor":1100,"weight":1},{"digit":"11","prizeMinor":1200,"weight":1},{"digit":"12","prizeMinor":1300,"weight":1},{"digit":"13","prizeMinor":1400,"weight":1},{"digit":"14","prizeMinor":1500,"weight":1},{"digit":"15","prizeMinor":1600,"weight":1},{"digit":"16","prizeMinor":1700,"weight":1},{"digit":"17","prizeMinor":1800,"weight":1},{"digit":"18","prizeMinor":1900,"weight":1},{"digit":"19","prizeMinor":2000,"weight":1},{"digit":"20","prizeMinor":5000,"weight":150}]},{"entryMinor":2000,"spinCount":3,"sectors":[{"digit":"0","prizeMinor":100,"weight":9278},{"digit":"1","prizeMinor":200,"weight":1},{"digit":"2","prizeMinor":300,"weight":2},{"digit":"3","prizeMinor":400,"weight":1},{"digit":"4","prizeMinor":500,"weight":20103},{"digit":"5","prizeMinor":600,"weight":1},{"digit":"6","prizeMinor":700,"weight":1},{"digit":"7","prizeMinor":800,"weight":1},{"digit":"8","prizeMinor":900,"weight":1},{"digit":"9","prizeMinor":1000,"weight":1},{"digit":"10","prizeMinor":1100,"weight":1},{"digit":"11","prizeMinor":1200,"weight":1},{"digit":"12","prizeMinor":1300,"weight":1},{"digit":"13","prizeMinor":1400,"weight":1},{"digit":"14","prizeMinor":1500,"weight":1},{"digit":"15","prizeMinor":1600,"weight":1},{"digit":"16","prizeMinor":1700,"weight":1},{"digit":"17","prizeMinor":1800,"weight":1},{"digit":"18","prizeMinor":1900,"weight":1},{"digit":"19","prizeMinor":2000,"weight":1},{"digit":"20","prizeMinor":5000,"weight":600}]}]'::jsonb j) t
where not exists(select 1 from public.matmove_spin_configs where tiers is not null);

-- Also install the complete paginated report RPC, even if its earlier migration was missed.
create index if not exists matmove_spin_rounds_user_created on public.matmove_spin_rounds(user_id,created_at desc);
create index if not exists matmove_spin_legs_kind_created on public.matmove_spin_legs(kind,created_at desc,id);

create or replace function public.matmove_spin_admin_report(
 p_view text,p_page integer default 1,p_search text default '',p_status text default 'all',p_player uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $report$
declare stats jsonb; rows_json jsonb; total bigint; needle text:=lower(trim(coalesce(p_search,''))); page_size integer:=100;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.'; end if;
 if p_view is null or p_view not in ('rounds','players','entries','winnings') or p_page is null or p_page not between 1 and 1000000 or length(needle)>100 or p_status is null then raise exception 'INVALID: Invalid report request.'; end if;
 if p_view in ('entries','winnings') and p_status not in ('all','pending','processing','completed','failed','review_required') then raise exception 'INVALID: Invalid payment filter.'; end if;
 if p_view='rounds' and p_status not in ('all','entry_pending','active','win_pending','completed','failed','review_required') then raise exception 'INVALID: Invalid round filter.'; end if;
 if p_view='players' and p_status not in ('all','paid','unpaid','eligible','paused','in_progress') then raise exception 'INVALID: Invalid player filter.'; end if;

 select jsonb_build_object(
  'paidPlayers',count(distinct r.user_id) filter(where t.kind='entry' and t.status='completed'),
  'paidEntries',count(*) filter(where t.kind='entry' and t.status='completed'),
  'entryReceivedMinor',coalesce(sum(t.amount_minor) filter(where t.kind='entry' and t.status='completed'),0),
  'winsPaidMinor',coalesce(sum(t.amount_minor) filter(where t.kind='win' and t.status='completed'),0),
  'winsOwedMinor',coalesce(sum(t.amount_minor) filter(where t.kind='win' and t.status<>'completed'),0),
  'pendingEntries',count(*) filter(where t.kind='entry' and t.status in ('pending','processing')),
  'prizesCredited',count(*) filter(where t.kind='win' and t.status='completed')
 ) into stats from public.matmove_spin_legs t join public.matmove_spin_rounds r on r.id=t.round_id;
 stats:=stats||jsonb_build_object(
  'approvedPlayers',(select count(*) from public.matmove_spin_access where approved and verified_adult),
  'openPaidRounds',(select count(*) from public.matmove_spin_rounds r where r.state not in ('completed','failed') and exists(select 1 from public.matmove_spin_legs t where t.round_id=r.id and t.kind='entry' and t.status='completed')),
  'playersWithOpenPaidRounds',(select count(distinct r.user_id) from public.matmove_spin_rounds r where r.state not in ('completed','failed') and exists(select 1 from public.matmove_spin_legs t where t.round_id=r.id and t.kind='entry' and t.status='completed')),
  'reviewRounds',(select count(*) from public.matmove_spin_rounds where state='review_required'),
  'reservedMinor',coalesce((select sum(reserve_minor) from public.matmove_spin_rounds where state not in ('completed','failed')),0)
 );

 if p_view in ('entries','winnings') then
  with filtered as materialized (
   select t.*,r.user_id,r.wallet_id,r.config_id,r.state round_state,r.lucky_digit,
    coalesce(nullif(trim(to_jsonb(p)->>'full_name'),''),nullif(trim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')), ''),'MatMove customer') customer_name,
    to_jsonb(p)->>'email' customer_email,to_jsonb(p)->>'role' customer_role
   from public.matmove_spin_legs t join public.matmove_spin_rounds r on r.id=t.round_id left join public.profiles p on p.id=r.user_id
   where t.kind=case p_view when 'entries' then 'entry' else 'win' end
    and (p_status='all' or t.status=p_status)
    and (p_player is null or r.user_id=p_player)
    and (needle='' or strpos(lower(concat_ws(' ',r.user_id::text,r.id::text,t.id::text,t.provider_id,t.source_account,t.destination_account,t.request_key,t.digit,to_jsonb(p)->>'full_name',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name',to_jsonb(p)->>'email')),needle)>0)
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
    (select * from filtered order by created_at desc,id desc limit page_size offset (p_page-1)::bigint*page_size) x),'[]'::jsonb)
  into total,rows_json;
 elsif p_view='rounds' then
  with payment_totals as (
   select round_id,
    max(status) filter(where kind='entry') entry_status,
    max(provider_id) filter(where kind='entry') entry_provider_id,
    count(*) filter(where kind='win') spins_used,
    coalesce(sum(amount_minor) filter(where kind='win' and status='completed'),0) wins_paid_minor,
    coalesce(sum(amount_minor) filter(where kind='win' and status<>'completed'),0) wins_owed_minor
   from public.matmove_spin_legs group by round_id
  ),filtered as materialized (
   select r.*,t.entry_status,t.entry_provider_id,t.spins_used,t.wins_paid_minor,t.wins_owed_minor,
    coalesce(nullif(trim(to_jsonb(p)->>'full_name'),''),nullif(trim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')), ''),'MatMove customer') customer_name,
    to_jsonb(p)->>'email' customer_email,to_jsonb(p)->>'role' customer_role
   from public.matmove_spin_rounds r left join payment_totals t on t.round_id=r.id left join public.profiles p on p.id=r.user_id
   where (p_status='all' or r.state=p_status) and (p_player is null or r.user_id=p_player)
    and (needle='' or strpos(lower(concat_ws(' ',r.user_id::text,r.id::text,r.source_account,r.spin_account,t.entry_provider_id,to_jsonb(p)->>'full_name',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name',to_jsonb(p)->>'email')),needle)>0)
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
    (select * from filtered order by created_at desc,id desc limit page_size offset (p_page-1)::bigint*page_size) x),'[]'::jsonb)
  into total,rows_json;
 else
  with everyone as (
   select user_id from public.matmove_spin_access union select user_id from public.matmove_spin_rounds
  ),payment_totals as (
   select r.user_id,
    count(*) filter(where t.kind='entry' and t.status='completed') paid_entries,
    coalesce(sum(t.amount_minor) filter(where t.kind='entry' and t.status='completed'),0) entry_paid_minor,
    count(*) filter(where t.kind='win') spins_used,
    coalesce(sum(t.amount_minor) filter(where t.kind='win' and t.status='completed'),0) wins_paid_minor,
    coalesce(sum(t.amount_minor) filter(where t.kind='win' and t.status<>'completed'),0) wins_owed_minor,
    min(t.updated_at) filter(where t.kind='entry' and t.status='completed') first_paid_at,
    max(t.updated_at) last_payment_at
   from public.matmove_spin_legs t join public.matmove_spin_rounds r on r.id=t.round_id group by r.user_id
  ),round_totals as (
   select r.user_id,count(*) total_rounds,count(*) filter(where r.state='completed') completed_rounds,
    count(*) filter(where r.state not in ('completed','failed') and exists(select 1 from public.matmove_spin_legs t where t.round_id=r.id and t.kind='entry' and t.status='completed')) open_paid_rounds,
    min(r.created_at) first_entry_request_at,max(r.updated_at) last_round_at
   from public.matmove_spin_rounds r group by r.user_id
  ),players as (
   select e.user_id,coalesce(a.approved,false) approved,coalesce(a.verified_adult,false) verified_adult,a.daily_limit_minor,a.updated_at access_updated_at,
    coalesce(nullif(trim(to_jsonb(p)->>'full_name'),''),nullif(trim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')), ''),'MatMove customer') customer_name,
    to_jsonb(p)->>'email' customer_email,to_jsonb(p)->>'role' customer_role,
    coalesce(t.paid_entries,0) paid_entries,coalesce(t.entry_paid_minor,0) entry_paid_minor,coalesce(t.spins_used,0) spins_used,
    coalesce(t.wins_paid_minor,0) wins_paid_minor,coalesce(t.wins_owed_minor,0) wins_owed_minor,
    coalesce(q.total_rounds,0) total_rounds,coalesce(q.completed_rounds,0) completed_rounds,coalesce(q.open_paid_rounds,0) open_paid_rounds,
    t.first_paid_at,q.first_entry_request_at,greatest(t.last_payment_at,q.last_round_at,a.updated_at) last_activity_at,
    (select source_account from public.matmove_spin_rounds r where r.user_id=e.user_id order by created_at desc,id desc limit 1) customer_account
   from everyone e left join public.profiles p on p.id=e.user_id left join public.matmove_spin_access a on a.user_id=e.user_id
   left join payment_totals t on t.user_id=e.user_id left join round_totals q on q.user_id=e.user_id
  ),filtered as materialized (
   select * from players where (p_player is null or user_id=p_player)
    and (needle='' or strpos(lower(concat_ws(' ',user_id::text,customer_name,customer_email,customer_account)),needle)>0)
    and (p_status='all' or (p_status='paid' and paid_entries>0) or (p_status='unpaid' and paid_entries=0)
     or (p_status='eligible' and approved and verified_adult) or (p_status='paused' and not approved) or (p_status='in_progress' and open_paid_rounds>0))
  )
  select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by x.last_activity_at desc nulls last,x.user_id) from
    (select * from filtered order by last_activity_at desc nulls last,user_id limit page_size offset (p_page-1)::bigint*page_size) x),'[]'::jsonb)
  into total,rows_json;
 end if;
 return jsonb_build_object('view',p_view,'page',p_page,'pageSize',page_size,'total',total,'rows',rows_json,'stats',stats,'asOf',clock_timestamp());
end;
$report$;
revoke all on function public.matmove_spin_admin_report(text,integer,text,text,uuid) from public,anon;
grant execute on function public.matmove_spin_admin_report(text,integer,text,text,uuid) to authenticated,service_role;

NOTIFY pgrst, 'reload schema';
commit;
