
drop policy if exists matmove_notification_messages_recipient_read on public.matmove_notification_messages;
create policy matmove_notification_messages_recipient_read
  on public.matmove_notification_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.matmove_notification_inbox i
      where i.message_id=matmove_notification_messages.id
        and i.user_id=auth.uid()
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='matmove_notification_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.matmove_notification_messages';
  end if;
end $$;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='concierge_services_requires_a_price') then
    alter table public.concierge_services
      add constraint concierge_services_requires_a_price
      check (nullif(btrim(price_label),'') is not null or price_sle is not null or price_usd is not null);
  end if;
end $$;

create or replace function public.matmove_customer_request_account_deletion(p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  uid uuid:=auth.uid();
  existing public.matmove_account_deletion_requests%rowtype;
  request_row public.matmove_account_deletion_requests%rowtype;
begin
  if uid is null then raise exception 'FORBIDDEN: Sign in before requesting account deletion.'; end if;
  if not exists(select 1 from public.profiles where id=uid and role::text in ('rider','driver','merchant')) then
    raise exception 'FORBIDDEN: An active Customer account is required.';
  end if;
  if exists(select 1 from public.matmove_staff_access where id=uid and is_active and removed_at is null) then
    raise exception 'FORBIDDEN: Admin access must be removed before requesting Customer account deletion.';
  end if;
  if exists(select 1 from public.profiles where id=uid and is_payroll_staff) then
    raise exception 'CONFLICT: Ask the MatMove owner to remove your Payroll eligibility before requesting account closure.';
  end if;
  if p_reason is null or length(btrim(p_reason))>500 then
    raise exception 'INVALID: Enter a reason up to 500 characters.';
  end if;

  if exists(select 1 from public.wallets where user_id=uid and (balance<>0 or reserved_balance<>0)) then
    raise exception 'CONFLICT: Settle or withdraw all SLE and USD wallet balances before requesting deletion.';
  end if;
  if exists(select 1 from public.bookings where (rider_id=uid or driver_id=uid) and status in ('pending','pending_admin','accepted','in_progress')) then
    raise exception 'CONFLICT: Complete or resolve active trips before requesting deletion.';
  end if;
  if exists(select 1 from public.withdrawal_requests where user_id=uid and lower(coalesce(status,'')) in ('pending','processing','initiating','review_required')) then
    raise exception 'CONFLICT: A withdrawal is still pending. Wait until it is resolved before requesting deletion.';
  end if;
  if exists(select 1 from public.matmove_withdrawals where user_id=uid and lower(coalesce(state,'')) in ('pending','processing','initiating','review_required')) then
    raise exception 'CONFLICT: A withdrawal is still pending. Wait until it is resolved before requesting deletion.';
  end if;
  if exists(select 1 from public.payment_transactions where user_id=uid and lower(coalesce(status,'')) in ('pending','processing','initiating')) then
    raise exception 'CONFLICT: A payment is still pending. Wait until it is resolved before requesting deletion.';
  end if;
  if exists(select 1 from public.app_orders where (rider_id=uid or merchant_id=uid) and lower(coalesce(status,'')) in ('pending','processing','in_progress')) then
    raise exception 'CONFLICT: An in-progress order must be resolved before requesting deletion.';
  end if;
  if exists(select 1 from public.products where merchant_id=uid and deleted_at is null and is_available=true) then
    raise exception 'CONFLICT: Remove or mark all active Merchant listings unavailable before requesting account closure.';
  end if;

  select * into existing from public.matmove_account_deletion_requests
  where user_id=uid and status in ('requested','under_review')
  order by requested_at desc limit 1;
  if found then
    return jsonb_build_object('success',true,'requestId',existing.id,'status',existing.status,'alreadyRequested',true);
  end if;

  insert into public.matmove_account_deletion_requests(user_id,reason)
  values(uid,btrim(p_reason))
  returning * into request_row;

  update public.profiles
  set account_deletion_requested_at=request_row.requested_at,updated_at=clock_timestamp()
  where id=uid;

  return jsonb_build_object('success',true,'requestId',request_row.id,'status',request_row.status,'alreadyRequested',false);
end;
$function$;
revoke all on function public.matmove_customer_request_account_deletion(text) from public,anon;
grant execute on function public.matmove_customer_request_account_deletion(text) to authenticated;

notify pgrst,'reload schema';
