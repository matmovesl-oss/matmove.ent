-- Additive Concierge management; existing services/enquiries are preserved.
begin;
create table if not exists public.concierge_services (
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title text not null check(length(btrim(title)) between 2 and 120),category text not null check(length(btrim(category)) between 2 and 60),
 description text not null default '' check(length(description)<=1000),price_label text not null check(length(btrim(price_label)) between 1 and 120),
 is_active boolean not null default true,display_order integer not null default 0 check(display_order between 0 and 10000),
 created_by uuid references auth.users(id),updated_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz
);
create table if not exists public.concierge_interests (
 id uuid primary key default gen_random_uuid(),service_id uuid references public.concierge_services(id) on delete set null,
 service_slug text not null,service_title text not null,price_label_snapshot text not null,customer_id uuid not null references auth.users(id),
 customer_name text not null default '',customer_email text not null default '',customer_phone text not null default '',message text not null default '' check(length(message)<=1000),
 status text not null default 'new' check(status in ('new','contacted','in_progress','completed','cancelled')),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.concierge_service_audit (
 id uuid primary key default gen_random_uuid(),service_id uuid references public.concierge_services(id),actor_id uuid not null references auth.users(id),
 action text not null check(action in ('created','updated','deactivated','restored')),before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table public.concierge_services add column if not exists version bigint not null default 1;
alter table public.concierge_interests add column if not exists version bigint not null default 1;
alter table public.concierge_interests add column if not exists request_key uuid;
create unique index if not exists concierge_interest_request_idx on public.concierge_interests(customer_id,request_key) where request_key is not null;
create index if not exists concierge_interest_customer_created_idx on public.concierge_interests(customer_id,created_at desc);
create index if not exists concierge_interest_created_idx on public.concierge_interests(created_at desc,id);
create table if not exists public.matmove_concierge_mutations (
 request_key uuid primary key,actor_id uuid not null references auth.users(id),action text not null,target_id uuid not null,payload jsonb not null,response jsonb not null,created_at timestamptz not null default now()
);
alter table public.concierge_services enable row level security;
alter table public.concierge_interests enable row level security;
alter table public.concierge_service_audit enable row level security;
alter table public.matmove_concierge_mutations enable row level security;
revoke all on public.concierge_services,public.concierge_interests,public.concierge_service_audit,public.matmove_concierge_mutations from public,anon,authenticated;
grant select on public.concierge_services,public.concierge_interests to authenticated;
grant select,insert,update on public.concierge_services,public.concierge_interests,public.concierge_service_audit,public.matmove_concierge_mutations to service_role;
-- Replace only our named policies. No policies on other tables are touched.
drop policy if exists "Customers can view active Concierge services" on public.concierge_services;
create policy "Customers can view active Concierge services" on public.concierge_services for select to authenticated using(is_active and deleted_at is null);
drop policy if exists "Customers can view their Concierge enquiries" on public.concierge_interests;
create policy "Customers can view their Concierge enquiries" on public.concierge_interests for select to authenticated using(customer_id=(select auth.uid()));
drop policy if exists "Customers can submit their own Concierge enquiries" on public.concierge_interests;

create or replace function public.matmove_admin_concierge(p_actor uuid,p_action text,p_key uuid,p_id uuid,p_expected bigint,p_data jsonb,p_page integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $fn$
declare s public.concierge_services%rowtype; old_s public.concierge_services%rowtype; e public.concierge_interests%rowtype; j public.matmove_concierge_mutations%rowtype; result jsonb; rows jsonb;
begin
 if not exists(select 1 from public.matmove_staff_access where id=p_actor and is_active and removed_at is null and (is_owner or permissions ? 'concierge')) then raise exception 'FORBIDDEN: Concierge assignment required.';end if;
 if p_action='services' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order,q.id),'[]') into rows from(select id,slug,title,category,description,price_label,is_active,display_order,version,deleted_at from public.concierge_services order by display_order,id limit 501) q;
  return jsonb_build_object('rows',rows,'truncated',jsonb_array_length(rows)>500);
 elsif p_action='enquiries' then
  if p_page is null or p_page not between 0 and 10000 then raise exception 'INVALID: Invalid page.';end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]') into rows from(select id,service_title,price_label_snapshot,customer_name,customer_email,customer_phone,message,status,version,created_at from public.concierge_interests order by created_at desc,id limit 51 offset p_page*50) q;
  return jsonb_build_object('rows',rows,'hasMore',jsonb_array_length(rows)>50,'page',p_page);
 end if;
 if p_action not in ('save','archive','status') or p_key is null or p_id is null or p_expected is null or p_expected<0 or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID: Invalid Concierge change.';end if;
 perform pg_advisory_xact_lock(hashtextextended('concierge:'||p_key::text,0));
 select * into j from public.matmove_concierge_mutations where request_key=p_key;
 if found then
  if j.actor_id<>p_actor or j.action<>p_action or j.target_id<>p_id or j.payload<>jsonb_build_object('version',p_expected,'data',p_data) then raise exception 'CONFLICT: Original request changed.';end if;
  return j.response;
 end if;
 if p_action='status' then
  if (select count(*) from jsonb_object_keys(p_data))<>1 or p_data->>'status' not in ('new','contacted','in_progress','completed','cancelled') then raise exception 'INVALID: Invalid enquiry status.';end if;
  select * into e from public.concierge_interests where id=p_id for update;
  if not found or e.version<>p_expected then raise exception 'CONFLICT: Reload the enquiry before editing.';end if;
  update public.concierge_interests set status=p_data->>'status',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into e;
  result=jsonb_build_object('id',e.id,'version',e.version,'status',e.status);
 else
  select * into s from public.concierge_services where id=p_id for update; old_s=s;
  if (s.id is null and p_expected<>0) or (s.id is not null and s.version<>p_expected) then raise exception 'CONFLICT: Reload the service before editing.';end if;
  if p_action='archive' then
   if s.id is null then raise exception 'INVALID: Service missing.';end if;
   update public.concierge_services set is_active=false,deleted_at=coalesce(deleted_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp(),updated_by=p_actor where id=p_id returning * into s;
  else
   if (select count(*) from jsonb_object_keys(p_data))<>7 or not(p_data ?& array['slug','title','category','description','price_label','is_active','display_order']) or jsonb_typeof(p_data->'is_active')<>'boolean' or jsonb_typeof(p_data->'display_order')<>'number' or (p_data->>'display_order')!~'^[0-9]{1,5}$' then raise exception 'INVALID: Invalid service fields.';end if;
   if s.id is not null and (s.slug<>p_data->>'slug' or s.deleted_at is not null) then raise exception 'CONFLICT: Archived services and original slugs are immutable.';end if;
   if s.id is null then
    insert into public.concierge_services(id,slug,title,category,description,price_label,is_active,display_order,created_by,updated_by) values(p_id,p_data->>'slug',btrim(p_data->>'title'),btrim(p_data->>'category'),p_data->>'description',btrim(p_data->>'price_label'),(p_data->>'is_active')::boolean,(p_data->>'display_order')::integer,p_actor,p_actor) returning * into s;
   else
    update public.concierge_services set title=btrim(p_data->>'title'),category=btrim(p_data->>'category'),description=p_data->>'description',price_label=btrim(p_data->>'price_label'),is_active=(p_data->>'is_active')::boolean,display_order=(p_data->>'display_order')::integer,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into s;
   end if;
  end if;
  insert into public.concierge_service_audit(service_id,actor_id,action,before_data,after_data) values(p_id,p_actor,case when old_s.id is null then 'created' when p_action='archive' then 'deactivated' else 'updated' end,case when old_s.id is null then null else to_jsonb(old_s) end,to_jsonb(s));
  result=jsonb_build_object('id',s.id,'version',s.version,'archived',s.deleted_at is not null);
 end if;
 insert into public.matmove_concierge_mutations values(p_key,p_actor,p_action,p_id,jsonb_build_object('version',p_expected,'data',p_data),result,clock_timestamp());
 return result;
end;$fn$;
revoke all on function public.matmove_admin_concierge(uuid,text,uuid,uuid,bigint,jsonb,integer) from public,anon,authenticated;
grant execute on function public.matmove_admin_concierge(uuid,text,uuid,uuid,bigint,jsonb,integer) to service_role;

create or replace function public.matmove_customer_concierge_enquiry(p_service uuid,p_expected bigint,p_key uuid,p_message text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare uid uuid:=(select auth.uid());s public.concierge_services%rowtype;e public.concierge_interests%rowtype;p jsonb;email text;
begin
 if uid is null or not exists(select 1 from public.profiles where id=uid and role::text in ('rider','driver','merchant')) or exists(select 1 from public.matmove_staff_access where id=uid and is_active and removed_at is null) then raise exception 'FORBIDDEN: Customer account required.';end if;
 if p_key is null or p_message is null or length(p_message)>1000 then raise exception 'INVALID: Enter a message up to 1000 characters.';end if;
 perform pg_advisory_xact_lock(hashtextextended('concierge-customer:'||uid::text,0));
 select * into e from public.concierge_interests where customer_id=uid and request_key=p_key;
 if found then
  if e.service_id<>p_service or e.message<>btrim(p_message) then raise exception 'CONFLICT: Original enquiry changed.';end if;
  return jsonb_build_object('id',e.id,'status',e.status,'serviceTitle',e.service_title);
 end if;
 if (select count(*) from public.concierge_interests where customer_id=uid and created_at>now()-interval '1 hour')>=5 then raise exception 'LIMIT: Please wait before sending more enquiries.';end if;
 select * into s from public.concierge_services where id=p_service and is_active and deleted_at is null for share;
 if not found or s.version<>p_expected then raise exception 'CONFLICT: This service changed. Reload the services.';end if;
 select to_jsonb(pr) into p from public.profiles pr where id=uid;
 select u.email into email from auth.users u where u.id=uid;
 insert into public.concierge_interests(service_id,service_slug,service_title,price_label_snapshot,customer_id,customer_name,customer_email,customer_phone,message,request_key)
 values(s.id,s.slug,s.title,s.price_label,uid,coalesce(p->>'full_name',p->>'first_name',''),coalesce(email,''),coalesce(p->>'phone',p->>'phone_number',''),btrim(p_message),p_key) returning * into e;
 return jsonb_build_object('id',e.id,'status',e.status,'serviceTitle',e.service_title);
end;$fn$;
revoke all on function public.matmove_customer_concierge_enquiry(uuid,bigint,uuid,text) from public,anon;
grant execute on function public.matmove_customer_concierge_enquiry(uuid,bigint,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
