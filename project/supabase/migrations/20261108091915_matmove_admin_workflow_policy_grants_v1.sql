
drop policy if exists matmove_travel_settings_staff_manage on public.travel_settings;
create policy matmove_travel_settings_staff_manage on public.travel_settings
  for all to authenticated
  using (public.matmove_admin_can('travel.overview'))
  with check (public.matmove_admin_can('travel.overview'));

drop policy if exists matmove_platform_events_staff_manage on public.platform_events;
create policy matmove_platform_events_staff_manage on public.platform_events
  for all to authenticated
  using (public.matmove_admin_can('events.overview'))
  with check (public.matmove_admin_can('events.overview'));

drop policy if exists matmove_event_tickets_staff_checkin_update on public.event_tickets;
create policy matmove_event_tickets_staff_checkin_update on public.event_tickets
  for update to authenticated
  using (public.matmove_admin_can('events.checkin'))
  with check (public.matmove_admin_can('events.checkin'));

notify pgrst, 'reload schema';
