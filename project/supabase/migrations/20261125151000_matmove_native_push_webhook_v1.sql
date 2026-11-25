begin;

-- Generate a fresh 256-bit webhook secret in Vault. The value is never returned
-- to clients and is never stored in this migration source.
do $bootstrap$
declare
  v_secret text;
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'matmove_push_webhook_secret'
  ) then
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(
      v_secret,
      'matmove_push_webhook_secret',
      'Authenticates the MatMove native push database webhook'
    );
  end if;
end;
$bootstrap$;

-- This service-only RPC lets the Edge Function validate the secret held in
-- Vault without copying it into Edge Function configuration.
create or replace function public.matmove_push_verify_webhook_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog', 'vault'
as $function$
  select p_secret is not null
    and p_secret ~ '^[0-9a-f]{64}$'
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'matmove_push_webhook_secret'
        and s.decrypted_secret = p_secret
    );
$function$;

revoke all on function public.matmove_push_verify_webhook_secret(text)
  from public, anon, authenticated, service_role;
grant execute on function public.matmove_push_verify_webhook_secret(text)
  to service_role;

-- The notification sender inserts every customer inbox row, then increments
-- recipient_count once. Dispatch only on that final update, after the inbox
-- recipients exist. pg_net queues the HTTP request asynchronously.
create or replace function private.matmove_push_notification_webhook()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog', 'private', 'vault', 'net'
as $function$
declare
  v_secret text;
begin
  select s.decrypted_secret
    into v_secret
  from vault.decrypted_secrets s
  where s.name = 'matmove_push_webhook_secret'
  limit 1;

  if v_secret is null then
    raise log 'MatMove native push webhook secret is unavailable.';
    return new;
  end if;

  perform net.http_post(
    url := 'https://jjqtpnrnfzlwhnvhbsdy.supabase.co/functions/v1/matmove-push',
    body := jsonb_build_object(
      'type', tg_op,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'record', to_jsonb(new),
      'old_record', to_jsonb(old)
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-matmove-push-secret', v_secret
    ),
    timeout_milliseconds := 1000
  );

  return new;
exception
  when others then
    -- A push outage must never roll back the Admin notification or inbox rows.
    raise log 'MatMove native push webhook enqueue failed.';
    return new;
end;
$function$;

revoke all on function private.matmove_push_notification_webhook()
  from public, anon, authenticated, service_role;

drop trigger if exists matmove_native_push_dispatch
  on public.matmove_notification_messages;

create trigger matmove_native_push_dispatch
  after update of recipient_count
  on public.matmove_notification_messages
  for each row
  when (new.recipient_count > old.recipient_count)
  execute function private.matmove_push_notification_webhook();

notify pgrst, 'reload schema';

commit;
