-- Keep the admin Monime consumer isolated from the customer app inbox.
-- Each application owns its queue and worker; event IDs cannot be claimed by
-- two independent consumers in the shared database.
create table if not exists public.matmove_admin_monime_webhook_events (
  event_id text primary key
    check (event_id ~ '^wke-[A-Za-z0-9_-]{1,120}$'),
  event_type text not null,
  object_id text not null,
  object_type text not null,
  event_timestamp timestamptz,
  payload jsonb not null,
  signature_verified boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 1
    check (attempts > 0),
  received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  last_error text
);

alter table public.matmove_admin_monime_webhook_events enable row level security;
revoke all on table public.matmove_admin_monime_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.matmove_admin_monime_webhook_events to service_role;

create index if not exists matmove_admin_monime_webhook_events_pending_idx
  on public.matmove_admin_monime_webhook_events (received_at)
  where status = 'pending';

create index if not exists matmove_admin_monime_webhook_events_stale_idx
  on public.matmove_admin_monime_webhook_events (updated_at)
  where status = 'processing';
