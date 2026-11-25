begin;

-- Removing one's own device token is safe for any authenticated account.
-- Registration remains restricted to active MatMove customer roles, but
-- sign-out cleanup must still work if an account is demoted or its role changes.
create or replace function public.matmove_unregister_push_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'private'
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH: Sign in before updating phone notifications.';
  end if;

  if p_token is null
     or length(btrim(p_token)) not between 24 and 300
     or btrim(p_token) !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,255}\]$' then
    raise exception 'INVALID: The device notification token is invalid.';
  end if;

  -- Even a non-customer account can remove only its own device association.
  delete from private.matmove_push_tokens
  where user_id = v_user_id
    and expo_push_token = btrim(p_token);

  return jsonb_build_object('user_id', v_user_id, 'unregistered', true);
end;
$function$;

revoke all on function public.matmove_unregister_push_token(text)
  from public, anon;
grant execute on function public.matmove_unregister_push_token(text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
