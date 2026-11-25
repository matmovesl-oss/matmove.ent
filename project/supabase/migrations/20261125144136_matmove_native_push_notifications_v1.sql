begin;

-- Native push tokens are private server-side credentials for device delivery.
-- The private schema is not exposed through the Supabase Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.matmove_push_tokens (
  expo_push_token text primary key
    check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,255}\]$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);

create index if not exists matmove_push_tokens_user_id_idx
  on private.matmove_push_tokens(user_id);

alter table private.matmove_push_tokens enable row level security;
revoke all on table private.matmove_push_tokens
  from public, anon, authenticated, service_role;

create or replace function public.matmove_register_push_token(
  p_token text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_token text := btrim(p_token);
  v_platform text := lower(btrim(p_platform));
begin
  if v_user_id is null then
    raise exception 'AUTH: Sign in before enabling phone notifications.';
  end if;

  if not public.matmove_notification_customer(v_user_id) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;

  if v_platform not in ('ios', 'android')
     or v_token is null
     or length(v_token) not between 24 and 300
     or v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,255}\]$' then
    raise exception 'INVALID: The device notification token or platform is invalid.';
  end if;

  -- A physical device has one current MatMove account association.
  -- Re-signing into another valid customer account safely transfers its token.
  insert into private.matmove_push_tokens (
    expo_push_token, user_id, platform, created_at, updated_at, last_seen_at
  )
  values (v_token, v_user_id, v_platform, clock_timestamp(), clock_timestamp(), clock_timestamp())
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        updated_at = clock_timestamp(),
        last_seen_at = clock_timestamp();

  return jsonb_build_object('user_id', v_user_id, 'registered', true);
end;
$function$;

create or replace function public.matmove_unregister_push_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH: Sign in before updating phone notifications.';
  end if;

  if not public.matmove_notification_customer(v_user_id) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;

  if p_token is null
     or length(btrim(p_token)) not between 24 and 300
     or btrim(p_token) !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,255}\]$' then
    raise exception 'INVALID: The device notification token is invalid.';
  end if;

  -- Only the signed-in account can remove its own device association.
  delete from private.matmove_push_tokens
  where user_id = v_user_id
    and expo_push_token = btrim(p_token);

  return jsonb_build_object('user_id', v_user_id, 'unregistered', true);
end;
$function$;

-- This server-only RPC returns only delivery tokens and a safe navigation target.
-- It intentionally excludes notification title/body and other message content.
create or replace function public.matmove_push_dispatch_context(p_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $function$
  select jsonb_build_object(
    'message_id', m.id,
    'destination', m.destination,
    'tokens', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'token', t.expo_push_token,
          'platform', t.platform
        ) order by t.expo_push_token
      ) filter (where t.expo_push_token is not null),
      '[]'::jsonb
    )
  )
  from public.matmove_notification_messages m
  left join public.matmove_notification_inbox i
    on i.message_id = m.id
  left join private.matmove_push_tokens t
    on t.user_id = i.user_id
   and public.matmove_notification_customer(i.user_id)
  where m.id = p_message_id
    and m.deleted_at is null
  group by m.id, m.destination;
$function$;

-- Remove tokens rejected by Expo as no longer registered.
create or replace function public.matmove_push_remove_invalid_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'private'
as $function$
declare
  v_removed integer;
begin
  if p_token is null or length(btrim(p_token)) not between 24 and 300 then
    return false;
  end if;

  delete from private.matmove_push_tokens
  where expo_push_token = btrim(p_token);

  get diagnostics v_removed = row_count;
  return v_removed > 0;
end;
$function$;

revoke all on function public.matmove_register_push_token(text, text)
  from public, anon;
grant execute on function public.matmove_register_push_token(text, text)
  to authenticated;

revoke all on function public.matmove_unregister_push_token(text)
  from public, anon;
grant execute on function public.matmove_unregister_push_token(text)
  to authenticated;

revoke all on function public.matmove_push_dispatch_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.matmove_push_dispatch_context(uuid)
  to service_role;

revoke all on function public.matmove_push_remove_invalid_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.matmove_push_remove_invalid_token(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
