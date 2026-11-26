-- Expose a server-verified account activity flag to Sports Admin.
-- Approval still independently rechecks Auth account state, KYC and wallet status.
begin;
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
          'account_active', (u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()) and p.account_deletion_requested_at is null),
          'wallet_frozen', (coalesce(w.is_frozen, false) or coalesce(p.is_wallet_frozen, false))
        ) order by a.created_at desc
      )
      from public.matmove_sports_applications a
      join public.matmove_sports_competitions c on c.id = a.competition_id
      join public.profiles p on p.id = a.user_id
      join auth.users u on u.id = a.user_id
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
$function$

notify pgrst, 'reload schema';
commit;
