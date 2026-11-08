-- Claim verified Monime customer events atomically for background processing.
-- A stale processing row is reclaimable after five minutes if a worker crashed.
-- Events stop retrying after eight attempts and require support review.
create or replace function public.matmove_claim_monime_customer_webhooks(
  p_limit integer default 3
)
returns table (
  event_row_id uuid,
  provider_event_id text,
  provider_event_type text,
  event_payload jsonb,
  attempt_number integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: trusted server required';
  end if;

  return query
  with candidates as (
    select e.id
    from public.provider_webhook_events e
    where e.provider = 'monime_customer'
      and e.signature_verified is true
      and e.processing_attempts < 8
      and (
        e.processing_status in ('received','failed')
        or (
          e.processing_status = 'processing'
          and e.updated_at < now() - interval '5 minutes'
        )
      )
    order by e.received_at asc, e.id asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,3),3))
  ),
  claimed as (
    update public.provider_webhook_events e
    set processing_status = 'processing',
        processing_attempts = e.processing_attempts + 1,
        processing_error = null,
        updated_at = now()
    from candidates c
    where e.id = c.id
    returning
      e.id,
      e.event_id,
      e.event_type,
      e.payload,
      e.processing_attempts
  )
  select
    c.id,
    c.event_id,
    c.event_type,
    c.payload,
    c.processing_attempts
  from claimed c;
end;
$$;

revoke all on function public.matmove_claim_monime_customer_webhooks(integer)
from public, anon, authenticated;
grant execute on function public.matmove_claim_monime_customer_webhooks(integer)
to service_role;
