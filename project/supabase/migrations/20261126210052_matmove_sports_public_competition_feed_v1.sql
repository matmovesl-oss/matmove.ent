-- Public landing-page feed for current MatMove Sports competitions.
-- Draft, completed and cancelled competitions stay hidden from customers.
create or replace function public.matmove_sports_public_registration_info()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_competitions jsonb := '[]'::jsonb;
  v_primary jsonb;
  v_registration_open boolean := false;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'game_name', c.game_name,
        'status', c.status,
        'capacity', c.capacity,
        'registration_opens_at', c.registration_opens_at,
        'registration_closes_at', c.registration_closes_at,
        'starts_at', c.starts_at,
        'ends_at', c.ends_at,
        'entry_fee_minor', c.entry_fee_minor,
        'prize_minor', c.prize_minor,
        'registration_open',
          c.status = 'registration'
          and c.registration_opens_at <= now()
          and (c.registration_closes_at is null or c.registration_closes_at > now()),
        'message',
          case
            when c.status = 'in_progress' then 'This competition is in progress. Registration is closed.'
            when c.registration_opens_at > now() then 'Registration has not opened yet.'
            when c.registration_closes_at is not null and c.registration_closes_at <= now() then 'Registration is closed.'
            else 'Registration is open.'
          end
      )
      order by
        case when c.status = 'registration' then 0 else 1 end,
        coalesce(c.starts_at, c.registration_opens_at),
        c.created_at desc
    ),
    '[]'::jsonb
  )
  into v_competitions
  from (
    select *
    from public.matmove_sports_competitions
    where status in ('registration', 'in_progress')
    order by
      case when status = 'registration' then 0 else 1 end,
      coalesce(starts_at, registration_opens_at),
      created_at desc
    limit 20
  ) c;

  if jsonb_array_length(v_competitions) = 0 then
    return jsonb_build_object(
      'gala_name', null,
      'competition', null,
      'competitions', '[]'::jsonb,
      'registration_open', false,
      'message', 'There are no published sports competitions at the moment.'
    );
  end if;

  v_primary := v_competitions -> 0;
  v_registration_open := coalesce((v_primary ->> 'registration_open')::boolean, false);

  return jsonb_build_object(
    'gala_name', v_primary ->> 'name',
    'competition', v_primary,
    'competitions', v_competitions,
    'registration_open', v_registration_open,
    'message', coalesce(v_primary ->> 'message', 'Registration is currently closed.')
  );
end;
$function$;

revoke all on function public.matmove_sports_public_registration_info() from public;
grant execute on function public.matmove_sports_public_registration_info() to anon, authenticated;
comment on function public.matmove_sports_public_registration_info() is
  'Returns a public-safe list of published MatMove sports competitions (registration or in progress); draft, completed and cancelled competitions are hidden. No applicant/player data is returned.';

notify pgrst, 'reload schema';
