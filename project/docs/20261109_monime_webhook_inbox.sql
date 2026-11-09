-- Durable, signature-verified Monime webhook inbox.
-- Additive only: preserves existing event records and grants.
alter table public.matmove_monime_webhook_events
  add column if not exists payload jsonb,
  add column if not exists object_id text,
  add column if not exists object_type text,
  add column if not exists event_timestamp timestamptz,
  add column if not exists signature_verified boolean not null default false;

alter table public.matmove_monime_webhook_events
  drop constraint if exists matmove_monime_webhook_events_status_check;

alter table public.matmove_monime_webhook_events
  add constraint matmove_monime_webhook_events_status_check
  check (status in ('pending', 'processing', 'processed', 'failed'));

create index if not exists matmove_monime_webhook_events_queue_idx
  on public.matmove_monime_webhook_events (received_at)
  where status in ('pending', 'failed');

-- This inbox is not readable or writable by browser clients.
alter table public.matmove_monime_webhook_events enable row level security;
revoke all on table public.matmove_monime_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.matmove_monime_webhook_events to service_role;
