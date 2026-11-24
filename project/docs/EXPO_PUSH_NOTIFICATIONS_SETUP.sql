-- MatMove Expo push delivery setup.
-- This is a reviewed setup script, not an automatically applied production migration.
-- Run only after the native app branch and the Edge Function are reviewed together.

create table if not exists public.matmove_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint matmove_push_tokens_token_unique unique (expo_push_token),
  constraint matmove_push_tokens_token_format check (
    length(expo_push_token) between 20 and 512
    and expo_push_token ~ '^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$'
  )
);

alter table public.matmove_push_tokens enable row level security;
revoke all on table public.matmove_push_tokens from public, anon, authenticated;

create index if not exists matmove_push_tokens_user_active_idx
  on public.matmove_push_tokens (user_id, last_seen_at desc)
  where disabled_at is null;

create or replace function public.matmove_register_push_token(
  p_token text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH: Sign in before enabling phone notifications.';
  end if;
  if not public.matmove_notification_customer(v_user) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android')
     or p_token is null
     or length(p_token) not between 20 and 512
     or p_token !~ '^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$' then
    raise exception 'INVALID: MatMove received an invalid device notification token.';
  end if;

  insert into public.matmove_push_tokens (
    user_id, expo_push_token, platform, last_seen_at, updated_at, disabled_at
  )
  values (v_user, p_token, p_platform, clock_timestamp(), clock_timestamp(), null)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = clock_timestamp(),
        updated_at = clock_timestamp(),
        disabled_at = null
  returning id into v_id;

  return jsonb_build_object(
    'user_id', v_user,
    'token_id', v_id,
    'platform', p_platform,
    'registered', true
  );
end;
$function$;

create or replace function public.matmove_unregister_push_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH: Sign in before changing phone notifications.';
  end if;
  if not public.matmove_notification_customer(v_user) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;
  if p_token is null or length(p_token) not between 20 and 512
     or p_token !~ '^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$' then
    raise exception 'INVALID: MatMove received an invalid device notification token.';
  end if;

  update public.matmove_push_tokens
     set disabled_at = coalesce(disabled_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where user_id = v_user and expo_push_token = p_token;

  return jsonb_build_object(
    'user_id', v_user,
    'unregistered', true
  );
end;
$function$;

revoke all on function public.matmove_register_push_token(text, text) from public, anon;
revoke all on function public.matmove_unregister_push_token(text) from public, anon;
grant execute on function public.matmove_register_push_token(text, text) to authenticated;
grant execute on function public.matmove_unregister_push_token(text) to authenticated;
