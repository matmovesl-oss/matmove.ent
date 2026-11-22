
create or replace function public.matmove_notification_can_read_message(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = 'pg_catalog','public'
as $function$
  select auth.uid() is not null and exists(
    select 1 from public.matmove_notification_inbox i
    where i.message_id=p_message_id and i.user_id=auth.uid()
  );
$function$;
revoke all on function public.matmove_notification_can_read_message(uuid) from public,anon;
grant execute on function public.matmove_notification_can_read_message(uuid) to authenticated;

drop policy if exists matmove_notification_messages_recipient_read on public.matmove_notification_messages;
create policy matmove_notification_messages_recipient_read
  on public.matmove_notification_messages
  for select to authenticated
  using (public.matmove_notification_can_read_message(id));

notify pgrst,'reload schema';
