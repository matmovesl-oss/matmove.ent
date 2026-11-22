
revoke all privileges on all tables in schema public from anon;

grant select on table
  public.exchange_rates,
  public.platform_events,
  public.products,
  public.pricing_settings,
  public.travel_settings,
  public.vehicle_pricing
to anon;

revoke all privileges on all sequences in schema public from anon;
