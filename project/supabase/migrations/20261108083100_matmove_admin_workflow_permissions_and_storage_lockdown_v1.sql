
-- MatMove lockdown phase 3: restore explicit staff workflows without broad access.

-- Travel capacity/pricing is editable only by staff assigned to Travel overview.
grant select, insert, update, delete on public.travel_settings to authenticated;
drop policy if exists matmove_travel_settings_staff_manage on public.travel_settings;
create policy matmove_travel_settings_staff_manage
  on public.travel_settings for all to authenticated
  using (public.matmove_admin_any(array['travel.overview']::text[]))
  with check (public.matmove_admin_any(array['travel.overview']::text[]));

-- Admin event management: active events remain public; staff with the relevant
-- event assignment can see all events, and only event-overview staff can edit.
grant select, insert, update, delete on public.platform_events to authenticated;
drop policy if exists matmove_platform_events_staff_read on public.platform_events;
create policy matmove_platform_events_staff_read
  on public.platform_events for select to authenticated
  using (public.matmove_admin_any(array['events.overview','events.sales','events.checkin']::text[]));

drop policy if exists matmove_platform_events_staff_insert on public.platform_events;
create policy matmove_platform_events_staff_insert
  on public.platform_events for insert to authenticated
  with check (public.matmove_admin_can('events.overview'));

drop policy if exists matmove_platform_events_staff_update on public.platform_events;
create policy matmove_platform_events_staff_update
  on public.platform_events for update to authenticated
  using (public.matmove_admin_can('events.overview'))
  with check (public.matmove_admin_can('events.overview'));

drop policy if exists matmove_platform_events_staff_delete on public.platform_events;
create policy matmove_platform_events_staff_delete
  on public.platform_events for delete to authenticated
  using (public.matmove_admin_can('events.overview'));

-- Event ticket receipts remain owner/staff-readable. Gate check-in is an
-- update-only operation for staff specifically assigned to event check-in.
grant update on public.event_tickets to authenticated;
drop policy if exists matmove_event_tickets_staff_checkin on public.event_tickets;
create policy matmove_event_tickets_staff_checkin
  on public.event_tickets for update to authenticated
  using (public.matmove_admin_can('events.checkin'))
  with check (public.matmove_admin_can('events.checkin'));

-- Replace the old bucket-wide write policies with permission-checked
-- authenticated upload/update/delete. Public download remains available.
drop policy if exists "Admin upload flyer images" on storage.objects;
drop policy if exists "Admin update flyer images" on storage.objects;
drop policy if exists "Admin delete flyer images" on storage.objects;

create policy matmove_event_flyers_staff_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  );

create policy matmove_event_flyers_staff_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  )
  with check (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  );

create policy matmove_event_flyers_staff_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-flyers'
    and public.matmove_admin_can('events.overview')
  );

-- A narrow customer-directory RPC replaces direct reads of every profile field
-- from the Notifications page. The notification permission is checked server-side.
create or replace function public.matmove_admin_notification_customers()
returns table (
  id uuid,
  role text,
  full_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  phone_number text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public.matmove_notification_sender();

  return query
    select p.id,
           p.role::text,
           p.full_name,
           p.first_name,
           p.last_name,
           p.email,
           p.phone,
           p.phone_number
    from public.profiles p
    where p.role::text in ('rider','driver','merchant')
      and public.matmove_notification_customer(p.id)
    order by p.created_at desc
    limit 5000;
end;
$function$;

revoke all on function public.matmove_admin_notification_customers()
  from public, anon;
grant execute on function public.matmove_admin_notification_customers()
  to authenticated, service_role;

notify pgrst, 'reload schema';
