-- Fix ambiguous PL/pgSQL record and table aliases in the admin deletion queue.
-- This only repairs request listing/review; it does not erase customer or financial records.
create or replace function public.matmove_admin_account_deletion_requests(
  p_action text default 'list',
  p_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid := auth.uid();
  request_row public.matmove_account_deletion_requests%rowtype;
  rows jsonb;
begin
  if actor is null or not exists (
    select 1 from public.matmove_staff_access sa
    where sa.id = actor and sa.is_owner and sa.is_active and sa.removed_at is null
  ) then
    raise exception 'FORBIDDEN: Only the verified owner can review account deletion requests.';
  end if;

  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.requested_at desc), '[]'::jsonb)
      into rows
    from (
      select dr.id, dr.user_id, dr.reason, dr.status, dr.requested_at,
             dr.reviewed_at, dr.reviewed_by, dr.review_note,
             profile.full_name, profile.email, profile.phone, profile.role
      from public.matmove_account_deletion_requests dr
      join public.profiles profile on profile.id = dr.user_id
      order by dr.requested_at desc
      limit 250
    ) q;
    return jsonb_build_object('rows', rows);
  end if;

  if p_action not in ('under_review','reject')
     or p_user_id is null
     or p_note is null
     or length(btrim(p_note)) < 3
     or length(p_note) > 500 then
    raise exception 'INVALID: Enter a valid review action and note.';
  end if;

  select dr.* into request_row
  from public.matmove_account_deletion_requests dr
  where dr.user_id = p_user_id
    and dr.status in ('requested','under_review')
  order by dr.requested_at desc
  limit 1
  for update;

  if not found then
    raise exception 'NOT_FOUND: Open account deletion request not found.';
  end if;

  update public.matmove_account_deletion_requests
  set status = case when p_action = 'reject' then 'rejected' else 'under_review' end,
      reviewed_at = clock_timestamp(),
      reviewed_by = actor,
      review_note = btrim(p_note)
  where id = request_row.id
  returning * into request_row;

  if p_action = 'reject' then
    update public.profiles
    set account_deletion_requested_at = null,
        updated_at = clock_timestamp()
    where id = p_user_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'userId', p_user_id,
    'status', request_row.status,
    'requestId', request_row.id
  );
end;
$function$;

revoke all on function public.matmove_admin_account_deletion_requests(text, uuid, text) from public, anon;
grant execute on function public.matmove_admin_account_deletion_requests(text, uuid, text) to authenticated;
