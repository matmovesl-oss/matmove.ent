
-- Restore explicitly permission-scoped admin UI operations after lockdown.
-- Public customers cannot perform any of these mutations.

-- Travel settings: only assigned travel overview staff may configure seats and fares.
drop policy if exists matmove_lock_travel_settings_staff on public.travel_settings;
create policy matmove_lock_travel_settings_staff on public.travel_settings
  as restrictive for all to authenticated
  using (public.matmove_admin_can('travel.overview'))
  with check (public.matmove_admin_can('travel.overview'));
grant select, insert, update on public.travel_settings to authenticated;
revoke delete on public.travel_settings from authenticated;

-- Events: customers see published events; assigned events staff can also see drafts and manage listings.
drop policy if exists matmove_platform_events_staff_read on public.platform_events;
create policy matmove_platform_events_staff_read on public.platform_events
  for select to authenticated
  using (public.matmove_admin_any(array['events.overview','events.sales','events.checkin']::text[]));

drop policy if exists matmove_platform_events_staff_write on public.platform_events;
create policy matmove_platform_events_staff_write on public.platform_events
  as restrictive for all to authenticated
  using (public.matmove_admin_can('events.overview'))
  with check (public.matmove_admin_can('events.overview'));
grant insert, update, delete on public.platform_events to authenticated;

-- Event ticket receipts remain private to their buyer; sales/check-in staff can view them.
drop policy if exists matmove_event_tickets_owner_read on public.event_tickets;
create policy matmove_event_tickets_owner_read on public.event_tickets
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Gate check-in is the only direct ticket mutation allowed from the Admin browser.
drop policy if exists matmove_event_tickets_checkin_update on public.event_tickets;
create policy matmove_event_tickets_checkin_update on public.event_tickets
  as restrictive for update to authenticated
  using (public.matmove_admin_can('events.checkin'))
  with check (public.matmove_admin_can('events.checkin'));
grant update on public.event_tickets to authenticated;

notify pgrst, 'reload schema';
