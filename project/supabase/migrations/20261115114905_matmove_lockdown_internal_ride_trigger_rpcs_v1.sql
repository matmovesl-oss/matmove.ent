begin;

-- These are trigger-only SECURITY DEFINER functions. They must not be callable
-- as public PostgREST RPC endpoints by anonymous or signed-in clients.
revoke all on function public.matmove_cash_ride_return_refund_status_sync()
  from public, anon, authenticated;

revoke all on function public.matmove_resolve_terminal_ride_investigation()
  from public, anon, authenticated;

commit;
