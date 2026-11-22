-- Add a private, audited manual-review state to the admin Monime inbox.
-- Review records only; this migration intentionally has no wallet/payment/payout settlement path.
begin;

alter table public.matmove_admin_monime_webhook_events
  add column if not exists review_state text not null default 'unreviewed',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text;

alter table public.matmove_admin_monime_webhook_events
  drop constraint if exists matmove_admin_monime_webhook_events_review_state_check;

alter table public.matmove_admin_monime_webhook_events
  add constraint matmove_admin_monime_webhook_events_review_state_check
  check (review_state in ('unreviewed','reviewed'));

alter table public.matmove_admin_monime_webhook_events
  drop constraint if exists matmove_admin_monime_webhook_events_review_fields_check;

alter table public.matmove_admin_monime_webhook_events
  add constraint matmove_admin_monime_webhook_events_review_fields_check
  check (
    (review_state = 'unreviewed' and reviewed_at is null and reviewed_by is null and review_note is null)
    or
    (review_state = 'reviewed' and reviewed_at is not null and reviewed_by is not null
      and review_note is not null and length(btrim(review_note)) between 3 and 1000)
  );

create index if not exists matmove_admin_monime_webhook_events_manual_review_idx
  on public.matmove_admin_monime_webhook_events (received_at)
  where status = 'failed' and review_state = 'unreviewed';

create or replace function public.matmove_admin_monime_webhook_mark_reviewed(
  p_event_id text,
  p_actor_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  v_event public.matmove_admin_monime_webhook_events%rowtype;
  v_note text := btrim(coalesce(p_note,''));
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'FORBIDDEN: Trusted Admin API required.';
  end if;

  if p_event_id is null or p_event_id !~ '^wke-[A-Za-z0-9_-]{1,120}$' then
    raise exception 'INVALID: A valid Monime event ID is required.';
  end if;

  if p_actor_id is null or length(v_note) not between 3 and 1000 then
    raise exception 'INVALID: A staff identity and review note of 3 to 1000 characters are required.';
  end if;

  if not exists (
    select 1
    from public.matmove_staff_access a
    where a.id = p_actor_id
      and a.is_active = true
      and a.removed_at is null
      and (a.is_owner = true or a.permissions ? 'transactions')
  ) then
    raise exception 'FORBIDDEN: An active staff assignment with Transactions access is required.';
  end if;

  select * into v_event
  from public.matmove_admin_monime_webhook_events
  where event_id = p_event_id
    and status = 'failed'
    and review_state = 'unreviewed'
  for update;

  if not found then
    raise exception 'NOT_FOUND: An unreviewed failed event was not found.';
  end if;

  update public.matmove_admin_monime_webhook_events
  set review_state = 'reviewed',
      reviewed_at = clock_timestamp(),
      reviewed_by = p_actor_id,
      review_note = v_note,
      updated_at = clock_timestamp()
  where event_id = p_event_id
  returning * into v_event;

  return jsonb_build_object(
    'reviewed', true,
    'eventId', v_event.event_id,
    'eventType', v_event.event_type,
    'reviewState', v_event.review_state,
    'reviewedAt', v_event.reviewed_at,
    'reviewedBy', v_event.reviewed_by
  );
end;
$function$;

revoke all on function public.matmove_admin_monime_webhook_mark_reviewed(text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.matmove_admin_monime_webhook_mark_reviewed(text,uuid,text)
  to service_role;

-- The queue remains inaccessible to browser roles. All review reads/writes pass
-- through an Admin-authenticated server API using the service-role client.
alter table public.matmove_admin_monime_webhook_events enable row level security;
revoke all on table public.matmove_admin_monime_webhook_events
  from public, anon, authenticated;
grant select, insert, update on table public.matmove_admin_monime_webhook_events
  to service_role;

notify pgrst, 'reload schema';
commit;
