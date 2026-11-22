
alter table public.profiles
  add column if not exists is_payroll_staff boolean not null default false,
  add column if not exists account_deletion_requested_at timestamptz;

create index if not exists profiles_payroll_staff_idx
  on public.profiles (is_payroll_staff, created_at desc)
  where is_payroll_staff = true;

alter table public.products
  add column if not exists deleted_at timestamptz;

alter table public.matmove_notification_messages
  add column if not exists deleted_at timestamptz;

alter table public.concierge_services
  add column if not exists price_sle numeric(14,2),
  add column if not exists price_usd numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='concierge_services_price_sle_positive') then
    alter table public.concierge_services add constraint concierge_services_price_sle_positive
      check (price_sle is null or price_sle > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='concierge_services_price_usd_positive') then
    alter table public.concierge_services add constraint concierge_services_price_usd_positive
      check (price_usd is null or price_usd > 0);
  end if;
end $$;

-- Safely convert legacy payroll-only rows without changing normal Admin accounts.
update public.profiles p
set role = p.customer_onboarding_role,
    is_payroll_staff = true,
    updated_at = clock_timestamp()
where p.role::text = 'staff'
  and p.customer_onboarding_role in ('rider','driver','merchant')
  and not exists (select 1 from public.matmove_staff_access s where s.id=p.id)
  and not exists (select 1 from public.admins a where a.id=p.id);

create or replace function public.matmove_admin_set_staff_role(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_role text;
  v_original text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.matmove_staff_access
    where id=auth.uid() and is_owner and is_active and removed_at is null
  ) then
    raise exception 'FORBIDDEN: Only the verified owner can change payroll classification.';
  end if;

  select role::text into v_role
  from public.profiles
  where id=p_user_id
  for update;

  if not found then return false; end if;

  v_original := public.matmove_staff_resolve_customer_role(p_user_id);
  if v_original not in ('rider','driver','merchant') then
    raise exception 'CONFLICT: Original Customer role could not be verified.';
  end if;

  if v_role not in ('rider','driver','merchant','staff') then
    raise exception 'CONFLICT: Only a verified Customer account can be added to payroll.';
  end if;

  update public.profiles
  set role = case when role::text='staff' then v_original else role end,
      customer_onboarding_role = coalesce(customer_onboarding_role,v_original),
      is_payroll_staff = true,
      updated_at = clock_timestamp()
  where id=p_user_id;

  return true;
end;
$function$;

create or replace function public.matmove_admin_restore_customer_role(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  v_role text;
  v_current_role text;
  v_payroll boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.matmove_staff_access
    where id=auth.uid() and is_owner and is_active and removed_at is null
  ) then
    raise exception 'FORBIDDEN: Only the verified owner can restore a Customer role.';
  end if;

  if exists(select 1 from public.matmove_staff_access where id=p_user_id)
     or exists(select 1 from public.admins where id=p_user_id) then
    raise exception 'CONFLICT: This account has an Admin access record. Use Staff Governance to manage Admin access.';
  end if;

  select role::text,is_payroll_staff into v_current_role,v_payroll
  from public.profiles where id=p_user_id for update;

  if not found then
    raise exception 'NOT_FOUND: Customer profile not found.';
  end if;

  v_role:=public.matmove_staff_resolve_customer_role(p_user_id);
  if v_role not in ('rider','driver','merchant') then
    raise exception 'CONFLICT: Original Customer role cannot be verified. Manual support review is required.';
  end if;

  if not coalesce(v_payroll,false) and v_current_role<>'staff' then
    raise exception 'CONFLICT: This account is not classified as Payroll staff.';
  end if;

  update public.profiles
  set role=v_role,
      customer_onboarding_role=v_role,
      is_payroll_staff=false,
      updated_at=clock_timestamp()
  where id=p_user_id;

  insert into public.matmove_staff_audit(actor_id,target_id,action,details)
  values(auth.uid(),p_user_id,'RESTORE_STAFF',
    jsonb_build_object('restoredCustomerRole',v_role,'reason','Owner restored original Customer access'));

  return jsonb_build_object('success',true,'userId',p_user_id,'role',v_role,'isPayrollStaff',false);
end;
$function$;

revoke all on function public.matmove_admin_set_staff_role(uuid) from public, anon;
grant execute on function public.matmove_admin_set_staff_role(uuid) to authenticated;
revoke all on function public.matmove_admin_restore_customer_role(uuid) from public, anon;
grant execute on function public.matmove_admin_restore_customer_role(uuid) to authenticated;

-- Listing deletion is a reversible catalogue tombstone, not a physical row deletion.
drop policy if exists "Allow merchants to delete products" on public.products;
drop policy if exists matmove_catalog_delete on public.products;
drop policy if exists matmove_catalog_delete_scope on public.products;
drop policy if exists matmove_catalog_no_direct_delete on public.products;
create policy matmove_catalog_no_direct_delete
  on public.products as restrictive for delete to authenticated using (false);

create or replace function public.matmove_merchant_delete_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  p public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and role::text='merchant') then
    raise exception 'FORBIDDEN: A Merchant account is required.';
  end if;
  select * into p from public.products
  where id=p_product_id and merchant_id=auth.uid()
  for update;
  if not found then raise exception 'NOT_FOUND: Listing not found in your catalogue.'; end if;
  if p.deleted_at is not null then
    return jsonb_build_object('deleted',true,'productId',p.id,'version',p.catalog_version);
  end if;
  update public.products
  set is_available=false,
      deleted_at=clock_timestamp(),
      catalog_version=catalog_version+1,
      catalog_updated_at=clock_timestamp()
  where id=p_product_id and merchant_id=auth.uid()
  returning * into p;
  return jsonb_build_object('deleted',true,'productId',p.id,'version',p.catalog_version);
end;
$function$;
revoke all on function public.matmove_merchant_delete_product(uuid) from public, anon;
grant execute on function public.matmove_merchant_delete_product(uuid) to authenticated;

-- Admin notification deletion is global to every recipient, while the original message
-- and inbox rows remain available for audit and retention.
create or replace function public.matmove_admin_delete_notification(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid;
  changed uuid;
begin
  actor:=public.matmove_notification_sender();
  if p_id is null then raise exception 'INVALID: Select a notification.'; end if;
  update public.matmove_notification_messages
  set deleted_at=coalesce(deleted_at,clock_timestamp())
  where id=p_id
  returning id into changed;
  if changed is null then raise exception 'NOT_FOUND: Notification not found.'; end if;
  return jsonb_build_object('deleted',true,'messageId',changed,'deletedForAllRecipients',true);
end;
$function$;
revoke all on function public.matmove_admin_delete_notification(uuid) from public, anon;
grant execute on function public.matmove_admin_delete_notification(uuid) to authenticated;

create or replace function public.matmove_notifications(p_before bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  items jsonb;
  next_id bigint;
  has_more boolean;
  unread bigint;
  max_id bigint;
begin
  perform public.matmove_preferences_role(auth.uid());
  if not public.matmove_notification_customer(auth.uid()) then
    raise exception 'ACCESS: Customer account required.';
  end if;
  if p_before is not null and p_before<1 then raise exception 'INVALID: Invalid inbox page.'; end if;

  select count(*) filter(where i.read_at is null),max(i.id)
  into unread,max_id
  from public.matmove_notification_inbox i
  join public.matmove_notification_messages m on m.id=i.message_id
  where i.user_id=auth.uid() and m.deleted_at is null;

  select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text) order by x.id desc),'[]'::jsonb),min(x.id)
  into items,next_id
  from (
    select i.id,m.id message_id,m.title,m.body,m.destination,m.created_at,i.read_at
    from public.matmove_notification_inbox i
    join public.matmove_notification_messages m on m.id=i.message_id
    where i.user_id=auth.uid()
      and m.deleted_at is null
      and (p_before is null or i.id<p_before)
    order by i.id desc
    limit 30
  ) x;

  select exists(
    select 1
    from public.matmove_notification_inbox i
    join public.matmove_notification_messages m on m.id=i.message_id
    where i.user_id=auth.uid() and m.deleted_at is null and i.id<next_id
  ) into has_more;

  return jsonb_build_object(
    'user_id',auth.uid(),
    'items',items,
    'unread_count',unread::text,
    'observed_max_id',max_id::text,
    'next_before',case when has_more then next_id::text else null end
  );
end;
$function$;
revoke all on function public.matmove_notifications(bigint) from public, anon;
grant execute on function public.matmove_notifications(bigint) to authenticated;

create or replace function public.matmove_admin_notification_history(p_before timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid;
  items jsonb;
begin
  actor:=public.matmove_notification_sender();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb)
  into items
  from (
    select id,sender_id,request_key,audience,target_id,title,body,destination,recipient_count,created_at,deleted_at
    from public.matmove_notification_messages
    where p_before is null or created_at<p_before
    order by created_at desc,id
    limit 50
  ) x;
  return jsonb_build_object('actor_id',actor,'items',items);
end;
$function$;

-- Account deletion is an explicit, reviewable request. Historical financial rows stay intact.
create table if not exists public.matmove_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null default '',
  status text not null default 'requested'
    check(status in ('requested','under_review','rejected')),
  requested_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text
);
create unique index if not exists matmove_account_deletion_one_open
  on public.matmove_account_deletion_requests(user_id)
  where status in ('requested','under_review');
create index if not exists matmove_account_deletion_status_idx
  on public.matmove_account_deletion_requests(status,requested_at desc);
alter table public.matmove_account_deletion_requests enable row level security;
revoke all on public.matmove_account_deletion_requests from anon,authenticated;
grant select on public.matmove_account_deletion_requests to authenticated;
drop policy if exists matmove_account_deletion_own_read on public.matmove_account_deletion_requests;
create policy matmove_account_deletion_own_read
  on public.matmove_account_deletion_requests for select to authenticated
  using(user_id=auth.uid());

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
revoke all on function public.matmove_customer_request_account_deletion(text) from public, anon;
grant execute on function public.matmove_customer_request_account_deletion(text) to authenticated;

create or replace function public.matmove_admin_account_deletion_requests(
  p_action text default 'list',
  p_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public'
as $function$
declare
  actor uuid:=auth.uid();
  r public.matmove_account_deletion_requests%rowtype;
  rows jsonb;
begin
  if actor is null or not exists(
    select 1 from public.matmove_staff_access
    where id=actor and is_owner and is_active and removed_at is null
  ) then raise exception 'FORBIDDEN: Only the verified owner can review account deletion requests.'; end if;

  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.requested_at desc),'[]'::jsonb)
    into rows
    from (
      select r.id,r.user_id,r.reason,r.status,r.requested_at,r.reviewed_at,r.reviewed_by,r.review_note,
             p.full_name,p.email,p.phone,p.role
      from public.matmove_account_deletion_requests r
      join public.profiles p on p.id=r.user_id
      order by r.requested_at desc
      limit 250
    ) q;
    return jsonb_build_object('rows',rows);
  end if;

  if p_action not in ('under_review','reject') or p_user_id is null or p_note is null or length(btrim(p_note))<3 or length(p_note)>500 then
    raise exception 'INVALID: Enter a valid review action and note.';
  end if;

  select * into r from public.matmove_account_deletion_requests
  where user_id=p_user_id and status in ('requested','under_review')
  order by requested_at desc limit 1 for update;
  if not found then raise exception 'NOT_FOUND: Open account deletion request not found.'; end if;

  update public.matmove_account_deletion_requests
  set status=case when p_action='reject' then 'rejected' else 'under_review' end,
      reviewed_at=clock_timestamp(),
      reviewed_by=actor,
      review_note=btrim(p_note)
  where id=r.id returning * into r;

  if p_action='reject' then
    update public.profiles set account_deletion_requested_at=null,updated_at=clock_timestamp()
    where id=p_user_id;
  end if;

  return jsonb_build_object('success',true,'userId',p_user_id,'status',r.status,'requestId',r.id);
end;
$function$;
revoke all on function public.matmove_admin_account_deletion_requests(text,uuid,text) from public, anon;
grant execute on function public.matmove_admin_account_deletion_requests(text,uuid,text) to authenticated;

-- Concierge services can display a quote in one or both supported currencies.
create or replace function public.matmove_admin_concierge(
  p_actor uuid,p_action text,p_key uuid,p_id uuid,p_expected bigint,p_data jsonb,p_page integer
)
returns jsonb
language plpgsql
set search_path = 'pg_catalog'
as $function$
declare
  s public.concierge_services%rowtype;
  old_s public.concierge_services%rowtype;
  e public.concierge_interests%rowtype;
  j public.matmove_concierge_mutations%rowtype;
  result jsonb;
  rows jsonb;
begin
  if not exists(
    select 1 from public.matmove_staff_access
    where id=p_actor and is_active and removed_at is null and (is_owner or permissions ? 'concierge')
  ) then raise exception 'FORBIDDEN: Concierge assignment required.'; end if;

  if p_action='services' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order,q.id),'[]') into rows
    from (
      select id,slug,title,category,description,price_label,price_sle,price_usd,is_active,display_order,version,deleted_at
      from public.concierge_services order by display_order,id limit 501
    ) q;
    return jsonb_build_object('rows',rows,'truncated',jsonb_array_length(rows)>500);
  elsif p_action='enquiries' then
    if p_page is null or p_page not between 0 and 10000 then raise exception 'INVALID: Invalid page.'; end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') into rows
    from (
      select id,service_title,price_label_snapshot,customer_name,customer_email,customer_phone,message,status,version,created_at
      from public.concierge_interests order by created_at desc,id limit 51 offset p_page*50
    ) q;
    return jsonb_build_object('rows',rows,'hasMore',jsonb_array_length(rows)>50,'page',p_page);
  end if;

  if p_action not in ('save','archive','status') or p_key is null or p_id is null or p_expected is null or p_expected<0 or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'INVALID: Invalid Concierge change.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('concierge:'||p_key::text,0));
  select * into j from public.matmove_concierge_mutations where request_key=p_key;
  if found then
    if j.actor_id<>p_actor or j.action<>p_action or j.target_id<>p_id or j.payload<>jsonb_build_object('version',p_expected,'data',p_data) then
      raise exception 'CONFLICT: Original request changed.';
    end if;
    return j.response;
  end if;

  if p_action='status' then
    if (select count(*) from jsonb_object_keys(p_data))<>1 or p_data->>'status' not in ('new','contacted','in_progress','completed','cancelled') then
      raise exception 'INVALID: Invalid enquiry status.';
    end if;
    select * into e from public.concierge_interests where id=p_id for update;
    if not found or e.version<>p_expected then raise exception 'CONFLICT: Reload the enquiry before editing.'; end if;
    update public.concierge_interests
    set status=p_data->>'status',version=version+1,updated_at=clock_timestamp()
    where id=p_id returning * into e;
    result=jsonb_build_object('id',e.id,'version',e.version,'status',e.status);
  else
    select * into s from public.concierge_services where id=p_id for update;
    old_s=s;
    if (s.id is null and p_expected<>0) or (s.id is not null and s.version<>p_expected) then
      raise exception 'CONFLICT: Reload the service before editing.';
    end if;

    if p_action='archive' then
      if s.id is null then raise exception 'INVALID: Service missing.'; end if;
      update public.concierge_services
      set is_active=false,deleted_at=coalesce(deleted_at,clock_timestamp()),
          version=version+1,updated_at=clock_timestamp(),updated_by=p_actor
      where id=p_id returning * into s;
    else
      if (select count(*) from jsonb_object_keys(p_data))<>9
         or not(p_data ?& array['slug','title','category','description','price_label','price_sle','price_usd','is_active','display_order'])
         or jsonb_typeof(p_data->'is_active')<>'boolean'
         or jsonb_typeof(p_data->'display_order')<>'number'
         or (p_data->>'display_order')!~'^[0-9]{1,5}$'
         or not (jsonb_typeof(p_data->'price_sle') in ('number','null'))
         or not (jsonb_typeof(p_data->'price_usd') in ('number','null')) then
        raise exception 'INVALID: Invalid service fields.';
      end if;
      if (p_data->>'price_sle') is not null and ((p_data->>'price_sle')!~'^\d{1,12}(\.\d{1,2})?$' or (p_data->>'price_sle')::numeric<=0) then
        raise exception 'INVALID: Enter a positive SLE quote.';
      end if;
      if (p_data->>'price_usd') is not null and ((p_data->>'price_usd')!~'^\d{1,12}(\.\d{1,2})?$' or (p_data->>'price_usd')::numeric<=0) then
        raise exception 'INVALID: Enter a positive USD quote.';
      end if;
      if s.id is not null and (s.slug<>p_data->>'slug' or s.deleted_at is not null) then
        raise exception 'CONFLICT: Archived services and original slugs are immutable.';
      end if;
      if s.id is null then
        insert into public.concierge_services(
          id,slug,title,category,description,price_label,price_sle,price_usd,is_active,display_order,created_by,updated_by
        ) values(
          p_id,p_data->>'slug',btrim(p_data->>'title'),btrim(p_data->>'category'),p_data->>'description',
          btrim(p_data->>'price_label'),nullif(p_data->>'price_sle','')::numeric,nullif(p_data->>'price_usd','')::numeric,
          (p_data->>'is_active')::boolean,(p_data->>'display_order')::integer,p_actor,p_actor
        ) returning * into s;
      else
        update public.concierge_services
        set title=btrim(p_data->>'title'),category=btrim(p_data->>'category'),description=p_data->>'description',
            price_label=btrim(p_data->>'price_label'),
            price_sle=nullif(p_data->>'price_sle','')::numeric,
            price_usd=nullif(p_data->>'price_usd','')::numeric,
            is_active=(p_data->>'is_active')::boolean,display_order=(p_data->>'display_order')::integer,
            version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
        where id=p_id returning * into s;
      end if;
    end if;

    insert into public.concierge_service_audit(service_id,actor_id,action,before_data,after_data)
    values(p_id,p_actor,case when old_s.id is null then 'created' when p_action='archive' then 'deleted' else 'updated' end,
      case when old_s.id is null then null else to_jsonb(old_s) end,to_jsonb(s));
    result=jsonb_build_object('id',s.id,'version',s.version,'archived',s.deleted_at is not null,'deleted',s.deleted_at is not null);
  end if;

  insert into public.matmove_concierge_mutations
  values(p_key,p_actor,p_action,p_id,jsonb_build_object('version',p_expected,'data',p_data),result,clock_timestamp());
  return result;
end;
$function$;

create or replace function public.matmove_customer_concierge_enquiry(
  p_service uuid,p_expected bigint,p_key uuid,p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  uid uuid:=(select auth.uid());
  s public.concierge_services%rowtype;
  e public.concierge_interests%rowtype;
  p jsonb;
  email text;
  snapshot text;
begin
  if uid is null
     or not exists(select 1 from public.profiles where id=uid and role::text in ('rider','driver','merchant'))
     or exists(select 1 from public.matmove_staff_access where id=uid and is_active and removed_at is null) then
    raise exception 'FORBIDDEN: Customer account required.';
  end if;
  if p_key is null or p_message is null or length(p_message)>1000 then
    raise exception 'INVALID: Enter a message up to 1000 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('concierge-customer:'||uid::text,0));
  select * into e from public.concierge_interests where customer_id=uid and request_key=p_key;
  if found then
    if e.service_id<>p_service or e.message<>btrim(p_message) then raise exception 'CONFLICT: Original enquiry changed.'; end if;
    return jsonb_build_object('id',e.id,'status',e.status,'serviceTitle',e.service_title);
  end if;
  if (select count(*) from public.concierge_interests where customer_id=uid and created_at>now()-interval '1 hour')>=5 then
    raise exception 'LIMIT: Please wait before sending more enquiries.';
  end if;
  select * into s from public.concierge_services
  where id=p_service and is_active and deleted_at is null for share;
  if not found or s.version<>p_expected then raise exception 'CONFLICT: This service changed. Reload the services.'; end if;
  select to_jsonb(pr) into p from public.profiles pr where id=uid;
  select u.email into email from auth.users u where u.id=uid;
  snapshot:=coalesce(nullif(s.price_label,''),'')
    ||case when s.price_sle is not null then ' · SLE '||to_char(s.price_sle,'FM999999999990.00') else '' end
    ||case when s.price_usd is not null then ' · USD '||to_char(s.price_usd,'FM999999999990.00') else '' end;
  insert into public.concierge_interests(
    service_id,service_slug,service_title,price_label_snapshot,customer_id,customer_name,customer_email,customer_phone,message,request_key
  ) values(
    s.id,s.slug,s.title,snapshot,uid,coalesce(p->>'full_name',p->>'first_name',''),coalesce(email,''),
    coalesce(p->>'phone',p->>'phone_number',''),btrim(p_message),p_key
  ) returning * into e;
  return jsonb_build_object('id',e.id,'status',e.status,'serviceTitle',e.service_title,'priceSnapshot',e.price_label_snapshot);
end;
$function$;

-- Keep privileged endpoints authenticated only.
revoke all on function public.matmove_admin_concierge(uuid,text,uuid,uuid,bigint,jsonb,integer) from public,anon;
grant execute on function public.matmove_admin_concierge(uuid,text,uuid,uuid,bigint,jsonb,integer) to authenticated;
revoke all on function public.matmove_customer_concierge_enquiry(uuid,bigint,uuid,text) from public,anon;
grant execute on function public.matmove_customer_concierge_enquiry(uuid,bigint,uuid,text) to authenticated;

notify pgrst, 'reload schema';
