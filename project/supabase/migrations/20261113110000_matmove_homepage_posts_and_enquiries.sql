-- MatMove customer homepage posts, image storage and enquiry workflow.
-- Applied to the MatMove.Ent production project as migration matmove_homepage_posts_and_enquiries.
begin;

create table if not exists public.matmove_homepage_posts (
 id uuid primary key,
 title text not null check(char_length(btrim(title)) between 3 and 80),
 summary text not null check(char_length(btrim(summary)) between 10 and 180),
 body text not null check(char_length(btrim(body)) between 10 and 4000),
 image_path text,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 starts_at timestamptz,
 expires_at timestamptz,
 display_order integer not null default 0 check(display_order between 0 and 10000),
 version bigint not null default 1 check(version>0),
 created_by uuid references auth.users(id),
 updated_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz,
 check(expires_at is null or starts_at is null or expires_at>starts_at),
 check(image_path is null or (char_length(image_path) between 1 and 500 and image_path !~ '(^/|\.\.|\\)'))
);
create index if not exists matmove_homepage_posts_live_idx on public.matmove_homepage_posts(status,starts_at,expires_at,display_order) where deleted_at is null;

create table if not exists public.matmove_homepage_post_enquiries (
 id uuid primary key default gen_random_uuid(),
 post_id uuid references public.matmove_homepage_posts(id) on delete set null,
 post_title_snapshot text not null,
 customer_id uuid not null references auth.users(id),
 customer_name text, customer_email text, customer_phone text,
 message text not null check(char_length(btrim(message)) between 5 and 1000),
 status text not null default 'new' check(status in ('new','contacted','in_progress','completed','cancelled')),
 version bigint not null default 1 check(version>0),
 request_key uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(customer_id,request_key)
);
create index if not exists matmove_homepage_post_enquiries_recent_idx on public.matmove_homepage_post_enquiries(created_at desc,id);

create table if not exists public.matmove_homepage_post_mutations (
 request_key uuid primary key, actor_id uuid not null references auth.users(id),
 action text not null, target_id uuid not null, payload jsonb not null, response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);

alter table public.matmove_homepage_posts enable row level security;
alter table public.matmove_homepage_post_enquiries enable row level security;
alter table public.matmove_homepage_post_mutations enable row level security;
revoke all on public.matmove_homepage_posts,public.matmove_homepage_post_enquiries,public.matmove_homepage_post_mutations from anon,authenticated;
grant select on public.matmove_homepage_posts to authenticated;

drop policy if exists matmove_homepage_posts_customer_live_read on public.matmove_homepage_posts;
create policy matmove_homepage_posts_customer_live_read on public.matmove_homepage_posts for select to authenticated using(status='published' and deleted_at is null and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now()));
drop policy if exists matmove_homepage_posts_admin_read on public.matmove_homepage_posts;
create policy matmove_homepage_posts_admin_read on public.matmove_homepage_posts for select to authenticated using(public.matmove_admin_can('notifications'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('matmove-homepage-posts','matmove-homepage-posts',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists matmove_homepage_post_assets_public_read on storage.objects;
create policy matmove_homepage_post_assets_public_read on storage.objects for select to public using(bucket_id='matmove-homepage-posts');
drop policy if exists matmove_homepage_post_assets_admin_insert on storage.objects;
create policy matmove_homepage_post_assets_admin_insert on storage.objects for insert to authenticated with check(bucket_id='matmove-homepage-posts' and public.matmove_admin_can('notifications'));
drop policy if exists matmove_homepage_post_assets_admin_delete on storage.objects;
create policy matmove_homepage_post_assets_admin_delete on storage.objects for delete to authenticated using(bucket_id='matmove-homepage-posts' and public.matmove_admin_can('notifications'));

create or replace function public.matmove_admin_homepage_posts(p_actor uuid,p_action text,p_key uuid,p_id uuid,p_expected bigint,p_data jsonb,p_page integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare p public.matmove_homepage_posts%rowtype; e public.matmove_homepage_post_enquiries%rowtype; prior public.matmove_homepage_post_mutations%rowtype; rows jsonb; result jsonb; active_count integer;
begin
 if p_actor is null or p_actor<>auth.uid() or not public.matmove_admin_can('notifications') then raise exception 'FORBIDDEN: Homepage posts permission required.'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order,q.created_at desc),'[]'::jsonb) into rows from (select * from public.matmove_homepage_posts order by display_order,created_at desc limit 200) q;
  return jsonb_build_object('rows',rows);
 elsif p_action='enquiries' then
  if p_page is null or p_page not between 0 and 10000 then raise exception 'INVALID: Invalid enquiry page.'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb) into rows from (select id,post_id,post_title_snapshot,customer_name,customer_email,customer_phone,message,status,version,created_at from public.matmove_homepage_post_enquiries order by created_at desc,id limit 51 offset p_page*50) q;
  return jsonb_build_object('rows',rows,'hasMore',jsonb_array_length(rows)>50,'page',p_page);
 end if;
 if p_action not in ('save','publish','unpublish','archive','status') or p_key is null or p_id is null or p_expected is null or p_expected<0 or jsonb_typeof(coalesce(p_data,'{}'::jsonb)) is distinct from 'object' then raise exception 'INVALID: Invalid homepage post change.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('matmove-homepage:'||p_key::text,0));
 select * into prior from public.matmove_homepage_post_mutations where request_key=p_key;
 if found then
  if prior.actor_id<>p_actor or prior.action<>p_action or prior.target_id<>p_id or prior.payload<>jsonb_build_object('version',p_expected,'data',coalesce(p_data,'{}'::jsonb)) then raise exception 'CONFLICT: Original request changed.'; end if;
  return prior.response;
 end if;
 if p_action='status' then
  if (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>1 or p_data->>'status' not in ('new','contacted','in_progress','completed','cancelled') then raise exception 'INVALID: Invalid enquiry status.'; end if;
  select * into e from public.matmove_homepage_post_enquiries where id=p_id for update;
  if not found or e.version<>p_expected then raise exception 'CONFLICT: Reload this enquiry before updating it.'; end if;
  update public.matmove_homepage_post_enquiries set status=p_data->>'status',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into e;
  result=jsonb_build_object('id',e.id,'version',e.version,'status',e.status);
 else
  select * into p from public.matmove_homepage_posts where id=p_id for update;
  if p_action='save' then
   if (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>7 or not(p_data ?& array['title','summary','body','image_path','starts_at','expires_at','display_order']) or jsonb_typeof(p_data->'title')<>'string' or jsonb_typeof(p_data->'summary')<>'string' or jsonb_typeof(p_data->'body')<>'string' or jsonb_typeof(p_data->'image_path') not in ('string','null') or jsonb_typeof(p_data->'starts_at') not in ('string','null') or jsonb_typeof(p_data->'expires_at') not in ('string','null') or jsonb_typeof(p_data->'display_order')<>'number' or (p_data->>'display_order') !~ '^[0-9]{1,5}$' then raise exception 'INVALID: Complete all promotion fields with valid values.'; end if;
   if char_length(btrim(p_data->>'title')) not between 3 and 80 or char_length(btrim(p_data->>'summary')) not between 10 and 180 or char_length(btrim(p_data->>'body')) not between 10 and 4000 then raise exception 'INVALID: Check the title, short description and details lengths.'; end if;
   if nullif(p_data->>'image_path','') is not null and (char_length(p_data->>'image_path')>500 or (p_data->>'image_path') !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$') then raise exception 'INVALID: Upload a valid post image.'; end if;
   if nullif(p_data->>'starts_at','') is not null and not (p_data->>'starts_at') ~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'INVALID: Enter a valid start date.'; end if;
   if nullif(p_data->>'expires_at','') is not null and not (p_data->>'expires_at') ~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'INVALID: Enter a valid expiry date.'; end if;
   if nullif(p_data->>'expires_at','') is not null and nullif(p_data->>'starts_at','') is not null and (p_data->>'expires_at')::timestamptz<=(p_data->>'starts_at')::timestamptz then raise exception 'INVALID: Expiry must be after the start date.'; end if;
   if p.id is null then
    if p_expected<>0 then raise exception 'CONFLICT: Post no longer exists.'; end if;
    insert into public.matmove_homepage_posts(id,title,summary,body,image_path,starts_at,expires_at,display_order,created_by,updated_by)
    values(p_id,btrim(p_data->>'title'),btrim(p_data->>'summary'),btrim(p_data->>'body'),nullif(p_data->>'image_path',''),nullif(p_data->>'starts_at','')::timestamptz,nullif(p_data->>'expires_at','')::timestamptz,(p_data->>'display_order')::integer,p_actor,p_actor) returning * into p;
   else
    if p.version<>p_expected or p.deleted_at is not null or p.status='archived' then raise exception 'CONFLICT: Reload this post before editing.'; end if;
    update public.matmove_homepage_posts set title=btrim(p_data->>'title'),summary=btrim(p_data->>'summary'),body=btrim(p_data->>'body'),image_path=nullif(p_data->>'image_path',''),starts_at=nullif(p_data->>'starts_at','')::timestamptz,expires_at=nullif(p_data->>'expires_at','')::timestamptz,display_order=(p_data->>'display_order')::integer,version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into p;
   end if;
   result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
  else
   if p.id is null or p.version<>p_expected or p.deleted_at is not null then raise exception 'CONFLICT: Reload this post before changing its status.'; end if;
   if p_action='publish' then
    if p.status='published' then result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
    else
     select count(*) into active_count from public.matmove_homepage_posts where status='published' and deleted_at is null and (expires_at is null or expires_at>clock_timestamp());
     if active_count>=3 then raise exception 'INVALID: You can have no more than three published homepage posts. Unpublish or expire one first.'; end if;
     update public.matmove_homepage_posts set status='published',version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into p;
     result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
    end if;
   elsif p_action='unpublish' then
    update public.matmove_homepage_posts set status='draft',version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into p;
    result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
   else
    update public.matmove_homepage_posts set status='archived',deleted_at=clock_timestamp(),version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_id returning * into p;
    result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
   end if;
  end if;
 end if;
 insert into public.matmove_homepage_post_mutations(request_key,actor_id,action,target_id,payload,response) values(p_key,p_actor,p_action,p_id,jsonb_build_object('version',p_expected,'data',coalesce(p_data,'{}'::jsonb)),result);
 return result;
end;$function$;

create or replace function public.matmove_submit_homepage_post_enquiry(p_post_id uuid,p_message text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare actor uuid:=auth.uid(); p public.matmove_homepage_posts%rowtype; e public.matmove_homepage_post_enquiries%rowtype; profile_row public.profiles%rowtype;
begin
 if actor is null then raise exception 'FORBIDDEN: Sign in to send an enquiry.'; end if;
 if p_post_id is null or p_request_key is null or p_message is null or char_length(btrim(p_message)) not between 5 and 1000 then raise exception 'INVALID: Enter a message between 5 and 1000 characters.'; end if;
 select * into e from public.matmove_homepage_post_enquiries where customer_id=actor and request_key=p_request_key;
 if found then return jsonb_build_object('success',true,'id',e.id,'status',e.status); end if;
 select * into p from public.matmove_homepage_posts where id=p_post_id and status='published' and deleted_at is null and (starts_at is null or starts_at<=clock_timestamp()) and (expires_at is null or expires_at>clock_timestamp());
 if not found then raise exception 'NOT_FOUND: This MatMove post is no longer available.'; end if;
 select * into profile_row from public.profiles where id=actor;
 insert into public.matmove_homepage_post_enquiries(post_id,post_title_snapshot,customer_id,customer_name,customer_email,customer_phone,message,request_key)
 values(p.id,p.title,actor,coalesce(profile_row.full_name,concat_ws(' ',profile_row.first_name,profile_row.last_name)),profile_row.email,coalesce(profile_row.phone,profile_row.phone_number),btrim(p_message),p_request_key) returning * into e;
 return jsonb_build_object('success',true,'id',e.id,'status',e.status);
end;$function$;

revoke all on function public.matmove_admin_homepage_posts(uuid,text,uuid,uuid,bigint,jsonb,integer) from public,anon;
grant execute on function public.matmove_admin_homepage_posts(uuid,text,uuid,uuid,bigint,jsonb,integer) to authenticated;
revoke all on function public.matmove_submit_homepage_post_enquiry(uuid,text,uuid) from public,anon;
grant execute on function public.matmove_submit_homepage_post_enquiry(uuid,text,uuid) to authenticated;
commit;
