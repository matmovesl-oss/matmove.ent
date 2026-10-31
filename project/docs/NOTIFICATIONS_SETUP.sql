
-- MatMove in-app messages: run this COMPLETE SQL in the ONE shared project.
-- Existing accounts only; no email/SMS, money movement or KYC changes.
-- New 'notifications' assignment is separate from customer/staff management.
begin;
do $preflight$ begin
 if to_regprocedure('public.matmove_preferences_role(uuid)') is null
 or to_regclass('public.matmove_staff_access') is null then
  raise exception 'Run PORTAL_HOME_SETUP.sql and the current staff setup first.';
 end if;
end $preflight$;
create table if not exists public.matmove_notification_messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references auth.users(id),
 request_key uuid not null,
 audience text not null check(audience in ('all','rider','driver','merchant','user')),
 target_id uuid references auth.users(id),
 title text not null check(length(title) between 1 and 100),
 body text not null check(length(body) between 1 and 2000),
 destination text check(destination in ('home','wallet','trips','games','account','kyc')),
 recipient_count integer not null default 0 check(recipient_count>=0),
 created_at timestamptz not null default now(),
 unique(sender_id,request_key),
 check((audience='user')=(target_id is not null))
);
create table if not exists public.matmove_notification_inbox (
 id bigint generated always as identity primary key,
 message_id uuid not null references public.matmove_notification_messages(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 read_at timestamptz,
 unique(message_id,user_id)
);
create index if not exists matmove_notification_inbox_owner on public.matmove_notification_inbox(user_id,id desc);
create index if not exists matmove_notification_unread on public.matmove_notification_inbox(user_id) where read_at is null;
alter table public.matmove_notification_messages enable row level security;
alter table public.matmove_notification_inbox enable row level security;
revoke all on public.matmove_notification_messages,public.matmove_notification_inbox from public,anon,authenticated;
revoke all on sequence public.matmove_notification_inbox_id_seq from public,anon,authenticated;

-- Never trust a sender ID or staff privileges supplied by the browser.
create or replace function public.matmove_notification_sender()
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor uuid:=auth.uid();begin
 if actor is null then raise exception 'AUTH: Sign in to Admin.';end if;
 perform 1 from public.matmove_staff_access a where a.id=actor and a.is_active
 and coalesce(to_jsonb(a)->>'removed_at','')='' and
 (a.is_owner or a.permissions ? 'notifications') for share;
 if not found then raise exception 'ACCESS: Notifications assignment required.';end if;
 return actor;
end $fn$;
create or replace function public.matmove_notification_customer(p_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $fn$
 select exists(select 1 from public.profiles p where p.id=p_id and p.role::text in ('rider','driver','merchant')
 and exists(select 1 from auth.users u where u.id=p.id)
 and (not exists(select 1 from public.user_roles r where r.profile_id=p.id) or
 exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text=p.role::text))
 and not exists(select 1 from public.user_roles r where r.profile_id=p.id and r.role::text not in ('rider','driver','merchant'))
 and not exists(select 1 from public.matmove_staff_access a where a.id=p.id and a.is_active and coalesce(to_jsonb(a)->>'removed_at','')=''));
$fn$;

create or replace function public.matmove_admin_send_notification(
 p_request_key uuid,p_audience text,p_target_id uuid,p_title text,p_body text,p_destination text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor uuid; v public.matmove_notification_messages%rowtype; n integer;
 clean_title text:=btrim(p_title);clean_body text:=btrim(p_body);
begin
 actor:=public.matmove_notification_sender();
 if p_request_key is null or p_audience is null or p_audience not in ('all','rider','driver','merchant','user')
 or clean_title is null or length(clean_title) not between 1 and 100 or clean_body is null or length(clean_body) not between 1 and 2000
 or ((p_audience='user') is distinct from (p_target_id is not null))
 or (p_destination is not null and p_destination not in ('home','wallet','trips','games','account','kyc')) then
  raise exception 'INVALID: Review the audience, title, message and destination.';
 end if;
 -- Serialize concurrent retries of the same logical send; compare its entire payload.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_key::text,0));
 select * into v from public.matmove_notification_messages where sender_id=actor and request_key=p_request_key;
 if found then
  if v.audience is distinct from p_audience or v.target_id is distinct from p_target_id
   or v.title is distinct from clean_title or v.body is distinct from clean_body or v.destination is distinct from p_destination then
    raise exception 'CONFLICT: This request key belongs to a different message.';
  end if;
  return jsonb_build_object('id',v.id,'sender_id',v.sender_id,'request_key',v.request_key,'recipient_count',v.recipient_count,'created_at',v.created_at);
 end if;
 if p_audience='user' and not public.matmove_notification_customer(p_target_id) then
  raise exception 'INVALID: Select an existing customer account.';
 end if;
 insert into public.matmove_notification_messages(sender_id,request_key,audience,target_id,title,body,destination)
 values(actor,p_request_key,p_audience,p_target_id,clean_title,clean_body,p_destination) returning * into v;
 insert into public.matmove_notification_inbox(message_id,user_id)
 select v.id,p.id from public.profiles p where public.matmove_notification_customer(p.id)
 and (p_audience='all' or (p_audience='user' and p.id=p_target_id) or p.role::text=p_audience);
 get diagnostics n=row_count;
 if n=0 then raise exception 'EMPTY: No eligible customers match this audience. Nothing sent.';end if;
 update public.matmove_notification_messages set recipient_count=n where id=v.id;
 return jsonb_build_object('id',v.id,'sender_id',actor,'request_key',p_request_key,'recipient_count',n,'created_at',v.created_at);
end $fn$;

-- Bounded pages, exact own unread count, no cross-user recipient list.
create or replace function public.matmove_notifications(p_before bigint default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare items jsonb;next_id bigint;has_more boolean;unread bigint;max_id bigint;
begin
 perform public.matmove_preferences_role(auth.uid());
 if not public.matmove_notification_customer(auth.uid()) then raise exception 'ACCESS: Customer account required.';end if;
 if p_before is not null and p_before<1 then raise exception 'INVALID: Invalid inbox page.';end if;
 select count(*) filter(where read_at is null),max(id) into unread,max_id from public.matmove_notification_inbox where user_id=auth.uid();
 select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('id',x.id::text) order by x.id desc),'[]'::jsonb),min(x.id) into items,next_id from (
  select i.id,m.id message_id,m.title,m.body,m.destination,m.created_at,i.read_at
  from public.matmove_notification_inbox i join public.matmove_notification_messages m on m.id=i.message_id
  where i.user_id=auth.uid() and (p_before is null or i.id<p_before) order by i.id desc limit 30
 ) x;
 -- IDs are JSON strings so JavaScript cannot lose precision.
 select exists(select 1 from public.matmove_notification_inbox where user_id=auth.uid() and id<next_id) into has_more;
 return jsonb_build_object('user_id',auth.uid(),'items',items,'unread_count',unread::text,
  'observed_max_id',max_id::text,'next_before',case when has_more then next_id::text else null end);
end $fn$;

create or replace function public.matmove_notification_read(p_id bigint,p_through boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare n integer;begin
 perform public.matmove_preferences_role(auth.uid());
 if not public.matmove_notification_customer(auth.uid()) then raise exception 'ACCESS: Customer account required.';end if;
 if p_id is null or p_id<1 or p_through is null or not exists(select 1 from public.matmove_notification_inbox where id=p_id and user_id=auth.uid()) then
  raise exception 'INVALID: Notification does not belong to this account.';
 end if;
 update public.matmove_notification_inbox set read_at=clock_timestamp() where user_id=auth.uid() and read_at is null
 and ((not p_through and id=p_id) or (p_through and id<=p_id));get diagnostics n=row_count;
 return jsonb_build_object('user_id',auth.uid(),'changed',n,'through',p_through,'id',p_id::text);
end $fn$;

create or replace function public.matmove_admin_notification_history(p_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare actor uuid;items jsonb;begin
 actor:=public.matmove_notification_sender();
 -- Latest 50 sends; no customer inbox content/read receipts exposed to staff.
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into items from (
  select id,sender_id,request_key,audience,target_id,title,body,destination,recipient_count,created_at
  from public.matmove_notification_messages where p_before is null or created_at<p_before order by created_at desc,id limit 50
 ) x;
 return jsonb_build_object('actor_id',actor,'items',items);
end $fn$;
revoke all on function public.matmove_notification_sender(),public.matmove_notification_customer(uuid) from public,anon,authenticated;
revoke all on function public.matmove_admin_send_notification(uuid,text,uuid,text,text,text),public.matmove_notifications(bigint),public.matmove_notification_read(bigint,boolean),public.matmove_admin_notification_history(timestamptz) from public,anon,authenticated;
grant execute on function public.matmove_admin_send_notification(uuid,text,uuid,text,text,text),public.matmove_notifications(bigint),public.matmove_notification_read(bigint,boolean),public.matmove_admin_notification_history(timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
