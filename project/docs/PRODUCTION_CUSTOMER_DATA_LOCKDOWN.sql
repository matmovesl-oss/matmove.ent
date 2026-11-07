-- MatMove production customer-data lockdown
-- Apply only after review and compatibility tests. All ownership rules derive from auth.uid().
begin;

-- Remove legacy policies that accidentally made private records visible to any signed-in user.
drop policy if exists "Admin_Bypass_Profiles" on public.profiles;
drop policy if exists "Admin_Read_Profiles" on public.profiles;
drop policy if exists "Admin_View_Profiles" on public.profiles;
drop policy if exists "Allow public read access to profiles" on public.profiles;
drop policy if exists "Staff view all profiles" on public.profiles;
drop policy if exists "Staff_View_Profiles" on public.profiles;
drop policy if exists "Allow admin updates" on public.profiles;

drop policy if exists "Admin_Bypass_Wallets" on public.wallets;
drop policy if exists "Admin_Read_Wallets" on public.wallets;
drop policy if exists "Admin_View_Wallets" on public.wallets;
drop policy if exists "Staff_View_Wallets" on public.wallets;

drop policy if exists "Admin_Read_Bookings" on public.bookings;
drop policy if exists "Admin_View_Bookings" on public.bookings;
drop policy if exists "Staff view all bookings" on public.bookings;
drop policy if exists "Staff_View_Bookings" on public.bookings;
drop policy if exists "Users can view relevant bookings" on public.bookings;
drop policy if exists "Drivers can update assigned bookings" on public.bookings;

drop policy if exists "Admin_Read_Withdrawals" on public.withdrawal_requests;
drop policy if exists "Admin_View_Withdrawals" on public.withdrawal_requests;
drop policy if exists "Staff view all withdrawals" on public.withdrawal_requests;
drop policy if exists "Staff_View_Withdrawals" on public.withdrawal_requests;

drop policy if exists "Admin manage travel_bookings" on public.travel_bookings;
drop policy if exists "Admins have full travel access" on public.travel_bookings;
drop policy if exists "Users create travel_bookings" on public.travel_bookings;
drop policy if exists "Users view own travel_bookings" on public.travel_bookings;

drop policy if exists "Admin manage event_tickets" on public.event_tickets;
drop policy if exists "Admins manage tickets" on public.event_tickets;
drop policy if exists "Users create event_tickets" on public.event_tickets;
drop policy if exists "Users view own event_tickets" on public.event_tickets;

drop policy if exists "Allow authenticated read audit logs" on public.audit_logs;
drop policy if exists "Allow authenticated insert audit logs" on public.audit_logs;
drop policy if exists "Enable delete for admins" on public.notifications;
drop policy if exists "Enable read for admins" on public.notifications;

drop policy if exists "Admin manage platform_events" on public.platform_events;
drop policy if exists "Admins manage events" on public.platform_events;
drop policy if exists "Public read active events" on public.platform_events;
drop policy if exists "Public view platform_events" on public.platform_events;

drop policy if exists "Admin manage travel_settings" on public.travel_settings;
drop policy if exists "Admin_View_Pricing" on public.vehicle_pricing;

-- No direct public or anonymous access to private customer and financial tables.
revoke all privileges on table
  public.profiles,
  public.wallets,
  public.user_roles,
  public.bookings,
  public.wallet_transactions,
  public.withdrawal_requests,
  public.travel_bookings,
  public.event_tickets,
  public.app_orders,
  public.audit_logs,
  public.notifications,
  public.admins,
  public.concierge_interests,
  public.kyc_submissions,
  public.kyc_documents
from public, anon;

-- Customer data is read-only from browser clients unless a specific workflow is explicitly granted below.
revoke all privileges on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

revoke all privileges on table public.wallets from authenticated;
grant select on table public.wallets to authenticated;

revoke all privileges on table public.user_roles from authenticated;
grant select on table public.user_roles to authenticated;

revoke all privileges on table public.wallet_transactions from authenticated;
grant select on table public.wallet_transactions to authenticated;

revoke all privileges on table public.withdrawal_requests from authenticated;
grant select on table public.withdrawal_requests to authenticated;

revoke all privileges on table public.bookings from authenticated;
grant select, insert on table public.bookings to authenticated;

revoke all privileges on table public.travel_bookings from authenticated;
grant select, insert, delete on table public.travel_bookings to authenticated;
grant update (status, cancel_reason, cancel_requested_at, admin_notes, boarded_at, boarded_by) on table public.travel_bookings to authenticated;

revoke all privileges on table public.event_tickets from authenticated;
grant select on table public.event_tickets to authenticated;
grant update (status, admitted_at) on table public.event_tickets to authenticated;

revoke all privileges on table public.app_orders from authenticated;
grant select, insert on table public.app_orders to authenticated;
grant update (status) on table public.app_orders to authenticated;

revoke all privileges on table public.audit_logs from authenticated;
grant select on table public.audit_logs to authenticated;

revoke all privileges on table public.notifications from authenticated;
revoke all privileges on table public.admins from authenticated;
grant select on table public.admins to authenticated;

revoke all privileges on table public.concierge_interests from authenticated;
grant select on table public.concierge_interests to authenticated;
revoke all privileges on table public.kyc_submissions from authenticated;
grant select, insert, update on table public.kyc_submissions to authenticated;
revoke all privileges on table public.kyc_documents from authenticated;
grant select, insert on table public.kyc_documents to authenticated;

-- Private profile rows: customers see their own profile. Only explicit Admin permissions
-- or the legacy verified Admin identity may read other profiles.
drop policy if exists matmove_profiles_owner_or_authorized_staff_select on public.profiles;
create policy matmove_profiles_owner_or_authorized_staff_select
on public.profiles as restrictive for select to authenticated
using (
  id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch','kyc','customers','financials','payouts']::text[]))
);

drop policy if exists matmove_profiles_anon_select_deny on public.profiles;
create policy matmove_profiles_anon_select_deny
on public.profiles as restrictive for select to anon using (false);

-- Wallets: customers see only their own wallet rows. Admin financial access stays permission-gated.
drop policy if exists matmove_wallets_owner_or_financial_staff_select on public.wallets;
create policy matmove_wallets_owner_or_financial_staff_select
on public.wallets as restrictive for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['financials']::text[]))
);

drop policy if exists matmove_wallets_anon_select_deny on public.wallets;
create policy matmove_wallets_anon_select_deny
on public.wallets as restrictive for select to anon using (false);

-- Wallet ledger rows are visible only through the owning wallet or an authorised finance user.
drop policy if exists matmove_wallet_transactions_owner_or_financial_staff_select on public.wallet_transactions;
create policy matmove_wallet_transactions_owner_or_financial_staff_select
on public.wallet_transactions as restrictive for select to authenticated
using (
  exists (
    select 1 from public.wallets w
    where w.id = wallet_transactions.wallet_id
      and w.user_id = (select auth.uid())
  )
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['financials','transactions']::text[]))
);

drop policy if exists matmove_wallet_transactions_anon_select_deny on public.wallet_transactions;
create policy matmove_wallet_transactions_anon_select_deny
on public.wallet_transactions as restrictive for select to anon using (false);

-- Withdrawal details are private, including destination numbers and provider responses.
drop policy if exists matmove_withdrawals_owner_or_payout_staff_select on public.withdrawal_requests;
create policy matmove_withdrawals_owner_or_payout_staff_select
on public.withdrawal_requests as restrictive for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['payouts','financials']::text[]))
);

drop policy if exists matmove_withdrawals_anon_select_deny on public.withdrawal_requests;
create policy matmove_withdrawals_anon_select_deny
on public.withdrawal_requests as restrictive for select to anon using (false);

-- Ride rows are visible to the rider, the assigned driver, a driver eligible for that
-- pending request, or staff explicitly authorised for dispatch/dashboard.
drop policy if exists matmove_bookings_participant_or_dispatch_select on public.bookings;
create policy matmove_bookings_participant_or_dispatch_select
on public.bookings as permissive for select to authenticated
using (
  rider_id = (select auth.uid())
  or driver_id = (select auth.uid())
  or public.matmove_driver_radar_visible(rider_id, driver_id, status)
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch']::text[]))
);

drop policy if exists matmove_bookings_private_scope_select on public.bookings;
create policy matmove_bookings_private_scope_select
on public.bookings as restrictive for select to authenticated
using (
  rider_id = (select auth.uid())
  or driver_id = (select auth.uid())
  or public.matmove_driver_radar_visible(rider_id, driver_id, status)
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch']::text[]))
);

drop policy if exists matmove_bookings_anon_select_deny on public.bookings;
create policy matmove_bookings_anon_select_deny
on public.bookings as restrictive for select to anon using (false);

-- New ride requests must be created by the signed-in rider. Customers cannot directly
-- assign drivers or create an already accepted/completed ride.
drop policy if exists matmove_bookings_insert_owned_pending_rider on public.bookings;
create policy matmove_bookings_insert_owned_pending_rider
on public.bookings as restrictive for insert to authenticated
with check (
  (
    rider_id = (select auth.uid())
    and public.matmove_preferences_role((select auth.uid())) = 'rider'
    and driver_id is null
    and status in ('pending','pending_admin')
  )
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

-- The customer and driver dashboards now use the server-authorised ride/payment RPCs
-- for state changes. Direct browser UPDATE/DELETE on bookings has been revoked above.

-- Travel bookings: private owner read; creation must be unpaid and pending; customers may
-- only request cancellation of an already paid booking, or delete their own unpaid request.
drop policy if exists matmove_travel_bookings_owner_or_dispatch_select on public.travel_bookings;
create policy matmove_travel_bookings_owner_or_dispatch_select
on public.travel_bookings as restrictive for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

drop policy if exists matmove_travel_bookings_anon_select_deny on public.travel_bookings;
create policy matmove_travel_bookings_anon_select_deny
on public.travel_bookings as restrictive for select to anon using (false);

drop policy if exists matmove_travel_bookings_owned_unpaid_insert on public.travel_bookings;
create policy matmove_travel_bookings_owned_unpaid_insert
on public.travel_bookings as restrictive for insert to authenticated
with check (
  (
    user_id = (select auth.uid())
    and coalesce(is_paid,false) = false
    and status = 'pending_approval'
    and payment_id is null
    and boarded_at is null
    and boarded_by is null
    and admin_notes is null
  )
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

drop policy if exists matmove_travel_bookings_owned_cancel_update on public.travel_bookings;
create policy matmove_travel_bookings_owned_cancel_update
on public.travel_bookings as restrictive for update to authenticated
using (
  (
    user_id = (select auth.uid())
    and is_paid = true
    and status not in ('cancel_requested','cancelled')
  )
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
)
with check (
  (
    user_id = (select auth.uid())
    and is_paid = true
    and status = 'cancel_requested'
  )
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

drop policy if exists matmove_travel_bookings_owned_unpaid_delete on public.travel_bookings;
create policy matmove_travel_bookings_owned_unpaid_delete
on public.travel_bookings as restrictive for delete to authenticated
using (
  (
    user_id = (select auth.uid())
    and coalesce(is_paid,false) = false
    and status in ('pending','pending_approval')
  )
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

-- Ticket rows are private. Ticket creation, payment status and gate admission are server-owned.
drop policy if exists matmove_event_tickets_owner_or_events_admin_select on public.event_tickets;
create policy matmove_event_tickets_owner_or_events_admin_select
on public.event_tickets as permissive for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

drop policy if exists matmove_event_tickets_private_scope_select on public.event_tickets;
create policy matmove_event_tickets_private_scope_select
on public.event_tickets as restrictive for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

drop policy if exists matmove_event_tickets_anon_select_deny on public.event_tickets;
create policy matmove_event_tickets_anon_select_deny
on public.event_tickets as restrictive for select to anon using (false);

-- In-app orders: rider and merchant participants only. Merchants can change only status.
drop policy if exists matmove_app_orders_participant_select_scope on public.app_orders;
create policy matmove_app_orders_participant_select_scope
on public.app_orders as restrictive for select to authenticated
using (
  rider_id = (select auth.uid())
  or merchant_id = (select auth.uid())
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['customers','financials','transactions']::text[]))
);

drop policy if exists matmove_app_orders_rider_insert_scope on public.app_orders;
create policy matmove_app_orders_rider_insert_scope
on public.app_orders as restrictive for insert to authenticated
with check (rider_id = (select auth.uid()));

drop policy if exists matmove_app_orders_merchant_update_scope on public.app_orders;
create policy matmove_app_orders_merchant_update_scope
on public.app_orders as restrictive for update to authenticated
using (merchant_id = (select auth.uid()))
with check (merchant_id = (select auth.uid()));

-- Audit rows are not customer-readable or client-writable. Admin audit access remains
-- through the authorised feed/function rather than arbitrary inserts into the legacy table.
drop policy if exists matmove_audit_logs_authorized_read on public.audit_logs;
create policy matmove_audit_logs_authorized_read
on public.audit_logs as permissive for select to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['logs']::text[]))
);

drop policy if exists matmove_audit_logs_private_scope on public.audit_logs;
create policy matmove_audit_logs_private_scope
on public.audit_logs as restrictive for select to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['logs']::text[]))
);

drop policy if exists matmove_audit_logs_anon_select_deny on public.audit_logs;
create policy matmove_audit_logs_anon_select_deny
on public.audit_logs as restrictive for select to anon using (false);

-- Legacy notifications are replaced by the per-recipient MatMove inbox/RPC.
-- Do not expose audience/target records directly to browser clients.

-- Published events are public. Event management stays available only to the owner or
-- staff with the dashboard permission; there is no public client write access.
drop policy if exists matmove_platform_events_published_read on public.platform_events;
drop policy if exists matmove_platform_events_published_read_scope on public.platform_events;
drop policy if exists matmove_platform_events_admin_write on public.platform_events;
grant insert, update, delete on table public.platform_events to authenticated;
create policy matmove_platform_events_admin_write
on public.platform_events as permissive for all to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard']::text[]))
)
with check (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard']::text[]))
);

-- Published events are public and read-only for ordinary visitors.
create policy matmove_platform_events_published_read
on public.platform_events as permissive for select to anon, authenticated
using (
  is_active = true
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch']::text[]))
);

create policy matmove_platform_events_published_read_scope
on public.platform_events as restrictive for select to anon, authenticated
using (
  is_active = true
  or (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch']::text[]))
);

-- Public configuration remains read-only. Admin writes use server-side endpoints/RPCs.
revoke insert, update, delete, truncate, references, trigger on table
  public.platform_events,
  public.travel_settings,
  public.vehicle_pricing
from public, anon, authenticated;

grant select on table public.platform_events to anon, authenticated;
grant select on table public.travel_settings to anon, authenticated;
grant select on table public.vehicle_pricing to anon, authenticated;
grant select on table public.exchange_rates to anon, authenticated;
grant select on table public.pricing_settings to anon, authenticated;
grant select on table public.products to anon, authenticated;

-- Private profile and wallet tables must never be anonymously readable/writable.
-- Ensure RLS stays enabled even if a previous migration was incomplete.
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.user_roles enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.bookings enable row level security;
alter table public.travel_bookings enable row level security;
alter table public.event_tickets enable row level security;
alter table public.app_orders enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_events enable row level security;
alter table public.travel_settings enable row level security;
alter table public.vehicle_pricing enable row level security;

-- Close obsolete money-moving SECURITY DEFINER functions that trust caller-supplied wallet
-- or driver IDs and do not validate the authenticated actor. Current production money flows
-- use the newer idempotent Monime/payment RPCs and service-side routes.
revoke all on function public.complete_and_settle_trip(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.process_gateway_payment(text,uuid,numeric,text,text) from public, anon, authenticated, service_role;

-- The old text-key notification function has no sender/permission check.
-- The current UUID-key implementation checks matmove_notification_sender().
revoke all on function public.matmove_admin_send_notification(text,text,uuid,text,text,text) from public, anon, authenticated;

-- Provider settlement is server-only (it also checks the JWT role internally).
revoke all on function public.settle_wallet_topup(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.settle_wallet_topup(uuid,text,jsonb) to service_role;

-- The old admin wallet toggle relied only on the legacy admins row. Require active financial permission.
create or replace function public.admin_set_wallet_active(
  p_wallet_id uuid,
  p_is_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_admin_id uuid := auth.uid();
  v_wallet public.wallets%rowtype;
  v_frozen boolean;
begin
  if v_admin_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.matmove_admin_any(array['financials']::text[]) then
    raise exception 'FORBIDDEN: Active financial permission is required.';
  end if;
  if p_wallet_id is null or p_is_active is null then
    raise exception 'Wallet ID and active state are required';
  end if;
  if nullif(pg_catalog.btrim(p_reason), '') is null
     or pg_catalog.length(p_reason) > 1000 then
    raise exception 'A reason of 1-1000 characters is required for freezing or unfreezing a wallet';
  end if;

  select * into v_wallet
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found then raise exception 'Wallet not found'; end if;

  v_frozen := not p_is_active;
  if v_wallet.is_frozen is not distinct from v_frozen then
    return pg_catalog.jsonb_build_object(
      'success', true, 'changed', false,
      'wallet_id', v_wallet.id, 'is_frozen', v_frozen
    );
  end if;

  update public.wallets set is_frozen = v_frozen where id = v_wallet.id;

  insert into public.admin_audit_logs (
    admin_id, action, resource_type, resource_id, target_profile_id,
    before_data, after_data, reason, metadata
  ) values (
    v_admin_id,
    case when v_frozen then 'wallet.freeze' else 'wallet.unfreeze' end,
    'wallet', v_wallet.id, v_wallet.user_id,
    pg_catalog.jsonb_build_object('is_frozen', v_wallet.is_frozen),
    pg_catalog.jsonb_build_object('is_frozen', v_frozen),
    pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('currency', v_wallet.currency)
  );

  return pg_catalog.jsonb_build_object(
    'success', true, 'changed', true,
    'wallet_id', v_wallet.id, 'user_id', v_wallet.user_id,
    'currency', v_wallet.currency, 'is_frozen', v_frozen
  );
end;
$function$;

-- Admin payroll/refund recipient lookup must not reveal arbitrary customer wallet references
-- to any authenticated user who knows a profile ID.
create or replace function public.matmove_admin_money_recipient(
  p_kind text,
  p_user uuid,
  p_account text
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  profile jsonb;
  wallet jsonb;
  count_wallets integer;
  wallet_id uuid;
begin
  if auth.uid() is null
     or not public.matmove_admin_any(array['financials']::text[]) then
    raise exception 'FORBIDDEN: Active financial permission is required.';
  end if;

  if p_kind not in ('payroll','refund') or p_user is null
     or p_account is null or p_account !~ '^fac-[A-Za-z0-9_-]+$' then
    raise exception 'INVALID: Recipient request is incomplete.';
  end if;

  select to_jsonb(p) into profile
  from public.profiles p
  where id=p_user
  for share;

  if not found
     or (p_kind='payroll' and (
       coalesce(profile->>'is_payroll_staff','false')<>'true'
       or coalesce(profile->>'role','') not in ('rider','driver','merchant')
     ))
     or (p_kind='refund' and coalesce(profile->>'role','') not in ('rider','driver','merchant'))
     or coalesce(profile->>'is_wallet_frozen','false')<>'false'
     or profile->>'is_active'='false'
     or profile->>'status' in ('inactive','deactivated','removed') then
    raise exception 'FORBIDDEN: Recipient is not eligible or the account is frozen.';
  end if;

  if exists(
    select 1 from public.matmove_staff_access
    where id=p_user and (not is_active or removed_at is not null)
  ) then
    raise exception 'FORBIDDEN: Removed or inactive staff cannot receive this payment.';
  end if;

  select count(*) into count_wallets
  from public.wallets where user_id=p_user and currency='SLE';

  if count_wallets<>1 then
    raise exception 'INVALID: Recipient needs exactly one SLE wallet.';
  end if;

  select to_jsonb(w) into wallet
  from public.wallets w
  where user_id=p_user and currency='SLE'
  for share;

  if coalesce(wallet->>'is_frozen','false')<>'false'
     or coalesce(wallet->>'monime_account_id',wallet->'metadata'->>'monime_account_id') is distinct from p_account
     or (wallet->>'monime_account_id' is not null and wallet->'metadata'->>'monime_account_id' is not null
         and wallet->>'monime_account_id'<>wallet->'metadata'->>'monime_account_id') then
    raise exception 'INVALID: Recipient wallet is frozen or its account link changed.';
  end if;

  if (select count(*) from public.wallets w
      where coalesce(to_jsonb(w)->>'monime_account_id',to_jsonb(w)->'metadata'->>'monime_account_id')=p_account)<>1 then
    raise exception 'INVALID: Recipient account is shared or ambiguous.';
  end if;

  wallet_id:=(wallet->>'id')::uuid;
  return wallet_id;
end;
$function$;

-- Travel booking settings remain public-readable, but only authorised Admin staff can edit them.
grant insert, update on table public.travel_settings to authenticated;
drop policy if exists matmove_travel_settings_admin_write on public.travel_settings;
create policy matmove_travel_settings_admin_write
on public.travel_settings as permissive for all to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
)
with check (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

-- Dispatch Admins retain the direct approval, rejection and boarding controls required by
-- the Admin Travel page. Customer access stays limited to their own unpaid booking/cancellation.
grant update (status, admin_notes, boarded_at, boarded_by) on table public.travel_bookings to authenticated;
drop policy if exists matmove_travel_bookings_dispatch_update on public.travel_bookings;
create policy matmove_travel_bookings_dispatch_update
on public.travel_bookings as permissive for update to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
)
with check (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

-- Event gate staff may mark a ticket admitted; ticket ownership and payment fields stay backend-owned.
drop policy if exists matmove_event_tickets_admin_read on public.event_tickets;
create policy matmove_event_tickets_admin_read
on public.event_tickets as permissive for select to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dashboard','dispatch']::text[]))
);

drop policy if exists matmove_event_tickets_dispatch_checkin on public.event_tickets;
create policy matmove_event_tickets_dispatch_checkin
on public.event_tickets as permissive for update to authenticated
using (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
)
with check (
  (select public.is_admin())
  or (select public.matmove_admin_any(array['dispatch']::text[]))
);

-- Correct a legacy RLS helper which previously returned TRUE for every ordinary customer.
create or replace function public.matmove_dispatch_booking_visible(
  p_rider uuid,
  p_driver uuid,
  p_status text
)
returns boolean
language plpgsql
stable
security definer
set search_path = 'pg_catalog'
as $function$
declare
  actor uuid := auth.uid();
  role_name text;
begin
  if actor is null then return false; end if;
  if public.matmove_admin_can('dispatch') then return true; end if;

  select p.role::text into role_name
  from public.profiles p
  where p.id = actor;

  if role_name = 'driver' then
    return coalesce(
      p_driver = actor
      or public.matmove_driver_radar_visible(p_rider,p_driver,p_status),
      false
    );
  end if;

  -- Regular customers may see only rides in which they are a participant.
  return coalesce(p_rider = actor or p_driver = actor,false);
end;
$function$;

-- Driver contact details are returned through a scoped RPC, not a cross-profile SELECT.
create or replace function public.matmove_driver_radar_contacts(p_booking_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
  actor_role text;
  result_rows jsonb;
begin
  if actor is null then raise exception 'AUTH: Sign in to view ride requests.'; end if;
  actor_role := public.matmove_preferences_role(actor);
  if actor_role is distinct from 'driver'
     or exists(select 1 from public.matmove_staff_access s where s.id=actor and s.is_active and s.removed_at is null) then
    raise exception 'FORBIDDEN: Active driver access is required.';
  end if;
  if p_booking_ids is null or cardinality(p_booking_ids) > 100 then
    raise exception 'INVALID: Request list is invalid.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'booking_id', b.id,
      'rider', jsonb_build_object(
        'full_name', coalesce(nullif(r.full_name,''), 'MatMove Customer'),
        'phone', case when b.driver_id=actor and b.status in ('accepted','in_progress')
          then coalesce(r.phone,r.phone_number) else null end,
        'phone_number', case when b.driver_id=actor and b.status in ('accepted','in_progress')
          then coalesce(r.phone_number,r.phone) else null end
      )
    ) order by b.created_at desc
  ),'[]'::jsonb)
  into result_rows
  from public.bookings b
  join public.profiles r on r.id=b.rider_id
  where b.id = any(p_booking_ids)
    and (
      b.driver_id = actor
      or public.matmove_driver_radar_visible(b.rider_id,b.driver_id,b.status)
    );

  return result_rows;
end;
$function$;

-- Customer trip history returns only the caller's own booking rows and the other participant's
-- display name, never the other participant's full profile.
create or replace function public.matmove_customer_trip_history(p_role text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
  actual_role text;
begin
  if actor is null then raise exception 'AUTH: Sign in to view trip history.'; end if;
  if exists(select 1 from public.matmove_staff_access s where s.id=actor and s.is_active and s.removed_at is null) then
    raise exception 'FORBIDDEN: Customer access is required.';
  end if;
  actual_role := public.matmove_preferences_role(actor);
  if p_role not in ('rider','driver','merchant') or p_role is distinct from actual_role then
    raise exception 'FORBIDDEN: The requested customer role does not match this account.';
  end if;

  return query
  select to_jsonb(b) || jsonb_build_object(
    'driver', case when d.id is null then null else jsonb_build_object('full_name',d.full_name) end,
    'rider', case when r.id is null then null else jsonb_build_object('full_name',r.full_name) end
  )
  from public.bookings b
  left join public.profiles d on d.id=b.driver_id
  left join public.profiles r on r.id=b.rider_id
  where
    (p_role='driver' and b.driver_id=actor)
    or (p_role in ('rider','merchant') and b.rider_id=actor)
  order by b.created_at desc;
end;
$function$;

-- A legacy nearby-driver lookup is limited to a validated rider session and a bounded radius.
create or replace function public.get_nearby_eligible_drivers(
  p_pickup_lat numeric default 8.484,
  p_pickup_lng numeric default -13.229,
  p_radius_km numeric default 5.0
)
returns table(driver_id uuid, full_name text, distance_km numeric)
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
  actor_role text;
begin
  if actor is null then raise exception 'AUTH: Sign in to find nearby drivers.'; end if;
  actor_role := public.matmove_preferences_role(actor);
  if actor_role is distinct from 'rider' then
    raise exception 'FORBIDDEN: Only a rider can search for nearby drivers.';
  end if;
  if p_pickup_lat is null or p_pickup_lng is null
     or p_pickup_lat < -90 or p_pickup_lat > 90
     or p_pickup_lng < -180 or p_pickup_lng > 180
     or p_radius_km is null or p_radius_km <= 0 or p_radius_km > 50 then
    raise exception 'INVALID: Location or search radius is invalid.';
  end if;

  return query
  select p.id,
         coalesce(nullif(p.full_name,''),'MatMove Driver'),
         round((6371 * acos(least(1,greatest(-1,
           cos(radians(p_pickup_lat)) * cos(radians(coalesce(dl.latitude,p_pickup_lat))) *
           cos(radians(coalesce(dl.longitude,p_pickup_lng)) - radians(p_pickup_lng)) +
           sin(radians(p_pickup_lat)) * sin(radians(coalesce(dl.latitude,p_pickup_lat)))
         ))))::numeric,2)
  from public.profiles p
  left join public.driver_locations dl on dl.driver_id=p.id
  where p.role='driver'
    and p.kyc_status='approved'
    and not coalesce(p.is_wallet_frozen,false)
    and coalesce(dl.is_active,true)=true
    and exists(select 1 from public.wallets w where w.user_id=p.id and w.currency='SLE' and not w.is_frozen)
    and (6371 * acos(least(1,greatest(-1,
           cos(radians(p_pickup_lat)) * cos(radians(coalesce(dl.latitude,p_pickup_lat))) *
           cos(radians(coalesce(dl.longitude,p_pickup_lng)) - radians(p_pickup_lng)) +
           sin(radians(p_pickup_lat)) * sin(radians(coalesce(dl.latitude,p_pickup_lat)))
         )))) <= p_radius_km
  order by 3 asc
  limit 50;
end;
$function$;

-- Remove client execute access to legacy routines which accept a wallet/profile/booking target
-- but were not designed for end-user invocation.
revoke all on function public.matmove_admin_send_notification(text,text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_and_settle_trip(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.process_gateway_payment(text,uuid,numeric,text,text) from public,anon,authenticated,service_role;

-- Explicitly scope the Admin lookup and server settlement functions.
revoke all on function public.matmove_admin_money_recipient(text,uuid,text) from public,anon;
grant execute on function public.matmove_admin_money_recipient(text,uuid,text) to authenticated;

revoke all on function public.matmove_driver_radar_contacts(uuid[]) from public,anon;
grant execute on function public.matmove_driver_radar_contacts(uuid[]) to authenticated;

revoke all on function public.matmove_customer_trip_history(text) from public,anon;
grant execute on function public.matmove_customer_trip_history(text) to authenticated;

revoke all on function public.get_nearby_eligible_drivers(numeric,numeric,numeric) from public,anon;
grant execute on function public.get_nearby_eligible_drivers(numeric,numeric,numeric) to authenticated;

-- Tighten mutable search paths flagged by the database security advisor.
alter function public.calculate_trip_fare(text,numeric) set search_path = pg_catalog, public;
alter function public.set_financial_updated_at() set search_path = pg_catalog, public;
alter function public.prevent_ledger_entry_mutation() set search_path = pg_catalog, public;
alter function public.ledger_transaction_is_balanced(uuid) set search_path = pg_catalog, public;
alter function public.matmove_admin_send_notification(text,text,uuid,text,text,text) set search_path = pg_catalog, public;
alter function public.process_gateway_payment(text,uuid,numeric,text,text) set search_path = pg_catalog, public;
alter function public.complete_and_settle_trip(uuid,uuid) set search_path = pg_catalog, public;
alter function public.get_nearby_eligible_drivers(numeric,numeric,numeric) set search_path = pg_catalog, public;

-- The old passcode column is not used by the current passcode system. Direct profile updates
-- are revoked above; the six-digit passcode hash stays in its dedicated private table/RPC.

commit;
