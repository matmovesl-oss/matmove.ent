CREATE OR REPLACE FUNCTION public.matmove_admin_concierge(p_actor uuid, p_action text, p_key uuid, p_id uuid, p_expected bigint, p_data jsonb, p_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
      if (p_data->>'price_sle') is not null and ((p_data->>'price_sle')!~'^[0-9]{1,12}([.][0-9]{1,2})?$' or (p_data->>'price_sle')::numeric<=0) then
        raise exception 'INVALID: Enter a positive SLE quote.';
      end if;
      if (p_data->>'price_usd') is not null and ((p_data->>'price_usd')!~'^[0-9]{1,12}([.][0-9]{1,2})?$' or (p_data->>'price_usd')::numeric<=0) then
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
