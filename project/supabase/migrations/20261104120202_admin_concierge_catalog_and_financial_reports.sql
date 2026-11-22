begin;

create table if not exists public.concierge_services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) between 2 and 120),
  category text not null default 'Concierge' check (length(btrim(category)) between 2 and 60),
  description text not null default '' check (length(description) <= 1000),
  price_label text not null check (length(btrim(price_label)) between 1 and 120),
  is_active boolean not null default true,
  display_order integer not null default 100 check (display_order between 0 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.concierge_interests (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.concierge_services(id) on delete set null,
  service_slug text not null,
  service_title text not null,
  price_label_snapshot text not null,
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_name text,
  customer_email text,
  customer_phone text,
  message text not null default '' check (length(message) <= 1000),
  status text not null default 'new'
    check (status in ('new','contacted','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.concierge_service_audit (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.concierge_services(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('created','updated','deactivated','restored')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists concierge_services_active_order_idx
  on public.concierge_services (is_active, display_order, title)
  where deleted_at is null;
create index if not exists concierge_interests_created_idx
  on public.concierge_interests (created_at desc);
create index if not exists concierge_interests_status_created_idx
  on public.concierge_interests (status, created_at desc);
create index if not exists concierge_interests_service_created_idx
  on public.concierge_interests (service_id, created_at desc);
create index if not exists concierge_interests_customer_created_idx
  on public.concierge_interests (customer_id, created_at desc);

alter table public.concierge_services enable row level security;
alter table public.concierge_interests enable row level security;
alter table public.concierge_service_audit enable row level security;

revoke all privileges on table public.concierge_services from public, anon, authenticated;
revoke all privileges on table public.concierge_interests from public, anon, authenticated;
revoke all privileges on table public.concierge_service_audit from public, anon, authenticated;

grant select on table public.concierge_services to authenticated;
grant select, insert on table public.concierge_interests to authenticated;
grant all privileges on table public.concierge_services to service_role;
grant all privileges on table public.concierge_interests to service_role;
grant all privileges on table public.concierge_service_audit to service_role;

drop policy if exists "Customers can view active Concierge services" on public.concierge_services;
create policy "Customers can view active Concierge services"
  on public.concierge_services
  for select
  to authenticated
  using (is_active = true and deleted_at is null);

drop policy if exists "Customers can view their Concierge enquiries" on public.concierge_interests;
create policy "Customers can view their Concierge enquiries"
  on public.concierge_interests
  for select
  to authenticated
  using ((select auth.uid()) = customer_id);

drop policy if exists "Customers can submit their own Concierge enquiries" on public.concierge_interests;
create policy "Customers can submit their own Concierge enquiries"
  on public.concierge_interests
  for insert
  to authenticated
  with check (
    (select auth.uid()) = customer_id
    and exists (
      select 1
      from public.concierge_services s
      where s.id = service_id
        and s.slug = service_slug
        and s.title = service_title
        and s.price_label = price_label_snapshot
        and s.is_active = true
        and s.deleted_at is null
    )
  );

insert into public.concierge_services
  (slug, title, category, description, price_label, display_order)
values
  ('istanbul-turkey-tour', 'Istanbul Turkey Tour', 'Travel',
   '6 Days, 5 Nights • Guided tour and travel support.',
   'US$3,900', 10),
  ('vehicle-buying-help', 'Vehicle Buying Help', 'Procurement',
   'Vehicle sourcing and buying facilitation. Prados and more.',
   'US$15,000 – US$95,000', 20),
  ('air-sea-cargo', 'Air & Sea Cargo', 'Logistics',
   'Global procurement and air or sea freight shipping.',
   'US$20/kg', 30)
on conflict (slug) do nothing;

create or replace function public.matmove_report_definition(p_report text)
returns table(report text,title text,permission text,table_name text,key_name text,columns text[],row_filter text)
language sql immutable set search_path=pg_catalog,public as $definition$
 select * from (values
('customers','Customer accounts','customers','profiles','id',array['id','email','full_name','role','phone_number','kyc_status','created_at']::text[],'customer'),
('dispatch','Ride and delivery requests','dispatch','bookings','id',array['id','rider_id','driver_id','service_type','vehicle_type','pickup_location','destination_location','fare_amount','status','scheduled_time','created_at','updated_at']::text[],''),
('pricing','Vehicle pricing','pricing','pricing_settings','vehicle_type',array['vehicle_type','min_fare','per_km_rate']::text[],''),
('kyc','KYC submission history','kyc','kyc_submissions','id',array['id','profile_id','target_role','status','submitted_at','reviewed_at','created_at']::text[],''),
('wallets','Wallet records (cached balances)','financials','wallets','id',array['id','user_id','currency','balance','reserved_balance','is_frozen','monime_account_id','created_at']::text[],''),
('withdrawals','Withdrawal requests','payouts','withdrawal_requests','id',array['id','user_id','amount','currency','status','provider','provider_transaction_id','created_at','processed_at']::text[],''),
('payments','Application payment records','transactions','payment_transactions','id',array['id','user_id','wallet_id','type','amount','currency','status','provider_transaction_id','created_at']::text[],''),
('ride_payments','Ride payment states','transactions','ride_payments','booking_id',array['booking_id','payer_id','driver_id','state','fare_minor','driver_minor','fee_minor','created_at','updated_at']::text[],''),
('payouts','Current payout requests','payouts','matmove_withdrawals','id',array['id','user_id','wallet_id','amount_minor','monime_fee_minor','platform_fee_minor','total_minor','actual_monime_fee_minor','provider','state','created_at','updated_at']::text[],''),
('merchant_payments','Merchant checkouts','transactions','matmove_merchant_payments','id',array['id','rider_id','merchant_id','product_minor','delivery_minor','fee_minor','total_minor','state','delivery_state','created_at','updated_at']::text[],''),
('staff','Staff assignments including removed staff','staff','matmove_staff_access','id',array['id','email','full_name','department','is_owner','is_active','invite_state','removed_at','created_at','updated_at']::text[],''),
('logs','Audit log history','logs','audit_logs','id',array['id','admin_id','target_user_id','action','created_at']::text[],''),
('staff_audit','Staff access audit history','logs','matmove_staff_audit','id',array['id','actor_id','target_id','action','created_at']::text[],''),
('spin_players','Wheel player rounds','games.players','matmove_spin_rounds','id',array['id','user_id','state','created_at','updated_at']::text[],''),
('arcade_players','Dice, fruit and number player rounds','games.players','matmove_arcade_rounds','id',array['id','user_id','game','state','created_at','updated_at']::text[],''),
('spin_overview','Wheel round states','games.overview','matmove_spin_rounds','id',array['id','user_id','state','created_at','updated_at']::text[],''),
('arcade_overview','Dice, fruit and number round states','games.overview','matmove_arcade_rounds','id',array['id','user_id','game','state','expires_at','created_at','updated_at']::text[],''),
('spin_entries','Wheel entry transfers','games.entries','matmove_spin_legs','id',array['id','round_id','amount_minor','provider_id','status','created_at','updated_at']::text[],'entry'),
('spin_winnings','Wheel prize transfers','games.winnings','matmove_spin_legs','id',array['id','round_id','spin_index','amount_minor','provider_id','status','created_at','updated_at']::text[],'win'),
('arcade_entries','Dice, fruit and number entry transfers','games.entries','matmove_arcade_legs','id',array['id','round_id','amount_minor','provider_id','status','created_at','updated_at']::text[],'entry'),
('arcade_winnings','Dice, fruit and number prize transfers','games.winnings','matmove_arcade_legs','id',array['id','round_id','attempt_index','amount_minor','provider_id','status','created_at','updated_at']::text[],'win'),
('game_settings','Published game configuration versions','games.settings','matmove_arcade_configs','id',array['id','created_by','created_at']::text[],''),
('game_recovery','Game recovery audit history','games.recovery','matmove_arcade_admin_events','id',array['id','admin_id','action','created_at']::text[],''),
('payroll','Staff payroll transfers','financials','matmove_admin_payroll','id',array['id','request_key','initiated_by','staff_user_id','wallet_id','source_account_id','recipient_account_id','amount_minor','currency','reason','provider_transfer_id','provider_status','state','failure_detail','completed_at','created_at','updated_at']::text[],''),
('refunds','Customer refund transfers','financials','matmove_admin_refunds','id',array['id','request_key','initiated_by','recipient_user_id','recipient_account_id','source_account_id','amount_minor','currency','reason','provider_transfer_id','provider_status','state','failure_detail','completed_at','created_at','updated_at']::text[],''),
('concierge_services','MatMove Concierge service catalogue','special','concierge_services','id',array['id','slug','title','category','description','price_label','is_active','display_order','created_by','updated_by','created_at','updated_at','deleted_at']::text[],''),
('concierge_interests','MatMove Concierge customer enquiries','special','concierge_interests','id',array['id','service_id','service_slug','service_title','price_label_snapshot','customer_id','customer_name','customer_email','customer_phone','message','status','created_at','updated_at']::text[],'')
 ) as definitions(report,title,permission,table_name,key_name,columns,row_filter)
 where report=p_report;
$definition$;

create or replace function public.matmove_admin_report_catalog(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $catalog$
declare result jsonb;
begin
 if not exists(select 1 from public.matmove_staff_access where id=p_actor and is_active=true and removed_at is null)
 then raise exception 'FORBIDDEN: Active Admin access required.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.report,'title',d.title,'permission',d.permission,
  'columns',d.columns,'available',to_regclass(format('public.%I',d.table_name)) is not null,
  'note',case
    when d.table_name='wallets' then 'Database cached balances; not a live Monime balance.'
    when d.table_name in ('matmove_admin_payroll','matmove_admin_refunds') then 'Amounts are SLE minor units (100 = SLE 1). Provider status and recorded ledger state are reported separately.'
    when d.table_name='concierge_interests' then 'Customer enquiries and their recorded service-price snapshots; not a completed payment ledger.'
    else 'Operational database history. Missing optional fields are blank. Records reflect their state when read.'
  end)
  order by d.title),'[]'::jsonb) into result
 from unnest(array[
  'customers','dispatch','pricing','kyc','wallets','withdrawals','payments','ride_payments','payouts',
  'merchant_payments','staff','logs','staff_audit','spin_players','arcade_players','spin_overview','arcade_overview',
  'spin_entries','spin_winnings','arcade_entries','arcade_winnings','game_settings','game_recovery',
  'payroll','refunds','concierge_services','concierge_interests'
 ]::text[]) k
 cross join lateral public.matmove_report_definition(k) d
 where public.matmove_report_allowed(p_actor,d.permission);
 return result;
end;
$catalog$;

revoke all on table public.concierge_service_audit from public, anon, authenticated;
grant all privileges on table public.concierge_service_audit to service_role;

commit;