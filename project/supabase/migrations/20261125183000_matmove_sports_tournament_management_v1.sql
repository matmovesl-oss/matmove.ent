begin;
create table if not exists public.matmove_sports_competitions (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 3 and 120),
 game_name text not null default 'eFootball Mobile' check(length(trim(game_name)) between 2 and 80),
 format text not null default 'knockout' check(format='knockout'), capacity integer not null default 16 check(capacity=16),
 status text not null default 'draft' check(status in ('draft','registration','in_progress','completed','cancelled')),
 currency text not null default 'SLE' check(currency='SLE'), entry_fee_minor bigint check(entry_fee_minor is null or entry_fee_minor>=0),
 prize_minor bigint check(prize_minor is null or prize_minor>=0), registration_closes_at timestamptz, starts_at timestamptz, ends_at timestamptz,
 group_a_champion_player_id uuid, group_b_champion_player_id uuid, winner_player_id uuid,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.matmove_sports_players (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.matmove_sports_competitions(id) on delete cascade,
 user_id uuid not null references public.profiles(id), wallet_id uuid not null references public.wallets(id),
 efootball_user_id text not null check(length(trim(efootball_user_id)) between 2 and 100),
 whatsapp_phone text not null check(length(trim(whatsapp_phone)) between 7 and 30),
 group_key text check(group_key in ('A','B')), seed integer check(seed between 1 and 8),
 status text not null default 'pending_review' check(status in ('pending_review','approved','rejected','withdrawn')),
 admin_note text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(competition_id,user_id), unique(competition_id,wallet_id)
);
create table if not exists public.matmove_sports_rooms (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.matmove_sports_competitions(id) on delete cascade,
 room_key text not null, group_key text check(group_key in ('A','B')),
 stage text not null check(stage in ('quarter_final','semi_final','group_final','grand_final')),
 game_tournament_id text not null check(length(trim(game_tournament_id)) between 1 and 120),
 room_code text, invitation_url text, scheduled_at timestamptz,
 status text not null default 'ready' check(status in ('ready','active','completed','closed')), notes text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(competition_id,room_key), check(invitation_url is null or invitation_url ~ '^https?://')
);
create table if not exists public.matmove_sports_matches (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.matmove_sports_competitions(id) on delete cascade,
 group_key text check(group_key in ('A','B')), stage text not null check(stage in ('quarter_final','semi_final','group_final','grand_final')),
 match_number integer not null check(match_number between 1 and 4), player1_id uuid references public.matmove_sports_players(id),
 player2_id uuid references public.matmove_sports_players(id), score1 integer check(score1 between 0 and 99), score2 integer check(score2 between 0 and 99),
 penalty_score1 integer check(penalty_score1 between 0 and 30), penalty_score2 integer check(penalty_score2 between 0 and 30),
 winner_player_id uuid references public.matmove_sports_players(id),
 status text not null default 'waiting' check(status in ('waiting','scheduled','awaiting_confirmation','confirmed','disputed','forfeit')),
 screenshot_path text, result_note text, played_at timestamptz, submitted_by uuid references auth.users(id),
 confirmed_by uuid references auth.users(id), confirmed_at timestamptz, next_match_id uuid references public.matmove_sports_matches(id),
 next_slot text check(next_slot in ('player1','player2')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(player1_id is null or player2_id is null or player1_id<>player2_id),
 check((next_match_id is null and next_slot is null) or (next_match_id is not null and next_slot is not null))
);
create table if not exists public.matmove_sports_prizes (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.matmove_sports_competitions(id) on delete cascade,
 player_id uuid not null references public.matmove_sports_players(id), amount_minor bigint not null check(amount_minor>0),
 currency text not null default 'SLE' check(currency='SLE'), status text not null default 'pending' check(status in ('pending','processing','paid','failed')),
 transaction_reference text, payment_note text, paid_at timestamptz, recorded_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(competition_id,player_id), check(status<>'paid' or (transaction_reference is not null and length(trim(transaction_reference))>0 and paid_at is not null))
);
create unique index if not exists matmove_sports_matches_round_unique on public.matmove_sports_matches(competition_id,coalesce(group_key,'FINAL'),stage,match_number);
create unique index if not exists matmove_sports_players_group_seed_unique on public.matmove_sports_players(competition_id,group_key,seed) where status='approved' and group_key is not null and seed is not null;
create index if not exists matmove_sports_players_competition_idx on public.matmove_sports_players(competition_id,status,group_key,seed);
create index if not exists matmove_sports_matches_competition_idx on public.matmove_sports_matches(competition_id,stage,group_key,match_number);
alter table public.matmove_sports_competitions enable row level security;
alter table public.matmove_sports_players enable row level security;
alter table public.matmove_sports_rooms enable row level security;
alter table public.matmove_sports_matches enable row level security;
alter table public.matmove_sports_prizes enable row level security;
revoke all on public.matmove_sports_competitions,public.matmove_sports_players,public.matmove_sports_rooms,public.matmove_sports_matches,public.matmove_sports_prizes from public,anon,authenticated;
grant select on public.matmove_sports_competitions,public.matmove_sports_players,public.matmove_sports_rooms,public.matmove_sports_matches,public.matmove_sports_prizes to authenticated;
drop policy if exists matmove_sports_competitions_read on public.matmove_sports_competitions;
create policy matmove_sports_competitions_read on public.matmove_sports_competitions for select to authenticated using(public.matmove_admin_can('sports'));
drop policy if exists matmove_sports_players_read on public.matmove_sports_players;
create policy matmove_sports_players_read on public.matmove_sports_players for select to authenticated using(public.matmove_admin_can('sports'));
drop policy if exists matmove_sports_rooms_read on public.matmove_sports_rooms;
create policy matmove_sports_rooms_read on public.matmove_sports_rooms for select to authenticated using(public.matmove_admin_can('sports'));
drop policy if exists matmove_sports_matches_read on public.matmove_sports_matches;
create policy matmove_sports_matches_read on public.matmove_sports_matches for select to authenticated using(public.matmove_admin_can('sports'));
drop policy if exists matmove_sports_prizes_read on public.matmove_sports_prizes;
create policy matmove_sports_prizes_read on public.matmove_sports_prizes for select to authenticated using(public.matmove_admin_can('sports'));

CREATE OR REPLACE FUNCTION public.matmove_staff_permissions_valid(p_permissions jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case
    when jsonb_typeof(p_permissions) is distinct from 'array' then false
    else
      jsonb_array_length(p_permissions) between 1 and 28
      and not exists (
        select 1 from jsonb_array_elements(p_permissions) e
        where jsonb_typeof(e)<>'string'
          or not (e#>>'{}'=any(array[
            'dashboard','dispatch','concierge','travel.overview','travel.manifest','travel.boarding','travel.payments',
            'events.overview','events.sales','events.checkin','pricing','kyc','customers','financials','special',
            'transactions','payouts','games.overview','games.players','games.entries','games.winnings','games.settings',
            'games.recovery','notifications','support','staff','logs','sports'
          ]::text[]))
      )
      and (select count(distinct e) from jsonb_array_elements(p_permissions) e)=jsonb_array_length(p_permissions)
  end;
$function$

CREATE OR REPLACE FUNCTION public.matmove_sports_admin_snapshot(p_competition_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.matmove_admin_can('sports') then
    raise exception 'FORBIDDEN: Sports administrator permission required.';
  end if;

  select jsonb_build_object(
    'competitions',coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'player_count',(select count(*) from public.matmove_sports_players p where p.competition_id=c.id),
        'approved_count',(select count(*) from public.matmove_sports_players p where p.competition_id=c.id and p.status='approved'),
        'match_count',(select count(*) from public.matmove_sports_matches m where m.competition_id=c.id),
        'completed_match_count',(select count(*) from public.matmove_sports_matches m where m.competition_id=c.id and m.status='confirmed')
      ) order by c.created_at desc)
      from public.matmove_sports_competitions c
      where p_competition_id is null or c.id=p_competition_id
    ),'[]'::jsonb),
    'players',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',sp.id,'competition_id',sp.competition_id,'user_id',sp.user_id,'wallet_id',sp.wallet_id,
        'efootball_user_id',sp.efootball_user_id,'whatsapp_phone',sp.whatsapp_phone,'group_key',sp.group_key,
        'seed',sp.seed,'status',sp.status,'admin_note',sp.admin_note,'created_at',sp.created_at,
        'full_name',coalesce(nullif(pr.full_name,''),nullif(concat_ws(' ',pr.first_name,pr.last_name),''),pr.email,'MatMove player'),
        'phone',coalesce(pr.phone_number,pr.phone),'kyc_status',coalesce(pr.kyc_status,'pending'),
        'wallet_frozen',(coalesce(w.is_frozen,false) or coalesce(pr.is_wallet_frozen,false))
      ) order by sp.created_at)
      from public.matmove_sports_players sp
      join public.profiles pr on pr.id=sp.user_id
      join public.wallets w on w.id=sp.wallet_id
      where p_competition_id is null or sp.competition_id=p_competition_id
    ),'[]'::jsonb),
    'rooms',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.matmove_sports_rooms r
      where p_competition_id is null or r.competition_id=p_competition_id
    ),'[]'::jsonb),
    'matches',coalesce((
      select jsonb_agg(to_jsonb(m) || jsonb_build_object(
        'player1_name',(select coalesce(nullif(pr.full_name,''),concat_ws(' ',pr.first_name,pr.last_name),'Player') from public.matmove_sports_players x join public.profiles pr on pr.id=x.user_id where x.id=m.player1_id),
        'player2_name',(select coalesce(nullif(pr.full_name,''),concat_ws(' ',pr.first_name,pr.last_name),'Player') from public.matmove_sports_players x join public.profiles pr on pr.id=x.user_id where x.id=m.player2_id),
        'winner_name',(select coalesce(nullif(pr.full_name,''),concat_ws(' ',pr.first_name,pr.last_name),'Player') from public.matmove_sports_players x join public.profiles pr on pr.id=x.user_id where x.id=m.winner_player_id)
      ) order by case m.group_key when 'A' then 1 when 'B' then 2 else 3 end,m.stage,m.match_number)
      from public.matmove_sports_matches m
      where p_competition_id is null or m.competition_id=p_competition_id
    ),'[]'::jsonb),
    'prizes',coalesce((
      select jsonb_agg(to_jsonb(z) || jsonb_build_object(
        'player_name',(select coalesce(nullif(pr.full_name,''),concat_ws(' ',pr.first_name,pr.last_name),'Player') from public.matmove_sports_players x join public.profiles pr on pr.id=x.user_id where x.id=z.player_id),
        'wallet_id',(select x.wallet_id from public.matmove_sports_players x where x.id=z.player_id)
      ) order by z.created_at desc)
      from public.matmove_sports_prizes z
      where p_competition_id is null or z.competition_id=p_competition_id
    ),'[]'::jsonb),
    'stats',(
      select jsonb_build_object(
        'players',(select count(*) from public.matmove_sports_players p where p_competition_id is null or p.competition_id=p_competition_id),
        'approved_players',(select count(*) from public.matmove_sports_players p where p.status='approved' and (p_competition_id is null or p.competition_id=p_competition_id)),
        'pending_players',(select count(*) from public.matmove_sports_players p where p.status='pending_review' and (p_competition_id is null or p.competition_id=p_competition_id)),
        'matches',(select count(*) from public.matmove_sports_matches m where p_competition_id is null or m.competition_id=p_competition_id),
        'matches_completed',(select count(*) from public.matmove_sports_matches m where m.status='confirmed' and (p_competition_id is null or m.competition_id=p_competition_id)),
        'goals',(select coalesce(sum(score1+score2),0) from public.matmove_sports_matches m where m.status='confirmed' and (p_competition_id is null or m.competition_id=p_competition_id)),
        'prizes_paid_minor',(select coalesce(sum(amount_minor),0) from public.matmove_sports_prizes z where z.status='paid' and (p_competition_id is null or z.competition_id=p_competition_id))
      )
    )
  ) into v_result;
  return v_result;
end;
$function$

CREATE OR REPLACE FUNCTION public.matmove_sports_admin_action(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_comp uuid;
  v_player uuid;
  v_user uuid;
  v_wallet uuid;
  v_kyc text;
  v_frozen boolean;
  v_group text;
  v_seed integer;
  v_players uuid[];
  v_qf uuid[];
  v_sf uuid[];
  v_group_final uuid;
  v_group_final_a uuid;
  v_group_final_b uuid;
  v_grand uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match public.matmove_sports_matches%rowtype;
  v_score1 integer;
  v_score2 integer;
  v_penalty1 integer;
  v_penalty2 integer;
  v_winner uuid;
  v_result jsonb := '{}'::jsonb;
  v_room_key text;
  v_status text;
  i integer;
begin
  if auth.uid() is null or not public.matmove_admin_can('sports') then
    raise exception 'FORBIDDEN: Sports administrator permission required.';
  end if;

  if p_action not in ('create_competition','update_competition','add_player','approve_player','reject_player','assign_player','generate_bracket','record_result','confirm_result','dispute_result','save_room','save_prize') then
    raise exception 'INVALID: Unsupported Sports action.';
  end if;

  if p_payload ? 'competition_id' then v_comp := nullif(p_payload->>'competition_id','')::uuid; end if;

  if p_action='create_competition' then
    insert into public.matmove_sports_competitions(
      name,game_name,capacity,status,entry_fee_minor,prize_minor,registration_closes_at,starts_at,created_by
    ) values (
      trim(p_payload->>'name'),
      coalesce(nullif(trim(p_payload->>'game_name'),''),'eFootball Mobile'),
      16,
      coalesce(nullif(p_payload->>'status',''),'draft'),
      case when coalesce(p_payload->>'entry_fee_minor','') ~ '^[0-9]+$' then (p_payload->>'entry_fee_minor')::bigint else null end,
      case when coalesce(p_payload->>'prize_minor','') ~ '^[0-9]+$' then (p_payload->>'prize_minor')::bigint else null end,
      nullif(p_payload->>'registration_closes_at','')::timestamptz,
      nullif(p_payload->>'starts_at','')::timestamptz,
      auth.uid()
    ) returning id into v_comp;
    v_result:=jsonb_build_object('competition_id',v_comp);

  elsif p_action='update_competition' then
    update public.matmove_sports_competitions set
      name=coalesce(nullif(trim(p_payload->>'name'),''),name),
      game_name=coalesce(nullif(trim(p_payload->>'game_name'),''),game_name),
      status=coalesce(nullif(p_payload->>'status',''),status),
      entry_fee_minor=case when p_payload ? 'entry_fee_minor' then nullif(p_payload->>'entry_fee_minor','')::bigint else entry_fee_minor end,
      prize_minor=case when p_payload ? 'prize_minor' then nullif(p_payload->>'prize_minor','')::bigint else prize_minor end,
      registration_closes_at=case when p_payload ? 'registration_closes_at' then nullif(p_payload->>'registration_closes_at','')::timestamptz else registration_closes_at end,
      starts_at=case when p_payload ? 'starts_at' then nullif(p_payload->>'starts_at','')::timestamptz else starts_at end,
      updated_at=now()
    where id=v_comp;
    if not found then raise exception 'NOT_FOUND: Competition not found.'; end if;
    v_result:=jsonb_build_object('competition_id',v_comp);

  elsif p_action='add_player' then
    select w.id,w.user_id,coalesce(pr.kyc_status,'pending'),
      (coalesce(w.is_frozen,false) or coalesce(pr.is_wallet_frozen,false))
    into v_wallet,v_user,v_kyc,v_frozen
    from public.wallets w join public.profiles pr on pr.id=w.user_id
    where w.currency='SLE'
      and (w.id::text=trim(p_payload->>'wallet_lookup') or w.monime_account_id=trim(p_payload->>'wallet_lookup'))
    order by w.created_at asc limit 1;
    if not found then raise exception 'NOT_FOUND: MatMove Wallet ID was not found.'; end if;
    if v_comp is null or not exists(select 1 from public.matmove_sports_competitions c where c.id=v_comp and c.status in ('draft','registration')) then
      raise exception 'INVALID: Choose a competition that is still accepting registrations.';
    end if;
    if exists(select 1 from public.matmove_sports_players where competition_id=v_comp and user_id=v_user) then
      raise exception 'CONFLICT: This MatMove account is already registered in this competition.';
    end if;
    insert into public.matmove_sports_players(competition_id,user_id,wallet_id,efootball_user_id,whatsapp_phone,group_key,seed,status,created_by)
    values(v_comp,v_user,v_wallet,trim(p_payload->>'efootball_user_id'),trim(p_payload->>'whatsapp_phone'),
      case when p_payload->>'group_key' in ('A','B') then p_payload->>'group_key' else null end,
      case when coalesce(p_payload->>'seed','') ~ '^[1-8]$' then (p_payload->>'seed')::integer else null end,
      'pending_review',auth.uid()) returning id into v_player;
    v_result:=jsonb_build_object('player_id',v_player,'user_id',v_user,'kyc_status',v_kyc,'wallet_frozen',v_frozen);

  elsif p_action='approve_player' then
    v_player:=nullif(p_payload->>'player_id','')::uuid;
    select sp.user_id,sp.wallet_id into v_user,v_wallet from public.matmove_sports_players sp where sp.id=v_player and sp.competition_id=v_comp for update;
    if not found then raise exception 'NOT_FOUND: Player registration not found.'; end if;
    select coalesce(pr.kyc_status,'pending'),(coalesce(pr.is_wallet_frozen,false) or coalesce(w.is_frozen,false))
      into v_kyc,v_frozen from public.profiles pr join public.wallets w on w.id=v_wallet where pr.id=v_user;
    if lower(v_kyc)<>'approved' then raise exception 'INELIGIBLE: MatMove KYC must already be approved.'; end if;
    if v_frozen then raise exception 'INELIGIBLE: This MatMove wallet is frozen.'; end if;
    update public.matmove_sports_players set status='approved',updated_at=now() where id=v_player;
    v_result:=jsonb_build_object('player_id',v_player,'status','approved');

  elsif p_action='reject_player' then
    v_player:=nullif(p_payload->>'player_id','')::uuid;
    update public.matmove_sports_players set status='rejected',admin_note=left(coalesce(p_payload->>'note',''),500),updated_at=now()
    where id=v_player and competition_id=v_comp;
    if not found then raise exception 'NOT_FOUND: Player registration not found.'; end if;
    v_result:=jsonb_build_object('player_id',v_player,'status','rejected');

  elsif p_action='assign_player' then
    v_player:=nullif(p_payload->>'player_id','')::uuid;
    v_group:=p_payload->>'group_key';
    if v_group not in ('A','B') then raise exception 'INVALID: Select Group A or Group B.'; end if;
    if coalesce(p_payload->>'seed','') !~ '^[1-8]$' then raise exception 'INVALID: Select a seed from 1 to 8.'; end if;
    v_seed:=(p_payload->>'seed')::integer;
    if exists(select 1 from public.matmove_sports_players where competition_id=v_comp and status='approved' and group_key=v_group and seed=v_seed and id<>v_player) then
      raise exception 'CONFLICT: That seed is already assigned in this group.';
    end if;
    update public.matmove_sports_players set group_key=v_group,seed=v_seed,updated_at=now()
    where id=v_player and competition_id=v_comp and status='approved';
    if not found then raise exception 'NOT_FOUND: Approved player registration not found.'; end if;
    v_result:=jsonb_build_object('player_id',v_player,'group_key',v_group,'seed',v_seed);

  elsif p_action='generate_bracket' then
    if v_comp is null then raise exception 'INVALID: Select a competition.'; end if;
    if exists(select 1 from public.matmove_sports_matches where competition_id=v_comp) then raise exception 'CONFLICT: A bracket already exists for this competition.'; end if;
    for v_group in select unnest(array['A','B']) loop
      select array_agg(id order by seed,created_at,id) into v_players
      from public.matmove_sports_players where competition_id=v_comp and status='approved' and group_key=v_group;
      if coalesce(array_length(v_players,1),0)<>8 then
        raise exception 'INVALID: Each group must have exactly eight approved players assigned before generating the bracket.';
      end if;
      if exists(select 1 from public.matmove_sports_players where competition_id=v_comp and status='approved' and group_key=v_group and seed is null) then
        raise exception 'INVALID: Assign seeds 1 to 8 in both groups before generating the bracket.';
      end if;
      v_qf:=array[]::uuid[]; v_sf:=array[]::uuid[];
      for i in 1..4 loop
        if i=1 then v_p1:=v_players[1];v_p2:=v_players[8];
        elsif i=2 then v_p1:=v_players[4];v_p2:=v_players[5];
        elsif i=3 then v_p1:=v_players[2];v_p2:=v_players[7];
        else v_p1:=v_players[3];v_p2:=v_players[6]; end if;
        insert into public.matmove_sports_matches(competition_id,group_key,stage,match_number,player1_id,player2_id,status)
        values(v_comp,v_group,'quarter_final',i,v_p1,v_p2,'scheduled') returning id into v_match.id;
        v_qf:=array_append(v_qf,v_match.id);
      end loop;
      insert into public.matmove_sports_matches(competition_id,group_key,stage,match_number,status)
      values(v_comp,v_group,'semi_final',1,'waiting') returning id into v_match.id;
      v_sf:=array_append(v_sf,v_match.id);
      insert into public.matmove_sports_matches(competition_id,group_key,stage,match_number,status)
      values(v_comp,v_group,'semi_final',2,'waiting') returning id into v_match.id;
      v_sf:=array_append(v_sf,v_match.id);
      insert into public.matmove_sports_matches(competition_id,group_key,stage,match_number,status)
      values(v_comp,v_group,'group_final',1,'waiting') returning id into v_group_final;
      update public.matmove_sports_matches set next_match_id=v_sf[1],next_slot='player1' where id=v_qf[1];
      update public.matmove_sports_matches set next_match_id=v_sf[1],next_slot='player2' where id=v_qf[2];
      update public.matmove_sports_matches set next_match_id=v_sf[2],next_slot='player1' where id=v_qf[3];
      update public.matmove_sports_matches set next_match_id=v_sf[2],next_slot='player2' where id=v_qf[4];
      update public.matmove_sports_matches set next_match_id=v_group_final,next_slot='player1' where id=v_sf[1];
      update public.matmove_sports_matches set next_match_id=v_group_final,next_slot='player2' where id=v_sf[2];
      if v_group='A' then
        v_group_final_a:=v_group_final;
      else
        v_group_final_b:=v_group_final;
      end if;
    end loop;
    insert into public.matmove_sports_matches(competition_id,stage,match_number,status)
    values(v_comp,'grand_final',1,'waiting') returning id into v_grand;
    if v_group_final_a is null or v_group_final_b is null then
      raise exception 'INVALID: Both group finals must be created before the grand final.';
    end if;
    update public.matmove_sports_matches set next_match_id=v_grand,next_slot='player1' where id=v_group_final_a;
    update public.matmove_sports_matches set next_match_id=v_grand,next_slot='player2' where id=v_group_final_b;
    update public.matmove_sports_competitions set status='in_progress',updated_at=now() where id=v_comp;
    v_result:=jsonb_build_object('competition_id',v_comp,'matches_created',15,'status','in_progress');

  elsif p_action='record_result' then
    v_match.id:=nullif(p_payload->>'match_id','')::uuid;
    if coalesce(p_payload->>'score1','') !~ '^[0-9]{1,2}$' or coalesce(p_payload->>'score2','') !~ '^[0-9]{1,2}$' then
      raise exception 'INVALID: Enter a valid score for both players.';
    end if;
    v_score1:=(p_payload->>'score1')::integer; v_score2:=(p_payload->>'score2')::integer;
    v_penalty1:=case when coalesce(p_payload->>'penalty_score1','') ~ '^[0-9]{1,2}$' then (p_payload->>'penalty_score1')::integer else null end;
    v_penalty2:=case when coalesce(p_payload->>'penalty_score2','') ~ '^[0-9]{1,2}$' then (p_payload->>'penalty_score2')::integer else null end;
    update public.matmove_sports_matches set score1=v_score1,score2=v_score2,penalty_score1=v_penalty1,penalty_score2=v_penalty2,
      screenshot_path=nullif(p_payload->>'screenshot_path',''),result_note=left(coalesce(p_payload->>'result_note',''),500),
      status='awaiting_confirmation',submitted_by=auth.uid(),played_at=coalesce(nullif(p_payload->>'played_at','')::timestamptz,now()),updated_at=now()
    where id=v_match.id and competition_id=v_comp and player1_id is not null and player2_id is not null and status in ('scheduled','awaiting_confirmation','disputed');
    if not found then raise exception 'INVALID: This match is not ready for a result.'; end if;
    v_result:=jsonb_build_object('match_id',v_match.id,'status','awaiting_confirmation');

  elsif p_action='confirm_result' then
    v_match.id:=nullif(p_payload->>'match_id','')::uuid;
    select * into v_match from public.matmove_sports_matches where id=v_match.id and competition_id=v_comp for update;
    if not found or v_match.status<>'awaiting_confirmation' then raise exception 'INVALID: A submitted result is required before confirmation.'; end if;
    if v_match.score1=v_match.score2 then
      if v_match.penalty_score1 is null or v_match.penalty_score2 is null or v_match.penalty_score1=v_match.penalty_score2 then
        raise exception 'INVALID: A tied match needs a confirmed penalty shootout score before a winner can advance.';
      end if;
      v_winner:=case when v_match.penalty_score1>v_match.penalty_score2 then v_match.player1_id else v_match.player2_id end;
    else
      v_winner:=case when v_match.score1>v_match.score2 then v_match.player1_id else v_match.player2_id end;
    end if;
    update public.matmove_sports_matches set winner_player_id=v_winner,status='confirmed',confirmed_by=auth.uid(),confirmed_at=now(),updated_at=now()
    where id=v_match.id;
    if v_match.next_match_id is not null then
      if v_match.next_slot='player1' then
        update public.matmove_sports_matches set player1_id=v_winner,status=case when player2_id is not null then 'scheduled' else 'waiting' end,updated_at=now() where id=v_match.next_match_id;
      else
        update public.matmove_sports_matches set player2_id=v_winner,status=case when player1_id is not null then 'scheduled' else 'waiting' end,updated_at=now() where id=v_match.next_match_id;
      end if;
    end if;
    if v_match.stage='group_final' then
      update public.matmove_sports_competitions set
        group_a_champion_player_id=case when v_match.group_key='A' then v_winner else group_a_champion_player_id end,
        group_b_champion_player_id=case when v_match.group_key='B' then v_winner else group_b_champion_player_id end,
        updated_at=now() where id=v_comp;
    elsif v_match.stage='grand_final' then
      update public.matmove_sports_competitions set winner_player_id=v_winner,status='completed',ends_at=now(),updated_at=now() where id=v_comp;
    end if;
    v_result:=jsonb_build_object('match_id',v_match.id,'winner_player_id',v_winner,'status','confirmed');

  elsif p_action='dispute_result' then
    v_match.id:=nullif(p_payload->>'match_id','')::uuid;
    update public.matmove_sports_matches set status='disputed',result_note=left(coalesce(p_payload->>'result_note','Result disputed by administrator'),500),updated_at=now()
    where id=v_match.id and competition_id=v_comp and status='awaiting_confirmation';
    if not found then raise exception 'INVALID: Only a submitted result can be disputed.'; end if;
    v_result:=jsonb_build_object('match_id',v_match.id,'status','disputed');

  elsif p_action='save_room' then
    v_group:=nullif(p_payload->>'group_key','');
    if v_group not in ('A','B','FINAL') then raise exception 'INVALID: Choose Group A, Group B or Grand Final.'; end if;
    v_room_key:=v_group||':'||coalesce(nullif(p_payload->>'stage',''),'quarter_final');
    if coalesce(p_payload->>'stage','') not in ('quarter_final','semi_final','group_final','grand_final') then raise exception 'INVALID: Select a valid tournament stage.'; end if;
    if v_group='FINAL' and p_payload->>'stage'<>'grand_final' then raise exception 'INVALID: Grand Final room must use the grand final stage.'; end if;
    insert into public.matmove_sports_rooms(competition_id,room_key,group_key,stage,game_tournament_id,room_code,invitation_url,scheduled_at,status,notes,created_by)
    values(v_comp,v_room_key,case when v_group in ('A','B') then v_group else null end,p_payload->>'stage',
      trim(p_payload->>'game_tournament_id'),nullif(trim(p_payload->>'room_code'),''),nullif(trim(p_payload->>'invitation_url'),''),
      nullif(p_payload->>'scheduled_at','')::timestamptz,coalesce(nullif(p_payload->>'status',''),'ready'),left(coalesce(p_payload->>'notes',''),500),auth.uid())
    on conflict(competition_id,room_key) do update set game_tournament_id=excluded.game_tournament_id,room_code=excluded.room_code,
      invitation_url=excluded.invitation_url,scheduled_at=excluded.scheduled_at,status=excluded.status,notes=excluded.notes,updated_at=now();
    v_result:=jsonb_build_object('room_key',v_room_key);

  elsif p_action='save_prize' then
    v_player:=nullif(p_payload->>'player_id','')::uuid;
    if coalesce(p_payload->>'amount_minor','') !~ '^[0-9]+$' or (p_payload->>'amount_minor')::bigint<=0 then
      raise exception 'INVALID: Enter a prize amount greater than zero.';
    end if;
    v_status:=coalesce(nullif(p_payload->>'status',''),'pending');
    if v_status not in ('pending','processing','paid','failed') then raise exception 'INVALID: Invalid prize payment status.'; end if;
    if not exists(select 1 from public.matmove_sports_players where id=v_player and competition_id=v_comp) then raise exception 'NOT_FOUND: Prize recipient is not registered in this competition.'; end if;
    if v_status='paid' and length(trim(coalesce(p_payload->>'transaction_reference','')))=0 then raise exception 'INVALID: A provider transaction reference is required before marking a prize paid.'; end if;
    insert into public.matmove_sports_prizes(competition_id,player_id,amount_minor,status,transaction_reference,payment_note,paid_at,recorded_by)
    values(v_comp,v_player,(p_payload->>'amount_minor')::bigint,v_status,nullif(trim(p_payload->>'transaction_reference'),''),left(coalesce(p_payload->>'payment_note',''),500),case when v_status='paid' then now() else null end,auth.uid())
    on conflict(competition_id,player_id) do update set amount_minor=excluded.amount_minor,status=excluded.status,
      transaction_reference=excluded.transaction_reference,payment_note=excluded.payment_note,
      paid_at=case when excluded.status='paid' then coalesce(public.matmove_sports_prizes.paid_at,now()) else null end,updated_at=now();
    v_result:=jsonb_build_object('player_id',v_player,'status',v_status);
  end if;

  insert into public.admin_audit_logs(admin_id,action,resource_type,resource_id,metadata,reason)
  values(auth.uid(),'SPORTS_'||upper(p_action),'sports',v_comp,jsonb_build_object('action',p_action,'result',v_result),nullif(left(coalesce(p_payload->>'reason',''),500),''));

  return v_result;
end;
$function$


revoke all on function public.matmove_sports_admin_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.matmove_sports_admin_snapshot(uuid) to authenticated;
revoke all on function public.matmove_sports_admin_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_sports_admin_action(text,jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('matmove-sports-evidence','matmove-sports-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists matmove_sports_evidence_read on storage.objects;
create policy matmove_sports_evidence_read on storage.objects for select to authenticated using(bucket_id='matmove-sports-evidence' and public.matmove_admin_can('sports'));
drop policy if exists matmove_sports_evidence_insert on storage.objects;
create policy matmove_sports_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='matmove-sports-evidence' and public.matmove_admin_can('sports'));
commit;
