-- Restore the permissive owner-read path for Trips & Deliveries.
-- The existing restrictive policies still enforce participant ownership,
-- dispatch visibility and role-specific driver-radar rules.
begin;

drop policy if exists matmove_bookings_owner_select on public.bookings;

create policy matmove_bookings_owner_select
  on public.bookings
  as permissive
  for select
  to authenticated
  using (
    rider_id = (select auth.uid())
    or driver_id = (select auth.uid())
  );

commit;