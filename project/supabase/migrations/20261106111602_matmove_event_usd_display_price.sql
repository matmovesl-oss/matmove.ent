
alter table public.platform_events
  add column if not exists ticket_price_usd numeric(14,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='platform_events_ticket_price_usd_positive'
      and conrelid='public.platform_events'::regclass
  ) then
    alter table public.platform_events
      add constraint platform_events_ticket_price_usd_positive
      check (ticket_price_usd is null or ticket_price_usd > 0);
  end if;
end
$$;

comment on column public.platform_events.ticket_price_usd is
  'Optional USD display quote. Ticket wallet debit always uses ticket_price in SLE.';
