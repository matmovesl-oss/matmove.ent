
-- Merchant profile compliance data is server-managed. No browser code in the
-- customer or Admin portal uses this table directly; keep access server-side.
revoke all privileges on table public.merchant_profiles
  from public, anon, authenticated;
grant all privileges on table public.merchant_profiles
  to service_role;

notify pgrst, 'reload schema';
