
-- MatMove lockdown phase 5: remove stale public profile/travel/product policies.

-- No public directory access to customer profiles. Authenticated access remains
-- governed by the restrictive profile policy added in phase 1.
drop policy if exists "Allow public read access to profiles" on public.profiles;

-- Replace travel booking wildcard policies with explicit owner and staff policies.
drop policy if exists "Admin manage travel_bookings" on public.travel_bookings;
drop policy if exists "Admins have full travel access" on public.travel_bookings;
drop policy if exists "Users create travel_bookings" on public.travel_bookings;
drop policy if exists "Users view own travel_bookings" on public.travel_bookings;

drop policy if exists matmove_travel_bookings_staff_select on public.travel_bookings;
create policy matmove_travel_bookings_staff_select
  on public.travel_bookings for select to authenticated
  using (public.matmove_admin_any(array[
    'travel.overview','travel.manifest','travel.boarding','travel.payments'
  ]::text[]));

drop policy if exists matmove_travel_bookings_staff_insert on public.travel_bookings;
create policy matmove_travel_bookings_staff_insert
  on public.travel_bookings for insert to authenticated
  with check (public.matmove_admin_can('travel.manifest'));

drop policy if exists matmove_travel_bookings_staff_update on public.travel_bookings;
create policy matmove_travel_bookings_staff_update
  on public.travel_bookings for update to authenticated
  using (public.matmove_admin_any(array[
    'travel.manifest','travel.boarding','travel.payments'
  ]::text[]))
  with check (public.matmove_admin_any(array[
    'travel.manifest','travel.boarding','travel.payments'
  ]::text[]));

drop policy if exists matmove_travel_bookings_staff_delete on public.travel_bookings;
create policy matmove_travel_bookings_staff_delete
  on public.travel_bookings for delete to authenticated
  using (public.matmove_admin_can('travel.manifest'));

-- Public customers can see only currently published/available products.
-- Merchants can see all of their own listings, including drafts or unavailable items.
drop policy if exists "Admin_Read_Products" on public.products;
drop policy if exists "Admins view all products" on public.products;
drop policy if exists "Staff view all products" on public.products;
drop policy if exists "Allow public read access to products" on public.products;
drop policy if exists "Allow public select on products" on public.products;
drop policy if exists "Allow merchants to insert products" on public.products;
drop policy if exists "Allow merchants to modify products" on public.products;
drop policy if exists matmove_catalog_read on public.products;
drop policy if exists matmove_catalog_insert_scope on public.products;
drop policy if exists matmove_catalog_update_scope on public.products;

drop policy if exists matmove_catalog_published_read on public.products;
create policy matmove_catalog_published_read
  on public.products for select to anon, authenticated
  using (is_available is true and deleted_at is null);

drop policy if exists matmove_catalog_owner_read on public.products;
create policy matmove_catalog_owner_read
  on public.products for select to authenticated
  using (
    merchant_id = (select auth.uid())
    and public.matmove_catalog_is_merchant()
  );

notify pgrst, 'reload schema';
