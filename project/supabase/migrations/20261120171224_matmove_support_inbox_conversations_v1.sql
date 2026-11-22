
begin;

create table if not exists public.matmove_support_conversations (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  customer_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  subject text not null check (length(btrim(subject)) between 3 and 100),
  category text not null check (category in ('account','wallet','ride','delivery','merchant','other')),
  status text not null default 'open' check (status in ('open','in_review','waiting_customer','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_message_at timestamptz not null default clock_timestamp(),
  unique(customer_id, request_key)
);

create table if not exists public.matmove_support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.matmove_support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  sender_type text not null check (sender_type in ('customer','admin')),
  request_key uuid not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(conversation_id, sender_id, request_key)
);

create index if not exists matmove_support_conversations_customer_updated_idx
  on public.matmove_support_conversations(customer_id, last_message_at desc);
create index if not exists matmove_support_conversations_status_updated_idx
  on public.matmove_support_conversations(status, last_message_at desc);
create index if not exists matmove_support_messages_conversation_created_idx
  on public.matmove_support_messages(conversation_id, created_at, id);
create index if not exists matmove_support_messages_unread_idx
  on public.matmove_support_messages(conversation_id, sender_type, read_at)
  where read_at is null;

alter table public.matmove_support_conversations enable row level security;
alter table public.matmove_support_messages enable row level security;
revoke all on public.matmove_support_conversations from public, anon, authenticated;
revoke all on public.matmove_support_messages from public, anon, authenticated;
grant select on public.matmove_support_conversations to authenticated;
grant select on public.matmove_support_messages to authenticated;

drop policy if exists matmove_support_conversations_read_own_or_support on public.matmove_support_conversations;
create policy matmove_support_conversations_read_own_or_support
  on public.matmove_support_conversations
  for select to authenticated
  using (customer_id = (select auth.uid()) or public.matmove_admin_can('support'));

drop policy if exists matmove_support_messages_read_own_or_support on public.matmove_support_messages;
create policy matmove_support_messages_read_own_or_support
  on public.matmove_support_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.matmove_support_conversations c
      where c.id = conversation_id
        and (c.customer_id = (select auth.uid()) or public.matmove_admin_can('support'))
    )
  );

create or replace function public.matmove_support_customer_actor()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.matmove_notification_customer(actor) then
    raise exception 'ACCESS: A verified MatMove customer account is required.';
  end if;
  return actor;
end;
$function$;

create or replace function public.matmove_support_admin_actor()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.matmove_admin_can('support') then
    raise exception 'ACCESS: Customer Support assignment required.';
  end if;
  return actor;
end;
$function$;

create or replace function public.matmove_support_customer_list()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare actor uuid := public.matmove_support_customer_actor(); items jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',c.id,
      'ticket_number',c.ticket_number::text,
      'subject',c.subject,
      'category',c.category,
      'status',c.status,
      'created_at',c.created_at,
      'updated_at',c.updated_at,
      'last_message_at',c.last_message_at,
      'last_message',coalesce((
        select m.body from public.matmove_support_messages m
        where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1
      ),''),
      'unread_count',(
        select count(*) from public.matmove_support_messages m
        where m.conversation_id=c.id and m.sender_type='admin' and m.read_at is null
      )
    ) order by c.last_message_at desc,c.ticket_number desc
  ),'[]'::jsonb)
  into items
  from public.matmove_support_conversations c
  where c.customer_id=actor;
  return jsonb_build_object('user_id',actor,'items',items);
end;
$function$;

create or replace function public.matmove_support_customer_open(
  p_request_key uuid,
  p_subject text,
  p_category text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid := public.matmove_support_customer_actor();
  clean_subject text := btrim(p_subject);
  clean_body text := btrim(p_body);
  c public.matmove_support_conversations%rowtype;
  m public.matmove_support_messages%rowtype;
begin
  if p_request_key is null
    or clean_subject is null or length(clean_subject) not between 3 and 100
    or clean_body is null or length(clean_body) not between 1 and 2000
    or p_category not in ('account','wallet','ride','delivery','merchant','other') then
    raise exception 'INVALID: Check the support subject, category and message.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_key::text,0));
  select * into c from public.matmove_support_conversations
  where customer_id=actor and request_key=p_request_key;
  if found then
    select * into m from public.matmove_support_messages
    where conversation_id=c.id and sender_id=actor and request_key=p_request_key;
    if c.subject is distinct from clean_subject or c.category is distinct from p_category
      or m.body is distinct from clean_body then
      raise exception 'CONFLICT: This support request key belongs to a different message.';
    end if;
    return jsonb_build_object(
      'conversation',jsonb_build_object('id',c.id,'ticket_number',c.ticket_number::text,'subject',c.subject,'category',c.category,'status',c.status),
      'message',jsonb_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at)
    );
  end if;

  insert into public.matmove_support_conversations(customer_id,request_key,subject,category)
  values(actor,p_request_key,clean_subject,p_category)
  returning * into c;

  insert into public.matmove_support_messages(conversation_id,sender_id,sender_type,request_key,body)
  values(c.id,actor,'customer',p_request_key,clean_body)
  returning * into m;

  return jsonb_build_object(
    'conversation',jsonb_build_object('id',c.id,'ticket_number',c.ticket_number::text,'subject',c.subject,'category',c.category,'status',c.status),
    'message',jsonb_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at)
  );
end;
$function$;

create or replace function public.matmove_support_customer_message(
  p_conversation_id uuid,
  p_request_key uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid := public.matmove_support_customer_actor();
  clean_body text := btrim(p_body);
  c public.matmove_support_conversations%rowtype;
  m public.matmove_support_messages%rowtype;
begin
  if p_conversation_id is null or p_request_key is null
    or clean_body is null or length(clean_body) not between 1 and 2000 then
    raise exception 'INVALID: Enter a message of up to 2,000 characters.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text||':'||p_request_key::text,0));
  select * into c from public.matmove_support_conversations
  where id=p_conversation_id and customer_id=actor for update;
  if not found then raise exception 'NOT_FOUND: This support conversation is unavailable.'; end if;

  select * into m from public.matmove_support_messages
  where conversation_id=c.id and sender_id=actor and request_key=p_request_key;
  if found then
    if m.body is distinct from clean_body then
      raise exception 'CONFLICT: This message request key belongs to different content.';
    end if;
    return jsonb_build_object('id',m.id,'conversation_id',c.id,'created_at',m.created_at);
  end if;

  insert into public.matmove_support_messages(conversation_id,sender_id,sender_type,request_key,body)
  values(c.id,actor,'customer',p_request_key,clean_body)
  returning * into m;

  update public.matmove_support_conversations
  set status='open',last_message_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=c.id;

  return jsonb_build_object('id',m.id,'conversation_id',c.id,'created_at',m.created_at);
end;
$function$;

create or replace function public.matmove_support_customer_messages(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid := public.matmove_support_customer_actor();
  c public.matmove_support_conversations%rowtype;
  items jsonb;
begin
  select * into c from public.matmove_support_conversations
  where id=p_conversation_id and customer_id=actor;
  if not found then raise exception 'NOT_FOUND: This support conversation is unavailable.'; end if;

  update public.matmove_support_messages
  set read_at=clock_timestamp()
  where conversation_id=c.id and sender_type='admin' and read_at is null;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at,'read_at',m.read_at)
    order by m.created_at,m.id
  ),'[]'::jsonb)
  into items
  from public.matmove_support_messages m where m.conversation_id=c.id;

  return jsonb_build_object(
    'conversation',jsonb_build_object('id',c.id,'ticket_number',c.ticket_number::text,'subject',c.subject,'category',c.category,'status',c.status,'created_at',c.created_at,'last_message_at',c.last_message_at),
    'messages',items
  );
end;
$function$;

create or replace function public.matmove_support_admin_list(p_status text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare actor uuid := public.matmove_support_admin_actor(); items jsonb;
begin
  if p_status is null or p_status not in ('all','open','in_review','waiting_customer','resolved') then
    raise exception 'INVALID: Choose a valid support status.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',c.id,
      'ticket_number',c.ticket_number::text,
      'customer_id',c.customer_id,
      'customer_name',coalesce(
        nullif(to_jsonb(p)->>'full_name',''),
        nullif(trim(concat_ws(' ',to_jsonb(p)->>'first_name',to_jsonb(p)->>'last_name')),''),
        u.email,
        'MatMove customer'
      ),
      'customer_email',u.email,
      'customer_phone',coalesce(to_jsonb(p)->>'phone',to_jsonb(p)->>'phone_number',to_jsonb(u)->>'phone'),
      'subject',c.subject,
      'category',c.category,
      'status',c.status,
      'created_at',c.created_at,
      'updated_at',c.updated_at,
      'last_message_at',c.last_message_at,
      'last_message',coalesce((
        select m.body from public.matmove_support_messages m
        where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1
      ),''),
      'unread_count',(
        select count(*) from public.matmove_support_messages m
        where m.conversation_id=c.id and m.sender_type='customer' and m.read_at is null
      )
    ) order by c.last_message_at desc,c.ticket_number desc
  ),'[]'::jsonb)
  into items
  from public.matmove_support_conversations c
  left join public.profiles p on p.id=c.customer_id
  left join auth.users u on u.id=c.customer_id
  where p_status='all' or c.status=p_status;

  return jsonb_build_object('actor_id',actor,'items',items);
end;
$function$;

create or replace function public.matmove_support_admin_messages(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid := public.matmove_support_admin_actor();
  c public.matmove_support_conversations%rowtype;
  items jsonb;
begin
  select * into c from public.matmove_support_conversations where id=p_conversation_id;
  if not found then raise exception 'NOT_FOUND: Support conversation not found.'; end if;

  update public.matmove_support_messages
  set read_at=clock_timestamp()
  where conversation_id=c.id and sender_type='customer' and read_at is null;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',m.id,'sender_type',m.sender_type,'body',m.body,'created_at',m.created_at,'read_at',m.read_at)
    order by m.created_at,m.id
  ),'[]'::jsonb)
  into items
  from public.matmove_support_messages m where m.conversation_id=c.id;

  return jsonb_build_object('actor_id',actor,'conversation',jsonb_build_object(
    'id',c.id,'ticket_number',c.ticket_number::text,'customer_id',c.customer_id,
    'subject',c.subject,'category',c.category,'status',c.status
  ),'messages',items);
end;
$function$;

create or replace function public.matmove_support_admin_reply(
  p_conversation_id uuid,
  p_request_key uuid,
  p_body text,
  p_status text default 'waiting_customer'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor uuid := public.matmove_support_admin_actor();
  clean_body text := btrim(p_body);
  c public.matmove_support_conversations%rowtype;
  m public.matmove_support_messages%rowtype;
begin
  if p_conversation_id is null or p_request_key is null
    or clean_body is null or length(clean_body) not between 1 and 2000
    or p_status not in ('waiting_customer','resolved') then
    raise exception 'INVALID: Enter a reply and choose a valid status.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text||':'||actor::text||':'||p_request_key::text,0));
  select * into c from public.matmove_support_conversations where id=p_conversation_id for update;
  if not found then raise exception 'NOT_FOUND: Support conversation not found.'; end if;

  select * into m from public.matmove_support_messages
  where conversation_id=c.id and sender_id=actor and request_key=p_request_key;
  if found then
    if m.body is distinct from clean_body then
      raise exception 'CONFLICT: This reply request key belongs to different content.';
    end if;
    return jsonb_build_object('id',m.id,'conversation_id',c.id,'status',c.status,'created_at',m.created_at);
  end if;

  insert into public.matmove_support_messages(conversation_id,sender_id,sender_type,request_key,body)
  values(c.id,actor,'admin',p_request_key,clean_body)
  returning * into m;

  update public.matmove_support_conversations
  set status=p_status,last_message_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=c.id;

  return jsonb_build_object('id',m.id,'conversation_id',c.id,'status',p_status,'created_at',m.created_at);
end;
$function$;

create or replace function public.matmove_support_admin_status(
  p_conversation_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare actor uuid := public.matmove_support_admin_actor(); c public.matmove_support_conversations%rowtype;
begin
  if p_conversation_id is null or p_status not in ('open','in_review','waiting_customer','resolved') then
    raise exception 'INVALID: Choose a valid support status.';
  end if;
  update public.matmove_support_conversations
  set status=p_status,updated_at=clock_timestamp()
  where id=p_conversation_id
  returning * into c;
  if not found then raise exception 'NOT_FOUND: Support conversation not found.'; end if;
  return jsonb_build_object('id',c.id,'ticket_number',c.ticket_number::text,'status',c.status,'updated_at',c.updated_at);
end;
$function$;

-- Only the dedicated Support assignment can use the support RPCs.
revoke all on function public.matmove_support_customer_actor() from public, anon, authenticated;
revoke all on function public.matmove_support_admin_actor() from public, anon, authenticated;
revoke all on function public.matmove_support_customer_list() from public, anon, authenticated;
revoke all on function public.matmove_support_customer_open(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.matmove_support_customer_message(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.matmove_support_customer_messages(uuid) from public, anon, authenticated;
revoke all on function public.matmove_support_admin_list(text) from public, anon, authenticated;
revoke all on function public.matmove_support_admin_messages(uuid) from public, anon, authenticated;
revoke all on function public.matmove_support_admin_reply(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.matmove_support_admin_status(uuid,text) from public, anon, authenticated;

grant execute on function public.matmove_support_customer_list() to authenticated;
grant execute on function public.matmove_support_customer_open(uuid,text,text,text) to authenticated;
grant execute on function public.matmove_support_customer_message(uuid,uuid,text) to authenticated;
grant execute on function public.matmove_support_customer_messages(uuid) to authenticated;
grant execute on function public.matmove_support_admin_list(text) to authenticated;
grant execute on function public.matmove_support_admin_messages(uuid) to authenticated;
grant execute on function public.matmove_support_admin_reply(uuid,uuid,text,text) to authenticated;
grant execute on function public.matmove_support_admin_status(uuid,text) to authenticated;

create or replace function public.matmove_staff_permissions_valid(p_permissions jsonb)
returns boolean
language sql
immutable
set search_path=pg_catalog,public
as $permissions$
  select case
    when jsonb_typeof(p_permissions) is distinct from 'array' then false
    else
      jsonb_array_length(p_permissions) between 1 and 27
      and not exists (
        select 1 from jsonb_array_elements(p_permissions) e
        where jsonb_typeof(e)<>'string'
          or not (e#>>'{}'=any(array[
            'dashboard','dispatch','concierge','travel.overview','travel.manifest','travel.boarding','travel.payments',
            'events.overview','events.sales','events.checkin','pricing','kyc','customers','financials','special',
            'transactions','payouts','games.overview','games.players','games.entries','games.winnings','games.settings',
            'games.recovery','notifications','support','staff','logs'
          ]::text[]))
      )
      and (select count(distinct e) from jsonb_array_elements(p_permissions) e)=jsonb_array_length(p_permissions)
  end;
$permissions$;

revoke all on function public.matmove_staff_permissions_valid(jsonb) from public,anon,authenticated;

do $publication$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matmove_support_conversations') then
      alter publication supabase_realtime add table public.matmove_support_conversations;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matmove_support_messages') then
      alter publication supabase_realtime add table public.matmove_support_messages;
    end if;
  end if;
end;
$publication$;

notify pgrst,'reload schema';
commit;
