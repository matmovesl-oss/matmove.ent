
begin;
alter table public.matmove_spin_configs add column if not exists six_tiers jsonb;
alter table public.matmove_spin_rounds add column if not exists game_mode text not null default 'legacy';
alter table public.matmove_spin_rounds drop constraint if exists matmove_spin_rounds_entry_minor_check;
alter table public.matmove_spin_rounds add constraint matmove_spin_rounds_entry_minor_check check(entry_minor between 100 and 1000000);
alter table public.matmove_spin_rounds drop constraint if exists matmove_spin_rounds_reserve_minor_check;
alter table public.matmove_spin_rounds add constraint matmove_spin_rounds_reserve_minor_check check(reserve_minor between 100 and 1000000);
alter table public.matmove_spin_legs drop constraint if exists matmove_spin_legs_amount_minor_check;
alter table public.matmove_spin_legs add constraint matmove_spin_legs_amount_minor_check check(amount_minor between 100 and 1000000);
alter table public.matmove_spin_legs drop constraint if exists matmove_spin_legs_check;
alter table public.matmove_spin_legs add constraint matmove_spin_legs_check check((kind='entry' and spin_index=0 and sector_index is null) or (kind='win' and spin_index between 1 and 3 and sector_index>=0));
create table if not exists public.matmove_spin_outcomes (
 round_id uuid not null references public.matmove_spin_rounds(id),
 spin_index integer not null check(spin_index in (1,2)),
 sector_index integer not null check(sector_index between 0 and 5),
 kind text not null check(kind in ('cash','again','lose')),
 amount_minor bigint not null check(amount_minor between 0 and 1000000),
 created_at timestamptz not null default now(),primary key(round_id,spin_index)
);
alter table public.matmove_spin_outcomes enable row level security;
revoke all on public.matmove_spin_outcomes from public,anon,authenticated;
grant all on public.matmove_spin_outcomes to service_role;
create or replace function public.matmove_spin_validate_six(p_tiers jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $six$
declare t jsonb;s jsonb;i integer:=0;j integer;fees bigint[]:='{}';amount bigint;
begin
 if jsonb_typeof(p_tiers) is distinct from 'array' or jsonb_array_length(p_tiers)<>3 then raise exception 'INVALID: Configure three fee choices.';end if;
 for t in select value from jsonb_array_elements(p_tiers) loop
  if t->>'id' is distinct from i::text or jsonb_typeof(t->'entryMinor') is distinct from 'number' or (t->>'entryMinor') !~ '^[0-9]+$' then raise exception 'INVALID: Invalid tier.';end if;
  amount:=(t->>'entryMinor')::bigint;
  if amount<100 or amount>1000000 or amount%100<>0 or amount=any(fees) then raise exception 'INVALID: Fees must be unique whole SLE 1 to 10000.';end if;
  fees:=array_append(fees,amount);
  if jsonb_typeof(t->'sectors') is distinct from 'array' or jsonb_array_length(t->'sectors')<>6 then raise exception 'INVALID: Six segments required.';end if;
  for j in 0..5 loop
   s:=t->'sectors'->j;
   if s->>'digit' is distinct from j::text or s->>'kind' is distinct from (case when j<4 then 'cash' when j=4 then 'again' else 'lose' end) or s->'weight' is distinct from '1'::jsonb or jsonb_typeof(s->'prizeMinor') is distinct from 'number' or s->>'prizeMinor' !~ '^[0-9]+$' then raise exception 'INVALID: Invalid segment.';end if;
   amount:=(s->>'prizeMinor')::bigint;
   if (j<4 and (amount<100 or amount>1000000 or amount%100<>0)) or (j>=4 and amount<>0) then raise exception 'INVALID: Four whole-SLE prizes and two fixed noncash outcomes required.';end if;
  end loop;
  i:=i+1;
 end loop;
end;
$six$;
create or replace function public.matmove_spin_admin_save_six(p_expected bigint,p_enabled boolean,p_tiers jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $six$
declare c public.matmove_spin_configs%rowtype;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.';end if;
 perform pg_advisory_xact_lock(91837451);
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_expected then raise exception 'CONFLICT: Settings changed. Refresh first.';end if;
 if p_enabled is null then raise exception 'INVALID: Enable setting required.';end if;
 perform public.matmove_spin_validate_six(p_tiers);
 insert into public.matmove_spin_configs(enabled,sectors,tiers,six_tiers,created_by) values(p_enabled,c.sectors,c.tiers,p_tiers,auth.uid()) returning * into c;
 insert into public.matmove_spin_admin_log(admin_id,action,details) values(auth.uid(),'publish_six',jsonb_build_object('configId',c.id,'tiers',p_tiers));
 return to_jsonb(c);
end;
$six$;
create or replace function public.matmove_spin_prepare_six(p_key text,p_user uuid,p_wallet uuid,p_config bigint,p_digit text,p_source text,p_spin text,p_balance bigint,p_observed timestamptz,p_tier integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $tier$
declare c public.matmove_spin_configs%rowtype;r public.matmove_spin_rounds%rowtype;selected jsonb;reserved bigint;profile_json jsonb;birth date;capacity bigint;
begin
 perform pg_advisory_xact_lock(91837451);
 select * into r from public.matmove_spin_rounds where request_key=p_key for update;
 if found then
  if r.user_id<>p_user or r.wallet_id<>p_wallet or r.config_id<>p_config or r.lucky_digit<>p_digit or r.source_account<>p_source or r.spin_account<>p_spin or r.entry_minor<>p_tier then raise exception 'CONFLICT: Entry request changed.'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.matmove_spin_canceled_entries where request_key=p_key) then raise exception 'CONFLICT: This unstarted entry was canceled. Start a new entry.'; end if;
 if p_tier is null or p_tier not between 100 and 1000000 or p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_source is null or p_spin is null or p_source=p_spin or p_source !~ '^fac-[A-Za-z0-9_-]+$' or p_spin !~ '^fac-[A-Za-z0-9_-]+$' then raise exception 'INVALID: Invalid tier or financial accounts.'; end if;
 if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 then raise exception 'INVALID: Refresh treasury balance.'; end if;
 select * into c from public.matmove_spin_configs order by id desc limit 1 for update;
 if c.id is distinct from p_config or not c.enabled or c.six_tiers is null then raise exception 'CONFLICT: Game paused or rules changed. Review the current prices and chances.'; end if;
 perform public.matmove_spin_validate_six(c.six_tiers);
 select value into selected from jsonb_array_elements(c.six_tiers) where value->>'entryMinor'=p_tier::text;
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
 select max((s->>'prizeMinor')::bigint) into capacity from jsonb_array_elements(selected->'sectors') s;
 if p_balance<reserved+capacity then raise exception 'CONFLICT: Insufficient unreserved Spin Account funds for this wheel maximum prize.'; end if;
 insert into public.matmove_spin_rounds(request_key,user_id,wallet_id,config_id,sectors,lucky_digit,source_account,spin_account,entry_minor,reserve_minor,game_mode)
 values(p_key,p_user,p_wallet,c.id,selected->'sectors',p_digit,p_source,p_spin,p_tier,capacity,'six_v1') returning * into r;
 insert into public.matmove_spin_legs(round_id,kind,spin_index,amount_minor,source_account,destination_account,request_key) values(r.id,'entry',0,p_tier,p_source,p_spin,p_key||':entry');
 return to_jsonb(r);
end;
$tier$;

create or replace function public.matmove_spin_draw_six(p_id uuid,p_user uuid,p_index integer,p_sector integer)
returns jsonb language plpgsql set search_path=pg_catalog,public as $six$
declare r public.matmove_spin_rounds%rowtype;o public.matmove_spin_outcomes%rowtype;s jsonb;n integer;
begin
 select * into r from public.matmove_spin_rounds where id=p_id for update;
 if not found or r.user_id is distinct from p_user or r.game_mode<>'six_v1' then raise exception 'FORBIDDEN: This game does not belong to you.';end if;
 select * into o from public.matmove_spin_outcomes where round_id=p_id and spin_index=p_index;
 if found then return to_jsonb(o);end if;
 if r.state<>'active' then raise exception 'CONFLICT: Complete this game payment first.';end if;
 if exists(select 1 from public.wallets where id=r.wallet_id and is_frozen) or exists(select 1 from public.profiles where id=p_user and is_wallet_frozen) then raise exception 'FORBIDDEN: Wallet frozen. Paid game retained.';end if;
 select count(*)+1 into n from public.matmove_spin_outcomes where round_id=p_id;
 if p_index is null or p_index<>n or p_index not in (1,2) or p_sector is null or p_sector not between 0 and 5 then raise exception 'INVALID: Invalid spin sequence.';end if;
 if p_index=2 and not exists(select 1 from public.matmove_spin_outcomes where round_id=p_id and spin_index=1 and kind='again') then raise exception 'INVALID: No bonus earned.';end if;
 s:=r.sectors->p_sector;
 if p_index=2 and s->>'kind'='again' then raise exception 'INVALID: Bonus cannot grant another bonus.';end if;
 insert into public.matmove_spin_outcomes(round_id,spin_index,sector_index,kind,amount_minor) values(p_id,p_index,p_sector,s->>'kind',(s->>'prizeMinor')::bigint) returning * into o;
 if o.kind='cash' then
  insert into public.matmove_spin_legs(round_id,kind,spin_index,sector_index,digit,amount_minor,source_account,destination_account,request_key)
  values(p_id,'win',p_index,p_sector,s->>'digit',o.amount_minor,r.spin_account,r.source_account,r.request_key||':spin:'||p_index);
  update public.matmove_spin_rounds set state='win_pending',error=null,updated_at=now() where id=p_id;
 elsif o.kind='again' then
  update public.matmove_spin_rounds set state='active',error=null,updated_at=now() where id=p_id;
 else
  update public.matmove_spin_rounds set state='completed',error=null,updated_at=now() where id=p_id;
 end if;
 return to_jsonb(o);
end;
$six$;
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
  update public.matmove_spin_rounds set state=case when p_index=3 or (r.game_mode='six_v1' and p_index>0) then 'completed' else 'active' end,error=null,updated_at=now() where id=p_id;
 elsif p_status='failed' and p_index=0 then
  update public.matmove_spin_rounds set state='failed',error=p_error,updated_at=now() where id=p_id;
 elsif p_status in ('failed','review_required') then
  update public.matmove_spin_rounds set state='review_required',error=coalesce(p_error,'Prize payment needs review.'),updated_at=now() where id=p_id;
 end if;
 select * into r from public.matmove_spin_rounds where id=p_id;
 return to_jsonb(r);
end;
$fn$;

create or replace function public.matmove_spin_block_legacy_insert()
returns trigger language plpgsql set search_path=pg_catalog,public as $six$
begin
 if exists(select 1 from public.matmove_spin_configs where id=new.config_id and six_tiers is not null) and new.game_mode<>'six_v1' then raise exception 'CONFLICT: Refresh the app for the new six-segment rules.';end if;
 if new.game_mode='legacy' and new.reserve_minor=6000 and exists(select 1 from public.matmove_spin_configs where id=new.config_id and tiers is not null) then raise exception 'CONFLICT: Refresh the app for the current game rules.';end if;
 return new;
end;
$six$;
create or replace function public.matmove_spin_admin_outcomes(p_page integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $six$
declare result jsonb;total bigint;
begin
 if not public.matmove_spin_admin_allowed() then raise exception 'FORBIDDEN: Game administrator permission required.';end if;
 if p_page is null or p_page<1 or p_page>100000 then raise exception 'INVALID: Invalid page.';end if;
 select count(*) into total from public.matmove_spin_outcomes;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into result from (
  select o.*,r.user_id,r.entry_minor,r.source_account,r.spin_account,
   coalesce(to_jsonb(p)->>'full_name',to_jsonb(p)->>'email',r.user_id::text) customer_name,
   case when o.kind='cash' then t.status else 'no_transfer' end payment_status,t.provider_id
  from public.matmove_spin_outcomes o join public.matmove_spin_rounds r on r.id=o.round_id
  left join public.profiles p on p.id=r.user_id
  left join public.matmove_spin_legs t on t.round_id=o.round_id and t.spin_index=o.spin_index
  order by o.created_at desc,o.round_id desc,o.spin_index desc limit 25 offset (p_page-1)*25
 ) q;
 return jsonb_build_object('rows',result,'total',total,'page',p_page);
end;
$six$;
revoke all on function public.matmove_spin_admin_outcomes(integer) from public,anon,authenticated;
grant execute on function public.matmove_spin_admin_outcomes(integer) to service_role,authenticated;
-- Configuration changes must create a new version so stale quotes cannot pay
-- against changed prizes. The enabled switch alone may be updated in place.
create or replace function public.matmove_spin_guard_six_config()
returns trigger language plpgsql set search_path=pg_catalog,public as $six$
begin
 if TG_OP='UPDATE' and old.six_tiers is not null and new.six_tiers is distinct from old.six_tiers then raise exception 'CONFLICT: Publish a new configuration version; do not overwrite purchased rules.';end if;
 if new.six_tiers is not null then perform public.matmove_spin_validate_six(new.six_tiers);end if;
 return new;
end;
$six$;
drop trigger if exists matmove_spin_guard_six_config on public.matmove_spin_configs;
create trigger matmove_spin_guard_six_config before insert or update on public.matmove_spin_configs for each row execute function public.matmove_spin_guard_six_config();
revoke execute on function public.matmove_spin_admin_save_tiers(bigint,boolean,jsonb) from authenticated;
revoke all on function public.matmove_spin_validate_six(jsonb) from public,anon,authenticated;
grant execute on function public.matmove_spin_validate_six(jsonb) to service_role;
revoke all on function public.matmove_spin_prepare_six(text,uuid,uuid,bigint,text,text,text,bigint,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.matmove_spin_prepare_six(text,uuid,uuid,bigint,text,text,text,bigint,timestamptz,integer) to service_role;
revoke all on function public.matmove_spin_draw_six(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.matmove_spin_draw_six(uuid,uuid,integer,integer) to service_role;
revoke all on function public.matmove_spin_admin_save_six(bigint,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_spin_admin_save_six(bigint,boolean,jsonb) to service_role,authenticated;
insert into public.matmove_spin_configs(enabled,sectors,tiers,six_tiers)
select false,sectors,tiers,'[{"id":"0","entryMinor":500,"sectors":[{"digit":"0","kind":"cash","prizeMinor":1000,"weight":1},{"digit":"1","kind":"cash","prizeMinor":2000,"weight":1},{"digit":"2","kind":"cash","prizeMinor":100,"weight":1},{"digit":"3","kind":"cash","prizeMinor":300,"weight":1},{"digit":"4","kind":"again","prizeMinor":0,"weight":1},{"digit":"5","kind":"lose","prizeMinor":0,"weight":1}]},{"id":"1","entryMinor":1000,"sectors":[{"digit":"0","kind":"cash","prizeMinor":500,"weight":1},{"digit":"1","kind":"cash","prizeMinor":2000,"weight":1},{"digit":"2","kind":"cash","prizeMinor":200,"weight":1},{"digit":"3","kind":"cash","prizeMinor":400,"weight":1},{"digit":"4","kind":"again","prizeMinor":0,"weight":1},{"digit":"5","kind":"lose","prizeMinor":0,"weight":1}]},{"id":"2","entryMinor":2000,"sectors":[{"digit":"0","kind":"cash","prizeMinor":1500,"weight":1},{"digit":"1","kind":"cash","prizeMinor":2500,"weight":1},{"digit":"2","kind":"cash","prizeMinor":300,"weight":1},{"digit":"3","kind":"cash","prizeMinor":400,"weight":1},{"digit":"4","kind":"again","prizeMinor":0,"weight":1},{"digit":"5","kind":"lose","prizeMinor":0,"weight":1}]}]'::jsonb from public.matmove_spin_configs
where not exists(select 1 from public.matmove_spin_configs where six_tiers is not null)
order by id desc limit 1;
NOTIFY pgrst, 'reload schema';
commit;
