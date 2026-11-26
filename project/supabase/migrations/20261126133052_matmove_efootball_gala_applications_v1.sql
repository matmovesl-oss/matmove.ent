-- MatMove eFootball Gala applications.
-- The public RPC returns only season details; application data is accessible through
-- authenticated, account-bound submission and Sports-admin-only review functions.
begin;

alter table public.matmove_sports_competitions
  add column if not exists registration_opens_at timestamptz;

update public.matmove_sports_competitions
set registration_opens_at = created_at
where registration_opens_at is null;

alter table public.matmove_sports_competitions
  alter column registration_opens_at set default now(),
  alter column registration_opens_at set not null;

create table if not exists public.matmove_sports_applications (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique
    default ('GALA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  competition_id uuid not null references public.matmove_sports_competitions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  wallet_id uuid not null references public.wallets(id),
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 120),
  country text not null default 'Sierra Leone' check (country = 'Sierra Leone'),
  phone text not null check (char_length(btrim(phone)) between 7 and 30),
  whatsapp_phone text not null check (char_length(btrim(whatsapp_phone)) between 7 and 30),
  email text not null check (email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  efootball_user_id text not null check (char_length(btrim(efootball_user_id)) between 2 and 100),
  team_name text not null check (char_length(btrim(team_name)) between 2 and 100),
  terms_accepted boolean not null check (terms_accepted is true),
  rules_accepted boolean not null check (rules_accepted is true),
  terms_version text not null default 'gala-terms-v1',
  rules_version text not null default 'gala-rules-v1',
  accepted_at timestamptz not null default now(),
  source text not null check (source in ('landing_page', 'admin_manual')),
  status text not null default 'submitted'
    check (status in ('submitted', 'needs_info', 'approved', 'rejected', 'withdrawn')),
  admin_note text,
  player_id uuid references public.matmove_sports_players(id),
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, user_id),
  unique (competition_id, wallet_id)
);

create index if not exists matmove_sports_applications_competition_status_idx
  on public.matmove_sports_applications(competition_id, status, created_at);
create index if not exists matmove_sports_applications_user_idx
  on public.matmove_sports_applications(user_id, created_at desc);

alter table public.matmove_sports_applications enable row level security;
revoke all on public.matmove_sports_applications from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.matmove_sports_public_registration_info()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  c public.matmove_sports_competitions%rowtype;
  found_competition boolean := false;
  v_open boolean := false;
begin
  select * into c
  from public.matmove_sports_competitions
  order by
    case when status = 'registration' then 0 when status = 'draft' then 1 else 2 end,
    created_at desc
  limit 1;

  found_competition := found;
  if not found_competition then
    return jsonb_build_object(
      'gala_name', 'MatMove eFootball Gala',
      'competition', null,
      'registration_open', false,
      'message', 'There is no competition registration schedule yet.'
    );
  end if;

  v_open := c.status = 'registration'
    and c.registration_opens_at <= now()
    and (c.registration_closes_at is null or c.registration_closes_at > now());

  return jsonb_build_object(
    'gala_name', 'MatMove eFootball Gala',
    'competition', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'game_name', c.game_name,
      'status', c.status,
      'capacity', c.capacity,
      'registration_opens_at', c.registration_opens_at,
      'registration_closes_at', c.registration_closes_at,
      'starts_at', c.starts_at,
      'entry_fee_minor', c.entry_fee_minor,
      'prize_minor', c.prize_minor
    ),
    'registration_open', v_open,
    'message', case
      when c.status <> 'registration' then 'Registration is not open for this competition.'
      when c.registration_opens_at > now() then 'Registration has not opened yet.'
      when c.registration_closes_at is not null and c.registration_closes_at <= now() then 'Registration is closed.'
      else 'Registration is open.'
    end
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.matmove_sports_my_application(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  a public.matmove_sports_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED: Sign in to view your application.';
  end if;

  select * into a
  from public.matmove_sports_applications
  where competition_id = p_competition_id
    and user_id = auth.uid();

  if not found then
    return jsonb_build_object('application', null);
  end if;

  return jsonb_build_object('application', jsonb_build_object(
    'id', a.id,
    'reference_code', a.reference_code,
    'status', a.status,
    'admin_note', a.admin_note,
    'submitted_at', a.created_at,
    'updated_at', a.updated_at
  ));
end;
$function$;


CREATE OR REPLACE FUNCTION public.matmove_sports_submit_application(p_competition_id uuid, p_wallet_lookup text, p_legal_name text, p_phone text, p_whatsapp_phone text, p_email text, p_efootball_user_id text, p_team_name text, p_terms_accepted boolean, p_rules_accepted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_user uuid := auth.uid();
  v_wallet_id uuid;
  v_wallet_user_id uuid;
  v_wallet_frozen boolean;
  v_profile_frozen boolean;
  v_kyc text;
  v_deleted_at timestamptz;
  v_banned_until timestamptz;
  v_deletion_requested_at timestamptz;
  v_wallet_matches integer;
  v_existing public.matmove_sports_applications%rowtype;
  v_application_id uuid;
  v_reference_code text;
  v_comp public.matmove_sports_competitions%rowtype;
  v_legal_name text := btrim(coalesce(p_legal_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_whatsapp text := btrim(coalesce(p_whatsapp_phone, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_efootball_id text := btrim(coalesce(p_efootball_user_id, ''));
  v_team_name text := btrim(coalesce(p_team_name, ''));
  v_wallet_lookup text := btrim(coalesce(p_wallet_lookup, ''));
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED: Sign in to apply for the MatMove eFootball Gala.';
  end if;

  if p_terms_accepted is distinct from true or p_rules_accepted is distinct from true then
    raise exception 'CONSENT_REQUIRED: Accept the Terms & Conditions and competition rules before submitting.';
  end if;

  if char_length(v_legal_name) not between 2 and 120
     or char_length(v_phone) not between 7 and 30
     or char_length(v_whatsapp) not between 7 and 30
     or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or char_length(v_efootball_id) not between 2 and 100
     or char_length(v_team_name) not between 2 and 100
     or char_length(v_wallet_lookup) not between 4 and 200 then
    raise exception 'INVALID: Check all required registration details and try again.';
  end if;

  select p.kyc_status, p.is_wallet_frozen, p.account_deletion_requested_at,
         u.deleted_at, u.banned_until
  into v_kyc, v_profile_frozen, v_deletion_requested_at, v_deleted_at, v_banned_until
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_user;

  if not found or v_deleted_at is not null
     or (v_banned_until is not null and v_banned_until > now())
     or v_deletion_requested_at is not null then
    raise exception 'ACCOUNT_INACTIVE: An active MatMove account is required to apply.';
  end if;

  if lower(coalesce(v_kyc, 'pending')) <> 'approved' then
    raise exception 'KYC_REQUIRED: Your MatMove KYC must be approved before you apply.';
  end if;

  select count(*) into v_wallet_matches
  from public.wallets w
  where w.currency = 'SLE'
    and (w.id::text = v_wallet_lookup or w.monime_account_id = v_wallet_lookup);

  if v_wallet_matches = 0 then
    raise exception 'WALLET_NOT_FOUND: Enter a valid MatMove SLE Wallet ID.';
  elsif v_wallet_matches > 1 then
    raise exception 'WALLET_AMBIGUOUS: This Wallet ID needs Admin verification. Contact MatMove Support.';
  end if;

  select w.id, w.user_id, coalesce(w.is_frozen, false)
  into v_wallet_id, v_wallet_user_id, v_wallet_frozen
  from public.wallets w
  where w.currency = 'SLE'
    and (w.id::text = v_wallet_lookup or w.monime_account_id = v_wallet_lookup)
  limit 1;

  if v_wallet_user_id is distinct from v_user then
    raise exception 'WALLET_OWNER_MISMATCH: Use an SLE wallet linked to your signed-in MatMove account.';
  end if;

  if v_wallet_frozen or coalesce(v_profile_frozen, false) then
    raise exception 'WALLET_FROZEN: Your MatMove wallet must be active and not frozen.';
  end if;

  select * into v_comp
  from public.matmove_sports_competitions
  where id = p_competition_id
  for share;

  if not found or v_comp.status <> 'registration'
     or v_comp.registration_opens_at > now()
     or (v_comp.registration_closes_at is not null and v_comp.registration_closes_at <= now()) then
    raise exception 'REGISTRATION_CLOSED: Registration for this Gala season is not currently open.';
  end if;

  if exists (
    select 1 from public.matmove_sports_players p
    where p.competition_id = p_competition_id
      and p.user_id = v_user
      and p.status not in ('rejected', 'withdrawn')
  ) then
    raise exception 'ALREADY_REGISTERED: Your MatMove account is already on this season roster.';
  end if;

  select * into v_existing
  from public.matmove_sports_applications
  where competition_id = p_competition_id
    and user_id = v_user
  for update;

  if found then
    if v_existing.status <> 'needs_info' then
      raise exception 'APPLICATION_EXISTS: You already have an application for this season. Your reference is %.', v_existing.reference_code;
    end if;

    update public.matmove_sports_applications
    set wallet_id = v_wallet_id,
        legal_name = v_legal_name,
        country = 'Sierra Leone',
        phone = v_phone,
        whatsapp_phone = v_whatsapp,
        email = v_email,
        efootball_user_id = v_efootball_id,
        team_name = v_team_name,
        terms_accepted = true,
        rules_accepted = true,
        accepted_at = now(),
        status = 'submitted',
        admin_note = null,
        reviewed_by = null,
        reviewed_at = null,
        source = 'landing_page',
        created_by = v_user,
        updated_at = now()
    where id = v_existing.id
    returning id, reference_code into v_application_id, v_reference_code;
  else
    insert into public.matmove_sports_applications(
      competition_id, user_id, wallet_id, legal_name, country, phone, whatsapp_phone,
      email, efootball_user_id, team_name, terms_accepted, rules_accepted,
      source, status, created_by
    ) values (
      p_competition_id, v_user, v_wallet_id, v_legal_name, 'Sierra Leone', v_phone, v_whatsapp,
      v_email, v_efootball_id, v_team_name, true, true,
      'landing_page', 'submitted', v_user
    )
    returning id, reference_code into v_application_id, v_reference_code;
  end if;

  return jsonb_build_object(
    'application_id', v_application_id,
    'reference_code', v_reference_code,
    'status', 'submitted',
    'message', 'Your MatMove eFootball Gala application has been submitted for Admin review.'
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.matmove_sports_applications_admin_snapshot(p_competition_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.matmove_admin_can('sports') then
    raise exception 'FORBIDDEN: Sports administrator permission required.';
  end if;

  select jsonb_build_object(
    'applications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'reference_code', a.reference_code,
          'competition_id', a.competition_id,
          'user_id', a.user_id,
          'wallet_id', a.wallet_id,
          'legal_name', a.legal_name,
          'country', a.country,
          'phone', a.phone,
          'whatsapp_phone', a.whatsapp_phone,
          'email', a.email,
          'efootball_user_id', a.efootball_user_id,
          'team_name', a.team_name,
          'terms_accepted', a.terms_accepted,
          'rules_accepted', a.rules_accepted,
          'terms_version', a.terms_version,
          'rules_version', a.rules_version,
          'accepted_at', a.accepted_at,
          'source', a.source,
          'status', a.status,
          'admin_note', a.admin_note,
          'player_id', a.player_id,
          'created_at', a.created_at,
          'reviewed_at', a.reviewed_at,
          'competition_name', c.name,
          'kyc_status', coalesce(p.kyc_status, 'pending'),
          'wallet_frozen', (coalesce(w.is_frozen, false) or coalesce(p.is_wallet_frozen, false))
        ) order by a.created_at desc
      )
      from public.matmove_sports_applications a
      join public.matmove_sports_competitions c on c.id = a.competition_id
      join public.profiles p on p.id = a.user_id
      join public.wallets w on w.id = a.wallet_id
      where p_competition_id is null or a.competition_id = p_competition_id
    ), '[]'::jsonb),
    'stats', (
      select jsonb_build_object(
        'total', count(*),
        'submitted', count(*) filter (where status = 'submitted'),
        'needs_info', count(*) filter (where status = 'needs_info'),
        'approved', count(*) filter (where status = 'approved'),
        'rejected', count(*) filter (where status = 'rejected')
      )
      from public.matmove_sports_applications a
      where p_competition_id is null or a.competition_id = p_competition_id
    )
  ) into v_result;

  return v_result;
end;
$function$;


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
    returning id, reference_code into v_application_id, v_result;

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
        and status = 'registration'
        and registration_opens_at <= now()
        and (registration_closes_at is null or registration_closes_at > now())
    ) then
      raise exception 'LOCKED: The Gala registration review is closed because the registration window ended or the bracket started.';
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
$function$;


CREATE OR REPLACE FUNCTION public.matmove_sports_update_registration_window(p_competition_id uuid, p_opens_at timestamp with time zone, p_closes_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null or not public.matmove_admin_can('sports') then
    raise exception 'FORBIDDEN: Sports administrator permission required.';
  end if;

  if p_competition_id is null or p_opens_at is null
     or (p_closes_at is not null and p_closes_at <= p_opens_at) then
    raise exception 'INVALID: Set a valid registration opening time and a closing time after it.';
  end if;

  if exists (
    select 1 from public.matmove_sports_matches
    where competition_id = p_competition_id
  ) then
    raise exception 'LOCKED: Registration dates cannot be changed after the bracket is generated.';
  end if;

  update public.matmove_sports_competitions
  set registration_opens_at = p_opens_at,
      registration_closes_at = p_closes_at,
      updated_at = now()
  where id = p_competition_id
    and status in ('draft', 'registration');

  if not found then
    raise exception 'NOT_FOUND: Select a competition that is still accepting registration settings.';
  end if;

  insert into public.admin_audit_logs(admin_id, action, resource_type, resource_id, metadata, reason)
  values (
    auth.uid(), 'SPORTS_GALA_REGISTRATION_WINDOW', 'sports_competition', p_competition_id,
    jsonb_build_object('registration_opens_at', p_opens_at, 'registration_closes_at', p_closes_at),
    'Updated MatMove eFootball Gala registration schedule'
  );

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'registration_opens_at', p_opens_at,
    'registration_closes_at', p_closes_at
  );
end;
$function$;



revoke all on function public.matmove_sports_public_registration_info() from public;
grant execute on function public.matmove_sports_public_registration_info() to anon, authenticated;
comment on function public.matmove_sports_public_registration_info() is
  'Public safe summary of the active MatMove eFootball Gala season and registration dates; never returns applicant data.';

revoke all on function public.matmove_sports_my_application(uuid) from public, anon;
grant execute on function public.matmove_sports_my_application(uuid) to authenticated;

revoke all on function public.matmove_sports_submit_application(uuid,text,text,text,text,text,text,text,boolean,boolean) from public, anon;
grant execute on function public.matmove_sports_submit_application(uuid,text,text,text,text,text,text,text,boolean,boolean) to authenticated;

revoke all on function public.matmove_sports_applications_admin_snapshot(uuid) from public, anon;
grant execute on function public.matmove_sports_applications_admin_snapshot(uuid) to authenticated;

revoke all on function public.matmove_sports_application_admin_action(text,jsonb) from public, anon;
grant execute on function public.matmove_sports_application_admin_action(text,jsonb) to authenticated;

revoke all on function public.matmove_sports_update_registration_window(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.matmove_sports_update_registration_window(uuid,timestamptz,timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
