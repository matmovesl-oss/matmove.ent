
drop policy if exists "Admins view all bookings" on public.bookings;
drop policy if exists "Admins view all profiles" on public.profiles;
drop policy if exists "Admins view all wallets" on public.wallets;
drop policy if exists "Admins view all withdrawals" on public.withdrawal_requests;

drop policy if exists "Staff can view all wallets" on public.wallets;
drop policy if exists "Staff can view all transactions" on public.wallet_transactions;
