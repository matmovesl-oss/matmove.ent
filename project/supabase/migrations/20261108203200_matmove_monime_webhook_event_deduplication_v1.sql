
create table if not exists public.matmove_monime_webhook_events (
  event_id text primary key
    check (event_id ~ '^wke-[A-Za-z0-9_-]{1,120}$'),
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  attempts integer not null default 1
    check (attempts > 0),
  received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  last_error text
);

alter table public.matmove_monime_webhook_events enable row level security;
revoke all on table public.matmove_monime_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.matmove_monime_webhook_events to service_role;

create index if not exists matmove_monime_webhook_events_status_updated_idx
  on public.matmove_monime_webhook_events(status, updated_at);
