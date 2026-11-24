begin;

-- Remove only permissive policies that duplicate an existing policy's exact
-- row-access predicate or staff permission check. Restrictive access controls
-- and the surviving public owner-read policies remain unchanged.

drop policy "Users can view own wallet" on public.wallets;
drop policy "Users can view their own wallets" on public.wallets;
drop policy wallets_select_own on public.wallets;

drop policy wallet_transactions_select_own on public.wallet_transactions;

drop policy matmove_event_tickets_owner_read on public.event_tickets;
drop policy matmove_event_tickets_staff_checkin_update on public.event_tickets;

notify pgrst, 'reload schema';

commit;
