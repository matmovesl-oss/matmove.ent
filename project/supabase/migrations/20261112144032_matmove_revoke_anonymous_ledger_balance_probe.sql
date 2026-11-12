-- The ledger-balance helper is an authenticated internal check, not a public probe.
-- It remains SECURITY INVOKER and is subject to ledger_entries RLS.
begin;

revoke execute on function public.ledger_transaction_is_balanced(uuid)
  from public, anon;

grant execute on function public.ledger_transaction_is_balanced(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
