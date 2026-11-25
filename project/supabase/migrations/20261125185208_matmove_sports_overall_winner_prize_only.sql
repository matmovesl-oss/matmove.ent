begin;
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
    if not exists(select 1 from public.matmove_sports_competitions where id=v_comp and winner_player_id=v_player) then
      raise exception 'INVALID: Only the overall champion can receive the cash prize in this 16-player pilot.';
    end if;
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

;
commit;
