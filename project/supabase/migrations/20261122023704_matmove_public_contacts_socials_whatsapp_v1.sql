
begin;

create table if not exists public.matmove_public_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('social','whatsapp')),
  platform_name text not null check (char_length(btrim(platform_name)) between 2 and 50),
  link_url text,
  whatsapp_phone text,
  icon_key text not null check (icon_key in ('instagram','facebook','tiktok','youtube','linkedin','x','telegram','snapchat','website','generic','whatsapp')),
  is_active boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 10000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint matmove_public_contacts_shape check (
    (
      kind='social'
      and link_url is not null
      and link_url ~* '^https://([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
      and whatsapp_phone is null
      and icon_key <> 'whatsapp'
    )
    or
    (
      kind='whatsapp'
      and platform_name='WhatsApp Support'
      and link_url is null
      and whatsapp_phone ~ '^[1-9][0-9]{7,14}$'
      and icon_key='whatsapp'
    )
  )
);

create unique index if not exists matmove_public_contacts_one_whatsapp_idx
  on public.matmove_public_contacts(kind) where kind='whatsapp';
create index if not exists matmove_public_contacts_active_order_idx
  on public.matmove_public_contacts(is_active,display_order,created_at);

alter table public.matmove_public_contacts enable row level security;
revoke all on public.matmove_public_contacts from public, anon, authenticated;
grant select (id,kind,platform_name,link_url,whatsapp_phone,icon_key,is_active,display_order,version,created_at,updated_at)
  on public.matmove_public_contacts to anon,authenticated;

drop policy if exists matmove_public_contacts_active_read on public.matmove_public_contacts;
create policy matmove_public_contacts_active_read
  on public.matmove_public_contacts for select to anon,authenticated
  using (is_active is true);

create or replace function public.matmove_admin_public_contacts(
  p_actor uuid,
  p_action text,
  p_id uuid,
  p_expected bigint,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $function$
declare
  c public.matmove_public_contacts%rowtype;
  rows jsonb;
  v_kind text;
  v_name text;
  v_url text;
  v_phone text;
  v_icon text;
  v_active boolean;
  v_order integer;
begin
  if p_actor is null or p_actor is distinct from auth.uid()
     or not public.matmove_admin_can('support') then
    raise exception 'FORBIDDEN: Customer Support permission required.';
  end if;

  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order,q.created_at,q.id),'[]'::jsonb)
      into rows
      from (select * from public.matmove_public_contacts order by display_order,created_at,id) q;
    return jsonb_build_object('items',rows);
  end if;

  if p_action='save' then
    if p_id is null and coalesce(p_expected,0)<>0 then
      raise exception 'CONFLICT: New contact has an invalid version.';
    end if;
    if p_expected is null or p_expected<0
       or jsonb_typeof(coalesce(p_data,'{}'::jsonb)) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>7
       or not (p_data ?& array['kind','platform_name','link_url','whatsapp_phone','icon_key','is_active','display_order'])
       or jsonb_typeof(p_data->'kind')<>'string'
       or jsonb_typeof(p_data->'platform_name')<>'string'
       or jsonb_typeof(p_data->'link_url') not in ('string','null')
       or jsonb_typeof(p_data->'whatsapp_phone') not in ('string','null')
       or jsonb_typeof(p_data->'icon_key')<>'string'
       or jsonb_typeof(p_data->'is_active')<>'boolean'
       or jsonb_typeof(p_data->'display_order')<>'number'
       or (p_data->>'display_order') !~ '^[0-9]{1,5}$' then
      raise exception 'INVALID: Complete all contact fields with valid values.';
    end if;

    v_kind:=p_data->>'kind';
    v_name:=btrim(p_data->>'platform_name');
    v_url:=nullif(btrim(p_data->>'link_url'),'');
    v_phone:=regexp_replace(coalesce(p_data->>'whatsapp_phone',''),'[^0-9]','','g');
    v_icon:=p_data->>'icon_key';
    v_active:=(p_data->>'is_active')::boolean;
    v_order:=(p_data->>'display_order')::integer;

    if v_kind='social' then
      if char_length(v_name) not between 2 and 50
         or v_url is null or char_length(v_url)>500
         or v_url !~* '^https://([a-z0-9-]+\.)+[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
         or nullif(p_data->>'whatsapp_phone','') is not null
         or v_icon not in ('instagram','facebook','tiktok','youtube','linkedin','x','telegram','snapchat','website','generic') then
        raise exception 'INVALID: Social profiles require a platform name, secure HTTPS link and valid icon.';
      end if;
    elsif v_kind='whatsapp' then
      if v_name<>'WhatsApp Support'
         or v_url is not null
         or char_length(v_phone) not between 8 and 15
         or v_phone !~ '^[1-9][0-9]{7,14}$'
         or v_icon<>'whatsapp' then
        raise exception 'INVALID: Enter a WhatsApp number with international country code.';
      end if;
      v_name:='WhatsApp Support';
    else
      raise exception 'INVALID: Unsupported contact type.';
    end if;

    if p_id is null then
      if v_kind='whatsapp' and exists(select 1 from public.matmove_public_contacts where kind='whatsapp') then
        raise exception 'CONFLICT: A WhatsApp support number already exists. Refresh and edit that entry.';
      end if;
      insert into public.matmove_public_contacts
        (kind,platform_name,link_url,whatsapp_phone,icon_key,is_active,display_order)
      values
        (v_kind,v_name,v_url,case when v_kind='whatsapp' then v_phone else null end,v_icon,v_active,v_order)
      returning * into c;
    else
      select * into c from public.matmove_public_contacts where id=p_id for update;
      if not found or c.version<>p_expected then
        raise exception 'CONFLICT: Contact changed. Refresh the list before saving.';
      end if;
      if c.kind<>v_kind then
        raise exception 'INVALID: A contact type cannot be changed after creation.';
      end if;
      update public.matmove_public_contacts
        set platform_name=v_name,
            link_url=v_url,
            whatsapp_phone=case when v_kind='whatsapp' then v_phone else null end,
            icon_key=v_icon,
            is_active=v_active,
            display_order=v_order,
            version=version+1,
            updated_at=clock_timestamp()
        where id=p_id
        returning * into c;
    end if;
    return to_jsonb(c);
  elsif p_action='delete' then
    if p_id is null or p_expected is null or p_expected<1 then
      raise exception 'INVALID: Select a contact to delete.';
    end if;
    select * into c from public.matmove_public_contacts where id=p_id for update;
    if not found or c.version<>p_expected then
      raise exception 'CONFLICT: Contact changed. Refresh before deleting.';
    end if;
    if c.kind='whatsapp' then
      raise exception 'INVALID: WhatsApp support cannot be deleted. Deactivate it or change its number instead.';
    end if;
    delete from public.matmove_public_contacts where id=p_id;
    return jsonb_build_object('id',p_id,'deleted',true,'version',c.version);
  end if;

  raise exception 'INVALID: Unsupported contact action.';
end;
$function$;

revoke all on function public.matmove_admin_public_contacts(uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.matmove_admin_public_contacts(uuid,text,uuid,bigint,jsonb) to authenticated;

do $publication$
begin
  if to_regclass('pg_catalog.pg_publication') is not null
     and exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1 from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='matmove_public_contacts'
     ) then
    alter publication supabase_realtime add table public.matmove_public_contacts;
  end if;
end;
$publication$;

notify pgrst,'reload schema';
commit;
