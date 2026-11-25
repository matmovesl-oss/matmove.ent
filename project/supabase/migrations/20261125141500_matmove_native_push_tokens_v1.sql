begin;

-- Native Expo push addresses are private server-side routing data.
-- Customers may register/unregister only the token presented by their authenticated app.
create table if not exists public.matmove_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique
    check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$'),
  platform text not null check (platform in ('ios','android')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);

create index if not exists matmove_push_tokens_owner_last_seen
  on public.matmove_push_tokens(user_id, last_seen_at desc);

alter table public.matmove_push_tokens enable row level security;
revoke all on public.matmove_push_tokens from public, anon, authenticated;
grant select, delete on public.matmove_push_tokens to service_role;

create or replace function public.matmove_register_push_token(
  p_token text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
  saved_id uuid;
begin
  if actor is null then
    raise exception 'AUTH: Sign in before enabling phone notifications.';
  end if;

  perform public.matmove_preferences_role(actor);
  if not public.matmove_notification_customer(actor) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;

  if p_token is null
    or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$'
    or p_platform is null
    or p_platform not in ('ios','android') then
    raise exception 'INVALID: The device notification details are invalid.';
  end if;

  insert into public.matmove_push_tokens(user_id,expo_push_token,platform)
  values(actor,p_token,p_platform)
  on conflict (expo_push_token) do update
    set platform=excluded.platform,
        updated_at=clock_timestamp(),
        last_seen_at=clock_timestamp()
    where public.matmove_push_tokens.user_id=excluded.user_id
  returning id into saved_id;

  if saved_id is null then
    raise exception 'CONFLICT: This device token is already linked to another MatMove account. Sign out of that account on this device first.';
  end if;

  return jsonb_build_object(
    'user_id',actor,
    'registered',true,
    'platform',p_platform
  );
end;
$function$;

create or replace function public.matmove_unregister_push_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'AUTH: Sign in before updating phone notifications.';
  end if;

  if p_token is null
    or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$' then
    raise exception 'INVALID: The device notification token is invalid.';
  end if;

  delete from public.matmove_push_tokens
  where user_id=actor and expo_push_token=p_token;

  return jsonb_build_object('user_id',actor,'unregistered',true);
end;
$function$;

revoke all on function public.matmove_register_push_token(text,text) from public,anon,authenticated;
revoke all on function public.matmove_unregister_push_token(text) from public,anon,authenticated;
grant execute on function public.matmove_register_push_token(text,text) to authenticated;
grant execute on function public.matmove_unregister_push_token(text) to authenticated;

comment on table public.matmove_push_tokens is
  'Private Expo push-token routing records. No direct client access; managed only by authenticated owner-bound RPCs and service_role delivery code.';

notify pgrst,'reload schema';
commit;
