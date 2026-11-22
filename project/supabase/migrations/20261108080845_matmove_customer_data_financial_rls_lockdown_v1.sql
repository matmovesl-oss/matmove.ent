
-- MatMove production security lockdown, phase 1.
-- Restricts customer rows and removes direct browser writes to financial/admin tables.
-- Does not modify customer data, balances, payment receipts, KYC status, or staff assignments.

-- Ensure every server-mediated workflow retains its service-role database access.
grant all on table
  public.profiles, public.admins, public.admin_audit_logs, public.audit_logs,
  public.bookings, public.driver_profiles, public.kyc_documents, public.kyc_submissions,
  public.wallets, public.wallet_transactions, public.payment_transactions,
  public.withdrawal_requests, public.travel_bookings, public.travel_settings,
  public.event_tickets, public.platform_events, public.pricing_settings,
  public.vehicle_pricing, public.fraud_logs, public.notifications,
  public.user_roles, public.matmove_staff_access,
  public.matmove_spin_access, public.matmove_spin_admin_log,
  public.matmove_spin_configs, public.matmove_spin_legs,
  public.matmove_spin_outcomes, public.matmove_spin_rounds
to service_role;

-- Anonymous API keys must never read or mutate customer, booking, or financial records.
revoke all privileges on table
  public.profiles, public.admins, public.admin_audit_logs, public.audit_logs,
  public.bookings, public.driver_profiles, public.kyc_documents, public.kyc_submissions,
  public.wallets, public.wallet_transactions, public.payment_transactions,
  public.withdrawal_requests, public.travel_bookings, public.event_tickets,
  public.fraud_logs, public.notifications, public.user_roles, public.matmove_staff_access,
  public.matmove_spin_access, public.matmove_spin_admin_log, public.matmove_spin_configs,
  public.matmove_spin_legs, public.matmove_spin_outcomes, public.matmove_spin_rounds
from public, anon;

-- Profiles: customers see their own complete profile only. Staff require explicit assignments.
drop policy if exists matmove_lock_profiles_select on public.profiles;
create policy matmove_lock_profiles_select on public.profiles
  as restrictive for select to authenticated
  using (
    id = (select auth.uid())
    or public.matmove_admin_any(array['customers','kyc','dispatch','financials','payouts']::text[])
  );
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

-- Bookings: rider, assigned driver, eligible driver radar, or authorized dispatch/dashboard staff.
drop policy if exists matmove_lock_bookings_select on public.bookings;
create policy matmove_lock_bookings_select on public.bookings
  as restrictive for select to authenticated
  using (
    rider_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or (
      driver_id is null
      and public.matmove_driver_radar_visible(rider_id, driver_id, status)
    )
    or public.matmove_admin_any(array['dispatch','dashboard']::text[])
  );

drop policy if exists matmove_lock_bookings_insert on public.bookings;
create policy matmove_lock_bookings_insert on public.bookings
  as restrictive for insert to authenticated
  with check (
    rider_id = (select auth.uid())
    or public.matmove_admin_can('dispatch')
  );

drop policy if exists matmove_lock_bookings_update on public.bookings;
create policy matmove_lock_bookings_update on public.bookings
  as restrictive for update to authenticated
  using (
    rider_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or (
      driver_id is null
      and public.matmove_driver_radar_visible(rider_id, driver_id, status)
    )
    or public.matmove_admin_can('dispatch')
  )
  with check (
    rider_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or public.matmove_admin_can('dispatch')
  );

drop policy if exists matmove_lock_bookings_delete on public.bookings;
create policy matmove_lock_bookings_delete on public.bookings
  as restrictive for delete to authenticated
  using (
    rider_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or public.matmove_admin_can('dispatch')
  );
grant select, insert, update, delete on table public.bookings to authenticated;

-- Wallet balances: visible only to the wallet owner or an appropriately assigned finance team member.
drop policy if exists matmove_lock_wallets_select on public.wallets;
create policy matmove_lock_wallets_select on public.wallets
  as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['financials','payouts','transactions']::text[])
  );
revoke insert, update, delete on table public.wallets from authenticated;
grant select on table public.wallets to authenticated;

-- Wallet ledger entries are read-only to customers and scoped to their own wallet.
drop policy if exists matmove_lock_wallet_transactions_select on public.wallet_transactions;
create policy matmove_lock_wallet_transactions_select on public.wallet_transactions
  as restrictive for select to authenticated
  using (
    exists (
      select 1 from public.wallets w
      where w.id = wallet_transactions.wallet_id
        and w.user_id = (select auth.uid())
    )
    or public.matmove_admin_any(array['financials','payouts','transactions']::text[])
  );
revoke insert, update, delete on table public.wallet_transactions from authenticated;
grant select on table public.wallet_transactions to authenticated;

-- Payment transaction details: user-owned receipts or authorized finance staff only.
drop policy if exists matmove_lock_payment_transactions_select on public.payment_transactions;
create policy matmove_lock_payment_transactions_select on public.payment_transactions
  as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['financials','payouts','transactions']::text[])
  );
revoke insert, update, delete on table public.payment_transactions from authenticated;
grant select on table public.payment_transactions to authenticated;

-- Withdrawal requests: private to the requester and the payouts team.
drop policy if exists matmove_lock_withdrawal_requests_select on public.withdrawal_requests;
create policy matmove_lock_withdrawal_requests_select on public.withdrawal_requests
  as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_can('payouts')
  );
revoke insert, update, delete on table public.withdrawal_requests from authenticated;
grant select on table public.withdrawal_requests to authenticated;

-- Travel bookings: private customer records; authorized travel staff can access operational records.
drop policy if exists matmove_lock_travel_bookings_select on public.travel_bookings;
create policy matmove_lock_travel_bookings_select on public.travel_bookings
  as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['travel.overview','travel.manifest','travel.boarding','travel.payments']::text[])
  );

drop policy if exists matmove_lock_travel_bookings_insert on public.travel_bookings;
create policy matmove_lock_travel_bookings_insert on public.travel_bookings
  as restrictive for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or public.matmove_admin_can('travel.manifest')
  );

drop policy if exists matmove_lock_travel_bookings_update on public.travel_bookings;
create policy matmove_lock_travel_bookings_update on public.travel_bookings
  as restrictive for update to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['travel.manifest','travel.boarding','travel.payments']::text[])
  )
  with check (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['travel.manifest','travel.boarding','travel.payments']::text[])
  );

drop policy if exists matmove_lock_travel_bookings_delete on public.travel_bookings;
create policy matmove_lock_travel_bookings_delete on public.travel_bookings
  as restrictive for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_can('travel.manifest')
  );
grant select, insert, update, delete on table public.travel_bookings to authenticated;

-- Customer travel settings and public pricing are read-only from browser sessions.
drop policy if exists "Admin manage travel_settings" on public.travel_settings;
revoke insert, update, delete on table public.travel_settings from anon, authenticated;
grant select on table public.travel_settings to anon, authenticated;

revoke insert, update, delete on table public.pricing_settings from anon, authenticated;
grant select on table public.pricing_settings to anon, authenticated;

revoke insert, update, delete on table public.vehicle_pricing from anon, authenticated;
grant select on table public.vehicle_pricing to anon, authenticated;

-- Event tickets are private receipts. Ticket creation and changes are server-mediated.
drop policy if exists "Admin manage event_tickets" on public.event_tickets;
drop policy if exists "Admins manage tickets" on public.event_tickets;
drop policy if exists "Users view own event_tickets" on public.event_tickets;
drop policy if exists "Users create event_tickets" on public.event_tickets;
drop policy if exists matmove_lock_event_tickets_select on public.event_tickets;
create policy matmove_lock_event_tickets_select on public.event_tickets
  as restrictive for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.matmove_admin_any(array['events.sales','events.checkin']::text[])
  );
drop policy if exists matmove_event_tickets_staff_read on public.event_tickets;
create policy matmove_event_tickets_staff_read on public.event_tickets
  for select to authenticated
  using (public.matmove_admin_any(array['events.sales','events.checkin']::text[]));
revoke insert, update, delete on table public.event_tickets from authenticated;
grant select on table public.event_tickets to authenticated;

-- Published events remain publicly readable. Draft/event-management writes stay server-side.
drop policy if exists "Admin manage platform_events" on public.platform_events;
drop policy if exists "Admins manage events" on public.platform_events;
drop policy if exists "Public read active events" on public.platform_events;
drop policy if exists "Public view platform_events" on public.platform_events;
drop policy if exists matmove_platform_events_public_read on public.platform_events;
create policy matmove_platform_events_public_read on public.platform_events
  for select to anon, authenticated
  using (is_active = true);
revoke insert, update, delete on table public.platform_events from anon, authenticated;
grant select on table public.platform_events to anon, authenticated;

-- Driver license/profile records: only the driver and authorized compliance/dispatch teams.
drop policy if exists matmove_lock_driver_profiles_select on public.driver_profiles;
create policy matmove_lock_driver_profiles_select on public.driver_profiles
  as restrictive for select to authenticated
  using (
    profile_id = (select auth.uid())
    or public.matmove_admin_any(array['kyc','customers','dispatch']::text[])
  );
revoke insert, update, delete on table public.driver_profiles from authenticated;
grant select on table public.driver_profiles to authenticated;

-- KYC records: readable only by the applicant and KYC-authorized staff.
drop policy if exists matmove_lock_kyc_submissions_select on public.kyc_submissions;
create policy matmove_lock_kyc_submissions_select on public.kyc_submissions
  as restrictive for select to authenticated
  using (
    profile_id = (select auth.uid())
    or public.matmove_admin_can('kyc')
  );
revoke insert, update, delete on table public.kyc_submissions from authenticated;
grant select on table public.kyc_submissions to authenticated;

drop policy if exists matmove_lock_kyc_documents_select on public.kyc_documents;
create policy matmove_lock_kyc_documents_select on public.kyc_documents
  as restrictive for select to authenticated
  using (
    exists (
      select 1 from public.kyc_submissions s
      where s.id = kyc_documents.submission_id
        and s.profile_id = (select auth.uid())
    )
    or public.matmove_admin_can('kyc')
  );
revoke insert, update, delete on table public.kyc_documents from authenticated;
grant select on table public.kyc_documents to authenticated;

-- Audit and fraud records are management data, not customer-facing tables.
drop policy if exists "Allow authenticated read audit logs" on public.audit_logs;
drop policy if exists "Allow authenticated insert audit logs" on public.audit_logs;
drop policy if exists matmove_lock_audit_logs_select on public.audit_logs;
create policy matmove_lock_audit_logs_select on public.audit_logs
  as restrictive for select to authenticated
  using (public.matmove_admin_can('logs'));
revoke insert, update, delete on table public.audit_logs from authenticated;
grant select on table public.audit_logs to authenticated;

drop policy if exists "Admins can view audit logs" on public.admin_audit_logs;
drop policy if exists matmove_admin_audit_logs_staff_read on public.admin_audit_logs;
create policy matmove_admin_audit_logs_staff_read on public.admin_audit_logs
  for select to authenticated
  using (public.matmove_admin_can('logs'));
drop policy if exists matmove_lock_admin_audit_logs_select on public.admin_audit_logs;
create policy matmove_lock_admin_audit_logs_select on public.admin_audit_logs
  as restrictive for select to authenticated
  using (public.matmove_admin_can('logs'));
revoke insert, update, delete on table public.admin_audit_logs from authenticated;
grant select on table public.admin_audit_logs to authenticated;

drop policy if exists matmove_lock_fraud_logs_select on public.fraud_logs;
create policy matmove_lock_fraud_logs_select on public.fraud_logs
  as restrictive for select to authenticated
  using (public.matmove_admin_can('logs'));
revoke insert, update, delete on table public.fraud_logs from authenticated;
grant select on table public.fraud_logs to authenticated;

-- Staff identity/assignment tables must never be directly accessible to customer sessions.
revoke all privileges on table public.admins, public.matmove_staff_access
from public, anon, authenticated;

-- User role mappings are self-readable but never directly writable by browser sessions.
revoke insert, update, delete on table public.user_roles from public, anon, authenticated;
grant select on table public.user_roles to authenticated;

-- Legacy notification table is retired. The private matmove_notification_* RPC inbox remains in use.
drop policy if exists "Enable read for admins" on public.notifications;
drop policy if exists "Enable delete for admins" on public.notifications;
revoke all privileges on table public.notifications from public, anon, authenticated;

-- Spin configuration, outcomes, ledger legs and admin logs are never browser-readable.
-- Customer and admin game flows use authenticated server endpoints/RPCs.
revoke all privileges on table
  public.matmove_spin_access, public.matmove_spin_admin_log,
  public.matmove_spin_configs, public.matmove_spin_legs,
  public.matmove_spin_outcomes, public.matmove_spin_rounds
from public, anon, authenticated;

drop policy if exists matmove_staff_select on public.matmove_spin_access;
drop policy if exists matmove_staff_insert on public.matmove_spin_access;
drop policy if exists matmove_staff_update on public.matmove_spin_access;
drop policy if exists matmove_staff_delete on public.matmove_spin_access;
drop policy if exists matmove_staff_select on public.matmove_spin_admin_log;
drop policy if exists matmove_staff_insert on public.matmove_spin_admin_log;
drop policy if exists matmove_staff_update on public.matmove_spin_admin_log;
drop policy if exists matmove_staff_delete on public.matmove_spin_admin_log;
drop policy if exists matmove_staff_select on public.matmove_spin_configs;
drop policy if exists matmove_staff_insert on public.matmove_spin_configs;
drop policy if exists matmove_staff_update on public.matmove_spin_configs;
drop policy if exists matmove_staff_delete on public.matmove_spin_configs;
drop policy if exists matmove_staff_select on public.matmove_spin_legs;
drop policy if exists matmove_staff_insert on public.matmove_spin_legs;
drop policy if exists matmove_staff_update on public.matmove_spin_legs;
drop policy if exists matmove_staff_delete on public.matmove_spin_legs;
drop policy if exists matmove_staff_select on public.matmove_spin_outcomes;
drop policy if exists matmove_staff_insert on public.matmove_spin_outcomes;
drop policy if exists matmove_staff_update on public.matmove_spin_outcomes;
drop policy if exists matmove_staff_delete on public.matmove_spin_outcomes;
drop policy if exists matmove_staff_select on public.matmove_spin_rounds;
drop policy if exists matmove_staff_insert on public.matmove_spin_rounds;
drop policy if exists matmove_staff_update on public.matmove_spin_rounds;
drop policy if exists matmove_staff_delete on public.matmove_spin_rounds;

notify pgrst, 'reload schema';
