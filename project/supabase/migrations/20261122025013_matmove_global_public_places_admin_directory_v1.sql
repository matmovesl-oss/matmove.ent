-- MatMove curated places for customer pickup and destination suggestions.
begin;

create table if not exists public.matmove_map_places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  category text not null check (category in ('pickup_hub','terminal','landmark','collection_point','depot','market','service_point','other')),
  address text not null check (char_length(btrim(address)) between 2 and 300),
  city text,
  region text,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  notes text not null default '' check (char_length(notes) <= 500),
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 10000),
  version bigint not null default 1 check (version > 0),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists matmove_map_places_active_country_idx
  on public.matmove_map_places(is_active,country_code,category,display_order,name);

alter table public.matmove_map_places enable row level security;
revoke all on public.matmove_map_places from public,anon,authenticated;
grant select (id,name,category,address,city,region,country_code,latitude,longitude,notes,is_active,display_order,version,created_at,updated_at)
  on public.matmove_map_places to anon,authenticated;

drop policy if exists matmove_map_places_public_active_read on public.matmove_map_places;
create policy matmove_map_places_public_active_read
  on public.matmove_map_places for select to anon,authenticated
  using(is_active is true);

create or replace function public.matmove_admin_map_places(
  p_actor uuid,p_action text,p_id uuid,p_expected bigint,p_data jsonb
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $function$
declare
  p public.matmove_map_places%rowtype;
  rows jsonb;
  v_name text; v_category text; v_address text; v_city text; v_region text;
  v_country text; v_lat double precision; v_lng double precision; v_notes text;
  v_active boolean; v_order integer;
begin
  if p_actor is null or p_actor is distinct from auth.uid()
     or not public.matmove_admin_can('dispatch') then
    raise exception 'FORBIDDEN: Dispatch permission required to manage MatMove places.';
  end if;
  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.country_code,q.display_order,q.name,q.id),'[]'::jsonb)
      into rows from (select * from public.matmove_map_places order by country_code,display_order,name,id limit 1000) q;
    return jsonb_build_object('items',rows);
  end if;
  if p_action='save' then
    if p_expected is null or p_expected<0
       or jsonb_typeof(coalesce(p_data,'{}'::jsonb)) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>11
       or not (p_data ?& array['name','category','address','city','region','country_code','latitude','longitude','notes','is_active','display_order'])
       or jsonb_typeof(p_data->'name')<>'string'
       or jsonb_typeof(p_data->'category')<>'string'
       or jsonb_typeof(p_data->'address')<>'string'
       or jsonb_typeof(p_data->'city') not in ('string','null')
       or jsonb_typeof(p_data->'region') not in ('string','null')
       or jsonb_typeof(p_data->'country_code')<>'string'
       or jsonb_typeof(p_data->'latitude')<>'number'
       or jsonb_typeof(p_data->'longitude')<>'number'
       or jsonb_typeof(p_data->'notes')<>'string'
       or jsonb_typeof(p_data->'is_active')<>'boolean'
       or jsonb_typeof(p_data->'display_order')<>'number'
       or (p_data->>'display_order') !~ '^[0-9]{1,5}$' then
      raise exception 'INVALID: Complete all MatMove place fields with valid values.';
    end if;
    v_name:=btrim(p_data->>'name'); v_category:=p_data->>'category';
    v_address:=btrim(p_data->>'address'); v_city:=nullif(btrim(p_data->>'city'),'');
    v_region:=nullif(btrim(p_data->>'region'),''); v_country:=upper(btrim(p_data->>'country_code'));
    v_lat:=(p_data->>'latitude')::double precision; v_lng:=(p_data->>'longitude')::double precision;
    v_notes:=btrim(p_data->>'notes'); v_active:=(p_data->>'is_active')::boolean;
    v_order:=(p_data->>'display_order')::integer;
    if char_length(v_name) not between 2 and 100 or char_length(v_address) not between 2 and 300
       or v_category not in ('pickup_hub','terminal','landmark','collection_point','depot','market','service_point','other')
       or v_country !~ '^[A-Z]{2}$' or v_lat not between -90 and 90 or v_lng not between -180 and 180
       or char_length(v_notes)>500 or v_order not between 0 and 10000 then
      raise exception 'INVALID: Check the name, category, address, country code, coordinates and display order.';
    end if;
    if p_id is null then
      if p_expected<>0 then raise exception 'CONFLICT: New MatMove place has an invalid version.'; end if;
      insert into public.matmove_map_places
        (name,category,address,city,region,country_code,latitude,longitude,notes,is_active,display_order,created_by,updated_by)
      values
        (v_name,v_category,v_address,v_city,v_region,v_country,v_lat,v_lng,v_notes,v_active,v_order,p_actor,p_actor)
      returning * into p;
    else
      select * into p from public.matmove_map_places where id=p_id for update;
      if not found or p.version<>p_expected then raise exception 'CONFLICT: MatMove place changed. Refresh the directory before saving.'; end if;
      update public.matmove_map_places set name=v_name,category=v_category,address=v_address,city=v_city,region=v_region,
        country_code=v_country,latitude=v_lat,longitude=v_lng,notes=v_notes,is_active=v_active,display_order=v_order,
        version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
      where id=p_id returning * into p;
    end if;
    return to_jsonb(p);
  elsif p_action='delete' then
    if p_id is null or p_expected is null or p_expected<1 then raise exception 'INVALID: Select a MatMove place to delete.'; end if;
    select * into p from public.matmove_map_places where id=p_id for update;
    if not found or p.version<>p_expected then raise exception 'CONFLICT: MatMove place changed. Refresh before deleting.'; end if;
    delete from public.matmove_map_places where id=p_id;
    return jsonb_build_object('id',p_id,'deleted',true,'version',p.version);
  end if;
  raise exception 'INVALID: Unsupported MatMove places action.';
end;
$function$;

revoke all on function public.matmove_admin_map_places(uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_admin_map_places(uuid,text,uuid,bigint,jsonb) to authenticated;

do $publication$
begin
 if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matmove_map_places') then
   alter publication supabase_realtime add table public.matmove_map_places;
 end if;
end;
$publication$;

notify pgrst,'reload schema';
commit;
