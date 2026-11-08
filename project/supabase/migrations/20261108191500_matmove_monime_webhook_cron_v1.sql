-- Schedule the protected Monime event worker using Supabase Cron.
-- The cron job is safe to install before Vault values are configured: it makes
-- no network request until both secrets exist. Values never live in migrations.
-- Vault secret names required:
--   matmove_vercel_base_url  (e.g. https://matmoveent.vercel.app)
--   matmove_vercel_cron_secret (same value as Vercel CRON_SECRET)
select cron.schedule(
  'matmove-monime-webhook-worker-v1',
  '* * * * *',
  $job$
    with config as (
      select
        max(decrypted_secret) filter (
          where name = 'matmove_vercel_base_url'
        ) as base_url,
        max(decrypted_secret) filter (
          where name = 'matmove_vercel_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets
      where name in (
        'matmove_vercel_base_url',
        'matmove_vercel_cron_secret'
      )
    )
    select case
      when base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
       and cron_secret is not null
       and length(cron_secret) >= 32
      then net.http_post(
        url := base_url || '/api/create-monime-payout?action=monime_webhooks',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || cron_secret
        ),
        body := jsonb_build_object('source','supabase_cron'),
        timeout_milliseconds := 8000
      )
      else null
    end
    from config;
  $job$
);
