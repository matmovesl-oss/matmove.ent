
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'matmove_staff_select',
        'matmove_staff_insert',
        'matmove_staff_update',
        'matmove_staff_delete'
      )
      and (
        coalesce(qual, '') ilike '%not matmove_is_staff%'
        or coalesce(with_check, '') ilike '%not matmove_is_staff%'
      )
  loop
    execute format(
      'drop policy %I on %I.%I',
      p.policyname, p.schemaname, p.tablename
    );
  end loop;
end
$$;

-- These legacy booking policies allowed all signed-in users to see
-- unassigned bookings and to update pending unassigned bookings.
-- The newer lock policies and identity-bound radar helpers replace them.
drop policy if exists "Users can view relevant bookings" on public.bookings;
drop policy if exists "Drivers can update assigned bookings" on public.bookings;
