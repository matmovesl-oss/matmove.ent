
drop policy if exists "Users insert tickets" on public.event_tickets;
revoke insert on table public.event_tickets from authenticated;
