begin;

-- Exchange rates are public reference data. Authenticated clients may read
-- them but must not write directly; the Admin update path uses the separate
-- permission-checked currency_rates RPC. Keep all service_role privileges.

revoke insert, update, delete on table public.exchange_rates from authenticated;

commit;
