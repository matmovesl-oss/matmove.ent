
-- Remove legacy authenticated-wide policies now superseded by explicit ownership
-- and permission-based restrictive policies.
drop policy if exists "Admin_Read_Bookings" on public.bookings;
drop policy if exists "Admin_View_Bookings" on public.bookings;
drop policy if exists "Staff view all bookings" on public.bookings;
drop policy if exists "Staff_View_Bookings" on public.bookings;

drop policy if exists "Admin_Bypass_Profiles" on public.profiles;
drop policy if exists "Admin_Read_Profiles" on public.profiles;
drop policy if exists "Admin_View_Profiles" on public.profiles;
drop policy if exists "Staff view all profiles" on public.profiles;
drop policy if exists "Staff_View_Profiles" on public.profiles;
drop policy if exists "Allow admin updates" on public.profiles;

drop policy if exists "Admin_Bypass_Wallets" on public.wallets;
drop policy if exists "Admin_Read_Wallets" on public.wallets;
drop policy if exists "Admin_View_Wallets" on public.wallets;
drop policy if exists "Staff_View_Wallets" on public.wallets;

drop policy if exists "Admin_Read_Withdrawals" on public.withdrawal_requests;
drop policy if exists "Admin_View_Withdrawals" on public.withdrawal_requests;
drop policy if exists "Staff view all withdrawals" on public.withdrawal_requests;
drop policy if exists "Staff_View_Withdrawals" on public.withdrawal_requests;

drop policy if exists "Admin_View_Pricing" on public.vehicle_pricing;

notify pgrst, 'reload schema';
