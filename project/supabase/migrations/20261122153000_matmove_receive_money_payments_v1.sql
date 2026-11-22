begin;

create table if not exists public.matmove_receive_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  financial_account_id text not null,
  payment_target_ref text not null,
  public_slug text not null unique,
  recipient_code text not null unique,
  public_name text not null,
  enabled boolean not null default true,
  sms_receipts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matmove_receive_links_slug_check check (public_slug ~ '^[A-Za-z0-9_-]{24,64}$'),
  constraint matmove_receive_links_code_check check (recipient_code ~ '^MM-[A-Z2-9]{8}$'),
  constraint matmove_receive_links_account_check check (financial_account_id ~ '^fac-[A-Za-z0-9_-]+$'),
  constraint matmove_receive_links_target_check check (payment_target_ref ~ '^[0-9]{6,20}$'),
  constraint matmove_receive_links_name_check check (length(trim(public_name)) between 1 and 64),
  constraint matmove_receive_links_wallet_unique unique (wallet_id)
);

create index if not exists matmove_receive_links_user_idx
  on public.matmove_receive_links(user_id, enabled);

create table if not exists public.matmove_received_payments (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.matmove_receive_links(id) on delete restrict,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  provider_account_id text not null,
  provider_channel text not null check (provider_channel in ('checkout','ussd')),
  provider_object_id text unique,
  reference text not null unique,
  idempotency_key text not null unique,
  amount_minor bigint not null check (amount_minor between 100 and 100000000),
  currency text not null default 'SLE' check (currency = 'SLE'),
  state text not null default 'created'
    check (state in ('created','processing','completed','cancelled','expired','failed','review_required')),
  provider_status text,
  payer_network text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint matmove_received_payments_account_check check (provider_account_id ~ '^fac-[A-Za-z0-9_-]+$')
);

create index if not exists matmove_received_payments_owner_idx
  on public.matmove_received_payments(owner_user_id, created_at desc);
create index if not exists matmove_received_payments_state_idx
  on public.matmove_received_payments(state, created_at);

create table if not exists public.matmove_receive_sms_outbox (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.matmove_received_payments(id) on delete restrict,
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  phone_e164 text not null,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','review_required')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint matmove_receive_sms_phone_check check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint matmove_receive_sms_message_check check (length(message) between 1 and 320)
);

create index if not exists matmove_receive_sms_pending_idx
  on public.matmove_receive_sms_outbox(status, created_at)
  where status in ('pending','failed');

alter table public.matmove_receive_links enable row level security;
alter table public.matmove_received_payments enable row level security;
alter table public.matmove_receive_sms_outbox enable row level security;

revoke all on public.matmove_receive_links from public, anon, authenticated;
revoke all on public.matmove_received_payments from public, anon, authenticated;
revoke all on public.matmove_receive_sms_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.matmove_receive_links to service_role;
grant select, insert, update, delete on public.matmove_received_payments to service_role;
grant select, insert, update, delete on public.matmove_receive_sms_outbox to service_role;

commit;
