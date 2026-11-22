begin;

-- These three SECURITY DEFINER functions are trigger entry points only.
-- Their triggers execute under the trigger function owner; they are not public RPCs.
revoke all on function public.matmove_homepage_enforce_three_published()
  from public, anon, authenticated, service_role;

revoke all on function public.matmove_resolve_ride_investigation_after_cash_payment()
  from public, anon, authenticated, service_role;

revoke all on function public.matmove_resolve_ride_investigation_after_digital_payment()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
