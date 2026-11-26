-- Allow Sports Admin to review applications after registration closes, until the bracket begins.
begin;
CREATE OR REPLACE FUNCTION public.matmove_sports_application_admin_action(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_competition_id uuid := nullif(p_payload->>'competition_id', '')::uuid;
  v_application_id uuid := nullif(p_payload->>'application_id', '')::uuid;
  v_application public.matmove_sports_applications%rowtype;
  v_wallet_id uuid;
  v_user_id uuid;
  v_wallet_matches integer;
  v_kyc text;
  v_profile_frozen boolean;
  v_wallet_frozen boolean;
  v_deletion_requested_at timestamptz;
  v_deleted_at timestamptz;
  v_banned_until timestamptz;
  v_approved_count integer;
  v_player_id uuid;
  v_legal_name text := btrim(coalesce(p_payload->>'legal_name', ''));
  v_phone text := btrim(coalesce(p_payload->>'phone', ''));
  v_whatsapp text := btrim(coalesce(p_payload->>'whatsapp_phone', ''));
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_efootball_id text := btrim(coalesce(p_payload->>'efootball_user_id', ''));
  v_team_name text := btrim(coalesce(p_payload->>'team_name', ''));
  v_wallet_lookup text := btrim(coalesce(p_payload->>'wallet_lookup', ''));
  v_note text := left(btrim(coalesce(p_payload->>'note', '')), 500);
  v_result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.matmove_admin_can('sports') then
    raise exception 'FORBIDDEN: Sports administrator permission required.';
  end if;

  if p_action not in ('manual_submit', 'approve', 'reject', 'request_info') then
    raise exception 'INVALID: Unsupported Gala application action.';
  end if;

  if p_action = 'manual_submit' then
    if char_length(v_legal_name) not between 2 and 120
       or char_length(v_phone) not between 7 and 30
       or char_length(v_whatsapp) not between 7 and 30
       or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or char_length(v_efootball_id) not between 2 and 100
       or char_length(v_team_name) not between 2 and 100
       or char_length(v_wallet_lookup) not between 4 and 200
       or p_payload->>'terms_accepted' is distinct from 'true'
       or p_payload->>'rules_accepted' is distinct from 'true' then
      raise exception 'INVALID: Complete every required detail and confirm that the player accepted both documents.';
    end if;

    select count(*) into v_wallet_matches
    from public.wallets w
    where w.currency = 'SLE'
      and (w.id::text = v_wallet_lookup or w.monime_account_id = v_wallet_lookup);

    if v_wallet_matches = 0 then
      raise exception 'WALLET_NOT_FOUND: MatMove SLE Wallet ID was not found.';
    elsif v_wallet_matches > 1 then
      raise exception 'WALLET_AMBIGUOUS: This Wallet ID needs further verification.';
    end if;

    select w.id, w.user_id, coalesce(w.is_frozen, false),
           coalesce(p.is_wallet_frozen, false), p.kyc_status,
           p.account_deletion_requested_at, u.deleted_at, u.banned_until
    into v_wallet_id, v_user_id, v_wallet_frozen, v_profile_frozen,
         v_kyc, v_deletion_requested_at, v_deleted_at, v_banned_until
    from public.wallets w
    join public.profiles p on p.id = w.user_id
    join auth.users u on u.id = p.id
    where w.currency = 'SLE'
      and (w.id::text = v_wallet_lookup or w.monime_account_id = v_wallet_lookup)
    limit 1;

    if v_user_id is null or v_deleted_at is not null
       or (v_banned_until is not null and v_banned_until > now())
       or v_deletion_requested_at is not null then
      raise exception 'ACCOUNT_INACTIVE: The wallet must belong to an active MatMove account.';
    end if;
    if lower(coalesce(v_kyc, 'pending')) <> 'approved' then
      raise exception 'KYC_REQUIRED: The MatMove account KYC must be approved.';
    end if;
    if v_wallet_frozen or v_profile_frozen then
      raise exception 'WALLET_FROZEN: The MatMove SLE wallet must be active and not frozen.';
    end if;

    if not exists (
      select 1 from public.matmove_sports_competitions c
      where c.id = v_competition_id
        and c.status = 'registration'
        and c.registration_opens_at <= now()
        and (c.registration_closes_at is null or c.registration_closes_at > now())
    ) then
      raise exception 'REGISTRATION_CLOSED: This competition is not accepting applications.';
    end if;

    if exists (
      select 1 from public.matmove_sports_players p
      where p.competition_id = v_competition_id
        and p.user_id = v_user_id
        and p.status not in ('rejected', 'withdrawn')
    ) then
      raise exception 'ALREADY_REGISTERED: This MatMove account is already on the player roster.';
    end if;

    insert into public.matmove_sports_applications(
      competition_id, user_id, wallet_id, legal_name, country, phone,
      whatsapp_phone, email, efootball_user_id, team_name,
      terms_accepted, rules_accepted, source, status, created_by
    ) values (
      v_competition_id, v_user_id, v_wallet_id, v_legal_name, 'Sierra Leone',
      v_phone, v_whatsapp, v_email, v_efootball_id, v_team_name,
      true, true, 'admin_manual', 'submitted', auth.uid()
    )
    returning id, jsonb_build_object('reference_code', reference_code) into v_application_id, v_result;

    v_result := jsonb_build_object(
      'application_id', v_application_id,
      'reference_code', v_result->>'reference_code',
      'status', 'submitted',
      'source', 'admin_manual'
    );

  else
    select * into v_application
    from public.matmove_sports_applications
    where id = v_application_id
      and competition_id = v_competition_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: Gala application was not found.';
    end if;

    if exists (
      select 1 from public.matmove_sports_matches
      where competition_id = v_competition_id
    ) or not exists (
      select 1 from public.matmove_sports_competitions
      where id = v_competition_id
        and status in ('draft', 'registration')
    ) then
      raise exception 'LOCKED: Application review is closed because the tournament bracket has started.';
    end if;

    if p_action = 'approve' then
      if v_application.status not in ('submitted', 'needs_info') then
        raise exception 'INVALID: Only submitted applications can be approved.';
      end if;

      select w.id, w.user_id, coalesce(w.is_frozen, false),
             coalesce(p.is_wallet_frozen, false), p.kyc_status,
             p.account_deletion_requested_at, u.deleted_at, u.banned_until
      into v_wallet_id, v_user_id, v_wallet_frozen, v_profile_frozen,
           v_kyc, v_deletion_requested_at, v_deleted_at, v_banned_until
      from public.wallets w
      join public.profiles p on p.id = w.user_id
      join auth.users u on u.id = p.id
      where w.id = v_application.wallet_id
        and w.currency = 'SLE'
      for update of w;

      if v_user_id is distinct from v_application.user_id
         or v_deleted_at is not null
         or (v_banned_until is not null and v_banned_until > now())
         or v_deletion_requested_at is not null then
        raise exception 'ACCOUNT_INACTIVE: The linked MatMove account is no longer active.';
      end if;
      if lower(coalesce(v_kyc, 'pending')) <> 'approved' then
        raise exception 'KYC_REQUIRED: MatMove KYC must still be approved at the time of approval.';
      end if;
      if v_wallet_frozen or v_profile_frozen then
        raise exception 'WALLET_FROZEN: The linked MatMove SLE wallet is frozen.';
      end if;

      select count(*) into v_approved_count
      from public.matmove_sports_players p
      where p.competition_id = v_competition_id
        and p.status = 'approved'
        and p.user_id <> v_application.user_id;

      if v_approved_count >= 16 then
        raise exception 'CAPACITY_REACHED: All 16 Gala player places have been approved.';
      end if;

      insert into public.matmove_sports_players(
        competition_id, user_id, wallet_id, efootball_user_id,
        whatsapp_phone, status, created_by
      ) values (
        v_competition_id, v_application.user_id, v_application.wallet_id,
        v_application.efootball_user_id, v_application.whatsapp_phone,
        'approved', auth.uid()
      )
      on conflict (competition_id, user_id) do update
      set wallet_id = excluded.wallet_id,
          efootball_user_id = excluded.efootball_user_id,
          whatsapp_phone = excluded.whatsapp_phone,
          status = 'approved',
          admin_note = null,
          updated_at = now()
      returning id into v_player_id;

      update public.matmove_sports_applications
      set status = 'approved',
          player_id = v_player_id,
          admin_note = null,
          reviewed_by = auth.uid(),
          reviewed_at = now(),
          updated_at = now()
      where id = v_application_id;

      v_result := jsonb_build_object(
        'application_id', v_application_id,
        'player_id', v_player_id,
        'status', 'approved'
      );

    elsif p_action = 'reject' then
      if v_application.status not in ('submitted', 'needs_info') then
        raise exception 'INVALID: Only pending applications can be rejected.';
      end if;
      update public.matmove_sports_applications
      set status = 'rejected',
          admin_note = coalesce(nullif(v_note, ''), 'Application not approved. Contact MatMove for assistance.'),
          reviewed_by = auth.uid(),
          reviewed_at = now(),
          updated_at = now()
      where id = v_application_id;
      v_result := jsonb_build_object('application_id', v_application_id, 'status', 'rejected');

    elsif p_action = 'request_info' then
      if v_application.status not in ('submitted', 'needs_info') then
        raise exception 'INVALID: Only pending applications can be returned for more information.';
      end if;
      update public.matmove_sports_applications
      set status = 'needs_info',
          admin_note = coalesce(nullif(v_note, ''), 'Please update the requested information and resubmit your application.'),
          reviewed_by = auth.uid(),
          reviewed_at = now(),
          updated_at = now()
      where id = v_application_id;
      v_result := jsonb_build_object('application_id', v_application_id, 'status', 'needs_info');
    end if;
  end if;

  insert into public.admin_audit_logs(admin_id, action, resource_type, resource_id, metadata, reason)
  values (
    auth.uid(),
    'SPORTS_GALA_' || upper(p_action),
    'sports_application',
    coalesce(v_application_id, null),
    jsonb_build_object('action', p_action, 'result', v_result, 'competition_id', v_competition_id),
    nullif(v_note, '')
  );

  return v_result;
end;
$function$

notify pgrst, 'reload schema';
commit;
