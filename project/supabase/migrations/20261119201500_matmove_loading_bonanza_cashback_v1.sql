-- MatMove Loading Bonanza: fixed 1% cashback for verified, completed SLE Monime wallet top-ups.
-- Cashback is reserved from the dedicated referral treasury and settled by the trusted Monime worker.
create table if not exists public.matmove_loading_bonanza_campaign (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  minimum_topup_minor bigint not null default 5000 check (minimum_topup_minor > 0),
  cashback_bps integer not null default 100 check (cashback_bps = 100),
  budget_minor bigint not null default 0 check (budget_minor >= 0),
  treasury_account text,
  config_revision bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.matmove_loading_bonanza_campaign(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.matmove_loading_bonanza_rewards (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null unique references public.payment_transactions(id),
  user_id uuid not null references public.profiles(id),
  wallet_id uuid not null references public.wallets(id),
  topup_minor bigint not null check (topup_minor > 0),
  cashback_minor bigint not null check (cashback_minor > 0),
  currency text not null default 'SLE' check (currency = 'SLE'),
  source_account text not null,
  destination_account text not null,
  request_key uuid not null default gen_random_uuid(),
  provider_id text unique,
  state text not null default 'pending' check (state in ('pending','processing','completed','review_required','failed','budget_exhausted')),
  reserved_at timestamptz,
  claimed_at timestamptz,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (source_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (destination_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (source_account <> destination_account)
);
create index if not exists matmove_loading_bonanza_rewards_queue_idx
  on public.matmove_loading_bonanza_rewards(state, updated_at)
  where state in ('pending','processing','review_required');

create table if not exists public.matmove_loading_bonanza_admin_events (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.matmove_loading_bonanza_campaign enable row level security;
alter table public.matmove_loading_bonanza_rewards enable row level security;
alter table public.matmove_loading_bonanza_admin_events enable row level security;
revoke all on public.matmove_loading_bonanza_campaign, public.matmove_loading_bonanza_rewards, public.matmove_loading_bonanza_admin_events from anon, authenticated;
grant select on public.matmove_loading_bonanza_campaign to service_role;
grant select, insert, update on public.matmove_loading_bonanza_rewards to service_role;
grant select, insert on public.matmove_loading_bonanza_admin_events to service_role;

create or replace function public.matmove_loading_bonanza_topup_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  c public.matmove_loading_bonanza_campaign%rowtype;
  w public.wallets%rowtype;
  v_topup_minor bigint;
  v_cashback_minor bigint;
  v_destination text;
begin
  if new.status <> 'completed' or old.status = 'completed'
     or lower(new.provider) <> 'monime'
     or lower(new.transaction_type) not in ('wallet_topup','topup')
     or upper(new.currency) <> 'SLE'
     or new.amount is null or new.amount <= 0
     or new.amount * 100 <> trunc(new.amount * 100)
     or not exists (
       select 1 from public.ledger_transactions lt
       where lt.payment_transaction_id = new.id
         and lt.transaction_type = 'wallet_topup'
         and lt.status = 'posted'
     ) then
    return new;
  end if;

  select * into c from public.matmove_loading_bonanza_campaign where singleton = true;
  if not found or not c.enabled then return new; end if;

  v_topup_minor := round(new.amount * 100)::bigint;
  if v_topup_minor < c.minimum_topup_minor then return new; end if;

  v_cashback_minor := floor((v_topup_minor::numeric * c.cashback_bps) / 10000)::bigint;
  if v_cashback_minor <= 0 then return new; end if;

  select * into w from public.wallets
  where id = new.wallet_id and user_id = new.user_id and upper(currency) = 'SLE';
  if not found or coalesce(w.is_frozen,false) then return new; end if;

  v_destination := coalesce(nullif(w.monime_account_id,''), nullif(w.metadata->>'monime_account_id',''));
  if v_destination is null or v_destination !~ '^fac-[A-Za-z0-9_-]+$'
     or c.treasury_account is null or c.treasury_account !~ '^fac-[A-Za-z0-9_-]+$'
     or c.treasury_account = v_destination then
    return new;
  end if;

  insert into public.matmove_loading_bonanza_rewards(
    payment_transaction_id,user_id,wallet_id,topup_minor,cashback_minor,
    source_account,destination_account,state
  ) values (
    new.id,new.user_id,new.wallet_id,v_topup_minor,v_cashback_minor,
    c.treasury_account,v_destination,
    case when c.budget_minor >= (
      select coalesce(sum(cashback_minor),0) + v_cashback_minor
      from public.matmove_loading_bonanza_rewards
      where reserved_at is not null
    ) then 'pending' else 'budget_exhausted' end
  ) on conflict(payment_transaction_id) do nothing;

  return new;
end
$function$;

drop trigger if exists matmove_loading_bonanza_topup_after_completed on public.payment_transactions;
create trigger matmove_loading_bonanza_topup_after_completed
after update of status on public.payment_transactions
for each row execute function public.matmove_loading_bonanza_topup_trigger();

create or replace function public.matmove_loading_bonanza_admin_overview(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare c public.matmove_loading_bonanza_campaign%rowtype; t jsonb;
begin
  if not public.matmove_report_allowed(p_actor,'financials') then
    raise exception 'FORBIDDEN: Financial assignment required.';
  end if;
  select * into c from public.matmove_loading_bonanza_campaign where singleton = true;
  select jsonb_build_object(
    'rewards',count(*)::text,
    'pendingMinor',coalesce(sum(cashback_minor) filter(where state in ('pending','processing')),0)::text,
    'completedMinor',coalesce(sum(cashback_minor) filter(where state='completed'),0)::text,
    'reviewMinor',coalesce(sum(cashback_minor) filter(where state in ('review_required','failed')),0)::text,
    'reservedMinor',coalesce(sum(cashback_minor) filter(where reserved_at is not null and state<>'completed'),0)::text
  ) into t from public.matmove_loading_bonanza_rewards;
  return jsonb_build_object(
    'actor',p_actor,
    'campaign',jsonb_build_object(
      'revision',c.config_revision::text,
      'enabled',c.enabled,
      'minimumTopupMinor',c.minimum_topup_minor::text,
      'cashbackBps',c.cashback_bps,
      'budgetMinor',c.budget_minor::text,
      'source',c.treasury_account
    ),
    'totals',t
  );
end
$function$;

create or replace function public.matmove_loading_bonanza_admin_save(
  p_actor uuid,p_request uuid,p_expected bigint,p_enabled boolean,
  p_minimum bigint,p_budget bigint,p_source text,p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare c public.matmove_loading_bonanza_campaign%rowtype; e public.matmove_loading_bonanza_admin_events%rowtype;
  payload jsonb; receipt jsonb; used bigint;
begin
  perform pg_advisory_xact_lock(87192815);
  if not exists(select 1 from public.matmove_staff_access where id=p_actor and is_active and is_owner and removed_at is null) then
    raise exception 'FORBIDDEN: Only the active owner may change Loading Bonanza settings.';
  end if;
  if p_request is null or p_expected is null or p_expected<0 or p_enabled is null
     or p_minimum is null or p_minimum<=0 or p_minimum>9000000000000000
     or p_budget is null or p_budget<0 or p_budget>9000000000000000 or (p_enabled and p_budget=0)
     or length(btrim(coalesce(p_reason,''))) not between 3 and 500
     or p_source is null or p_source !~ '^fac-[A-Za-z0-9_-]+$'
     or exists(select 1 from public.wallets where monime_account_id=p_source or metadata->>'monime_account_id'=p_source) then
    raise exception 'INVALID: Review the minimum top-up, budget, referral account and reason.';
  end if;
  payload:=jsonb_build_object('expected',p_expected,'enabled',p_enabled,'minimum',p_minimum,'budget',p_budget,'source',p_source,'reason',btrim(p_reason),'cashbackBps',100);
  select * into e from public.matmove_loading_bonanza_admin_events where id=p_request;
  if found then
    if e.actor_id<>p_actor or e.payload<>payload then raise exception 'CONFLICT: This saved Loading Bonanza request changed.'; end if;
    return e.receipt;
  end if;
  select * into c from public.matmove_loading_bonanza_campaign where singleton=true for update;
  if c.config_revision<>p_expected then raise exception 'CONFLICT: Loading Bonanza settings changed. Reload before saving.'; end if;
  if c.treasury_account is distinct from p_source and exists(select 1 from public.matmove_loading_bonanza_rewards where reserved_at is not null) then
    raise exception 'CONFLICT: Existing cashback reservations still use the current referral account.';
  end if;
  select coalesce(sum(cashback_minor),0) into used from public.matmove_loading_bonanza_rewards where reserved_at is not null;
  if p_budget<used then raise exception 'INVALID: Budget cannot be lower than already reserved cashback.'; end if;
  update public.matmove_loading_bonanza_campaign
  set enabled=p_enabled,minimum_topup_minor=p_minimum,budget_minor=p_budget,
      treasury_account=p_source,config_revision=config_revision+1,updated_at=clock_timestamp()
  where singleton=true returning * into c;
  receipt:=jsonb_build_object('actor',p_actor,'requestId',p_request,'saved',true,'revision',c.config_revision::text);
  insert into public.matmove_loading_bonanza_admin_events(id,actor_id,payload,receipt) values(p_request,p_actor,payload,receipt);
  return receipt;
end
$function$;

create or replace function public.matmove_loading_bonanza_claim(
  p_reward uuid,p_balance bigint,p_observed timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare r public.matmove_loading_bonanza_rewards%rowtype; c public.matmove_loading_bonanza_campaign%rowtype; reserved bigint;
begin
  perform pg_advisory_xact_lock(87192816);
  select * into r from public.matmove_loading_bonanza_rewards where id=p_reward for update;
  if not found then raise exception 'NOT_FOUND: Loading Bonanza reward not found.'; end if;
  if r.state in ('completed','failed','budget_exhausted') then return to_jsonb(r)||jsonb_build_object('can_create',false); end if;
  if r.provider_id is not null then return to_jsonb(r)||jsonb_build_object('can_create',false); end if;
  if r.claimed_at is not null then
    update public.matmove_loading_bonanza_rewards set state='review_required',error='Original Monime response unavailable. Attach the original receipt; never resend.',updated_at=clock_timestamp() where id=r.id returning * into r;
    return to_jsonb(r)||jsonb_build_object('can_create',false);
  end if;
  select * into c from public.matmove_loading_bonanza_campaign where singleton=true;
  if not c.enabled or c.treasury_account is distinct from r.source_account then raise exception 'PAUSED: Loading Bonanza transfers are paused.'; end if;
  if p_observed is null or p_observed<clock_timestamp()-interval '45 seconds' or p_observed>clock_timestamp()+interval '2 seconds' or p_balance is null or p_balance<0 then
    raise exception 'INVALID: Refresh the referral account balance.';
  end if;
  if r.destination_account !~ '^fac-[A-Za-z0-9_-]+$' or r.source_account=r.destination_account
     or not exists(select 1 from public.wallets where id=r.wallet_id and user_id=r.user_id
       and upper(currency)='SLE' and coalesce(nullif(monime_account_id,''),metadata->>'monime_account_id')=r.destination_account
       and not coalesce(is_frozen,false)) then
    update public.matmove_loading_bonanza_rewards set state='review_required',error='Wallet or Monime destination changed after the completed top-up.',updated_at=clock_timestamp() where id=r.id returning * into r;
    return to_jsonb(r)||jsonb_build_object('can_create',false);
  end if;
  select coalesce(sum(cashback_minor),0) into reserved from public.matmove_loading_bonanza_rewards
  where source_account=r.source_account and reserved_at is not null and (state<>'completed' or updated_at>=p_observed);
  if p_balance<reserved+r.cashback_minor then raise exception 'CAPACITY: Referral treasury funds are insufficient or reserved.'; end if;
  if c.budget_minor < (select coalesce(sum(cashback_minor),0)+r.cashback_minor from public.matmove_loading_bonanza_rewards where reserved_at is not null) then
    update public.matmove_loading_bonanza_rewards set state='budget_exhausted',error='Loading Bonanza budget is exhausted.',updated_at=clock_timestamp() where id=r.id returning * into r;
    return to_jsonb(r)||jsonb_build_object('can_create',false);
  end if;
  update public.matmove_loading_bonanza_rewards set reserved_at=clock_timestamp(),claimed_at=clock_timestamp(),state='processing',updated_at=clock_timestamp() where id=r.id returning * into r;
  return to_jsonb(r)||jsonb_build_object('can_create',true);
end
$function$;

create or replace function public.matmove_loading_bonanza_record(p_reward uuid,p_receipt jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare r public.matmove_loading_bonanza_rewards%rowtype; matches boolean; next_state text;
begin
  perform pg_advisory_xact_lock(87192816);
  select * into r from public.matmove_loading_bonanza_rewards where id=p_reward for update;
  if not found then raise exception 'NOT_FOUND: Loading Bonanza reward not found.'; end if;
  if r.claimed_at is null or r.reserved_at is null then raise exception 'CONFLICT: Cashback was not reserved before transfer.'; end if;
  matches:=coalesce(p_receipt->>'id' ~ '^trn-[A-Za-z0-9_-]+$',false)
    and (r.provider_id is null or r.provider_id=p_receipt->>'id')
    and p_receipt#>>'{amount,currency}'='SLE'
    and p_receipt#>>'{amount,value}'=r.cashback_minor::text
    and p_receipt#>>'{sourceFinancialAccount,id}'=r.source_account
    and p_receipt#>>'{destinationFinancialAccount,id}'=r.destination_account
    and p_receipt#>>'{metadata,matmoveLoadingBonanzaRewardId}'=r.id::text
    and p_receipt#>>'{metadata,matmovePaymentTransactionId}'=r.payment_transaction_id::text
    and p_receipt#>>'{metadata,matmoveRequestKey}'=r.request_key::text
    and p_receipt->>'status' in ('pending','processing','completed','failed');
  if r.state='completed' then
    if not coalesce(matches,false) then raise exception 'CONFLICT: Completed cashback receipt cannot be replaced.'; end if;
    return to_jsonb(r);
  end if;
  if r.state='failed' then return to_jsonb(r); end if;
  if not coalesce(matches,false) then
    update public.matmove_loading_bonanza_rewards set state='review_required',error='Monime receipt unavailable or does not match the exact cashback transfer. Never resend.',updated_at=clock_timestamp() where id=r.id returning * into r;
  else
    next_state:=case when p_receipt->>'status' in ('completed','failed') then p_receipt->>'status' else 'processing' end;
    update public.matmove_loading_bonanza_rewards set provider_id=p_receipt->>'id',state=next_state,
      error=case when next_state='failed' then 'Monime confirmed the original transfer failed. Review required; no automatic resend.' else null end,
      updated_at=clock_timestamp() where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
end
$function$;

revoke all on function public.matmove_loading_bonanza_topup_trigger() from public,anon,authenticated;
revoke all on function public.matmove_loading_bonanza_admin_overview(uuid) from public,anon,authenticated;
revoke all on function public.matmove_loading_bonanza_admin_save(uuid,uuid,bigint,boolean,bigint,bigint,text,text) from public,anon,authenticated;
revoke all on function public.matmove_loading_bonanza_claim(uuid,bigint,timestamptz) from public,anon,authenticated;
revoke all on function public.matmove_loading_bonanza_record(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_loading_bonanza_admin_overview(uuid) to service_role;
grant execute on function public.matmove_loading_bonanza_admin_save(uuid,uuid,bigint,boolean,bigint,bigint,text,text) to service_role;
grant execute on function public.matmove_loading_bonanza_claim(uuid,bigint,timestamptz) to service_role;
grant execute on function public.matmove_loading_bonanza_record(uuid,jsonb) to service_role;

-- Owner-authorized transfers that fund the referral treasury from the configured MatMove main account.
create table if not exists public.matmove_loading_bonanza_fundings (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  source_account text not null,
  destination_account text not null,
  request_key uuid not null unique,
  provider_id text unique,
  state text not null default 'pending' check (state in ('pending','processing','completed','review_required','failed')),
  claimed_at timestamptz,
  receipt jsonb,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (source_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (destination_account ~ '^fac-[A-Za-z0-9_-]+$'),
  check (source_account <> destination_account)
);
alter table public.matmove_loading_bonanza_fundings enable row level security;
revoke all on public.matmove_loading_bonanza_fundings from anon, authenticated;
grant select, insert, update on public.matmove_loading_bonanza_fundings to service_role;

create or replace function public.matmove_loading_bonanza_funding_claim(
  p_actor uuid,p_request uuid,p_amount bigint,p_source text,p_destination text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare f public.matmove_loading_bonanza_fundings%rowtype;
begin
  if not exists(select 1 from public.matmove_staff_access where id=p_actor and is_active and is_owner and removed_at is null) then
    raise exception 'FORBIDDEN: Only the active owner may fund the referral treasury.';
  end if;
  if p_request is null or p_amount is null or p_amount<=0 or p_amount>9000000000000000
     or p_source is null or p_source !~ '^fac-[A-Za-z0-9_-]+$'
     or p_destination is null or p_destination !~ '^fac-[A-Za-z0-9_-]+$'
     or p_source=p_destination then
    raise exception 'INVALID: Enter a valid funding amount and distinct Monime accounts.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select * into f from public.matmove_loading_bonanza_fundings where id=p_request for update;
  if found then
    if f.actor_id<>p_actor or f.amount_minor<>p_amount or f.source_account<>p_source or f.destination_account<>p_destination then
      raise exception 'CONFLICT: This funding request ID was already used for different details.';
    end if;
    if f.claimed_at is not null and f.provider_id is null and f.state='pending' then
      update public.matmove_loading_bonanza_fundings set state='review_required',error='Original Monime response unavailable. Attach the original transfer receipt; never resend.',updated_at=clock_timestamp() where id=f.id returning * into f;
    end if;
    return to_jsonb(f)||jsonb_build_object('can_create',false);
  end if;
  if exists(select 1 from public.wallets where monime_account_id=p_destination or metadata->>'monime_account_id'=p_destination) then
    raise exception 'INVALID: Referral treasury must be a separate business account, not a customer wallet.';
  end if;
  insert into public.matmove_loading_bonanza_fundings(id,actor_id,amount_minor,source_account,destination_account,request_key,claimed_at,state)
  values(p_request,p_actor,p_amount,p_source,p_destination,p_request,clock_timestamp(),'processing')
  returning * into f;
  return to_jsonb(f)||jsonb_build_object('can_create',true);
end
$function$;

create or replace function public.matmove_loading_bonanza_funding_record(
  p_actor uuid,p_request uuid,p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare f public.matmove_loading_bonanza_fundings%rowtype; matches boolean; next_state text;
begin
  if not exists(select 1 from public.matmove_staff_access where id=p_actor and is_active and is_owner and removed_at is null) then
    raise exception 'FORBIDDEN: Only the active owner may record referral treasury funding.';
  end if;
  select * into f from public.matmove_loading_bonanza_fundings where id=p_request for update;
  if not found then raise exception 'NOT_FOUND: Referral treasury funding request not found.'; end if;
  matches:=coalesce(p_receipt->>'id' ~ '^trn-[A-Za-z0-9_-]+$',false)
    and (f.provider_id is null or f.provider_id=p_receipt->>'id')
    and p_receipt#>>'{amount,currency}'='SLE'
    and p_receipt#>>'{amount,value}'=f.amount_minor::text
    and p_receipt#>>'{sourceFinancialAccount,id}'=f.source_account
    and p_receipt#>>'{destinationFinancialAccount,id}'=f.destination_account
    and p_receipt#>>'{metadata,matmoveLoadingBonanzaFundingId}'=f.id::text
    and p_receipt#>>'{metadata,matmoveRequestKey}'=f.request_key::text
    and p_receipt->>'status' in ('pending','processing','completed','failed');
  if f.state='completed' then
    if not coalesce(matches,false) then raise exception 'CONFLICT: Completed funding receipt cannot be replaced.'; end if;
    return to_jsonb(f);
  end if;
  if f.state in ('failed','review_required') then return to_jsonb(f); end if;
  if not coalesce(matches,false) then
    update public.matmove_loading_bonanza_fundings set state='review_required',error='Monime receipt unavailable or does not match the exact funding transfer. Never resend.',updated_at=clock_timestamp() where id=f.id returning * into f;
  else
    next_state:=case when p_receipt->>'status' in ('completed','failed') then p_receipt->>'status' else 'processing' end;
    update public.matmove_loading_bonanza_fundings set provider_id=p_receipt->>'id',state=next_state,receipt=p_receipt,
      error=case when next_state='failed' then 'Monime confirmed the original funding transfer failed.' else null end,
      updated_at=clock_timestamp() where id=f.id returning * into f;
  end if;
  return to_jsonb(f);
end
$function$;

revoke all on function public.matmove_loading_bonanza_funding_claim(uuid,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.matmove_loading_bonanza_funding_record(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_loading_bonanza_funding_claim(uuid,uuid,bigint,text,text) to service_role;
grant execute on function public.matmove_loading_bonanza_funding_record(uuid,uuid,jsonb) to service_role;
