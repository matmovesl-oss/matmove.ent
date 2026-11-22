CREATE OR REPLACE FUNCTION public.matmove_admin_homepage_posts(p_actor uuid, p_action text, p_key uuid, p_id uuid, p_expected bigint, p_data jsonb, p_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  p public.matmove_homepage_posts%rowtype;
  e public.matmove_homepage_post_enquiries%rowtype;
  prior public.matmove_homepage_post_mutations%rowtype;
  rows jsonb;
  result jsonb;
  active_count integer;
begin
  if p_actor is null or p_actor <> auth.uid() or not public.matmove_admin_can('notifications') then
    raise exception 'FORBIDDEN: Homepage posts permission required.';
  end if;

  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.display_order,q.created_at desc),'[]'::jsonb)
      into rows
      from (select * from public.matmove_homepage_posts where deleted_at is null and status <> 'archived' order by display_order,created_at desc limit 200) q;
    return jsonb_build_object('rows',rows);
  elsif p_action = 'enquiries' then
    if p_page is null or p_page not between 0 and 10000 then raise exception 'INVALID: Invalid enquiry page.'; end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb)
      into rows
      from (select id,post_id,post_title_snapshot,customer_name,customer_email,customer_phone,message,status,version,created_at
            from public.matmove_homepage_post_enquiries order by created_at desc,id limit 51 offset p_page*50) q;
    return jsonb_build_object('rows',rows,'hasMore',jsonb_array_length(rows)>50,'page',p_page);
  end if;

  if p_action not in ('save','publish','publish_now','unpublish','archive','delete','status')
     or p_key is null or p_id is null or p_expected is null or p_expected < 0
     or jsonb_typeof(coalesce(p_data,'{}'::jsonb)) is distinct from 'object' then
    raise exception 'INVALID: Invalid homepage post change.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('matmove-homepage:'||p_key::text,0));
  select * into prior from public.matmove_homepage_post_mutations where request_key=p_key;
  if found then
    if prior.actor_id<>p_actor or prior.action<>p_action or prior.target_id<>p_id
       or prior.payload<>jsonb_build_object('version',p_expected,'data',coalesce(p_data,'{}'::jsonb)) then
      raise exception 'CONFLICT: Original request changed.';
    end if;
    return prior.response;
  end if;

  if p_action='status' then
    if (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>1
       or p_data->>'status' not in ('new','contacted','in_progress','completed','cancelled') then
      raise exception 'INVALID: Invalid enquiry status.';
    end if;
    select * into e from public.matmove_homepage_post_enquiries where id=p_id for update;
    if not found or e.version<>p_expected then raise exception 'CONFLICT: Reload this enquiry before updating it.'; end if;
    update public.matmove_homepage_post_enquiries
      set status=p_data->>'status',version=version+1,updated_at=clock_timestamp()
      where id=p_id returning * into e;
    result=jsonb_build_object('id',e.id,'version',e.version,'status',e.status);
  else
    select * into p from public.matmove_homepage_posts where id=p_id for update;
    if p_action='delete' then
        if p.id is null or p.version<>p_expected then
          raise exception 'CONFLICT: Reload this post before deleting it.';
        end if;
        result=jsonb_build_object('id',p.id,'version',p.version,'deleted',true,'image_path',p.image_path);
        delete from public.matmove_homepage_posts where id=p_id;
      elsif p_action='save' then
      if (select count(*) from jsonb_object_keys(coalesce(p_data,'{}'::jsonb)))<>9
        or not (p_data ?& array['title','summary','body','image_path','starts_at','expires_at','display_order','price_amount','price_currency'])
        or jsonb_typeof(p_data->'title')<>'string'
        or jsonb_typeof(p_data->'summary')<>'string'
        or jsonb_typeof(p_data->'body')<>'string'
        or not (jsonb_typeof(p_data->'image_path') in ('string','null'))
        or not (jsonb_typeof(p_data->'starts_at') in ('string','null'))
        or not (jsonb_typeof(p_data->'expires_at') in ('string','null'))
        or jsonb_typeof(p_data->'display_order')<>'number'
        or (p_data->>'display_order') !~ '^[0-9]{1,5}$'
        or not (jsonb_typeof(p_data->'price_amount') in ('number','null'))
        or not (jsonb_typeof(p_data->'price_currency') in ('string','null')) then
        raise exception 'INVALID: Complete all promotion fields with valid values.';
      end if;
      if char_length(btrim(p_data->>'title')) not between 3 and 80
        or char_length(btrim(p_data->>'summary')) not between 10 and 180
        or char_length(btrim(p_data->>'body')) not between 10 and 4000 then
        raise exception 'INVALID: Check the title, short description and details lengths.';
      end if;
      if nullif(p_data->>'image_path','') is not null and
        (char_length(p_data->>'image_path')>500 or (p_data->>'image_path') !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$') then
        raise exception 'INVALID: Upload a valid post image.';
      end if;
      if nullif(p_data->>'starts_at','') is not null and not (p_data->>'starts_at') ~ '^\d{4}-\d{2}-\d{2}T' then
        raise exception 'INVALID: Enter a valid start date.';
      end if;
      if nullif(p_data->>'expires_at','') is not null and not (p_data->>'expires_at') ~ '^\d{4}-\d{2}-\d{2}T' then
        raise exception 'INVALID: Enter a valid expiry date.';
      end if;
      if nullif(p_data->>'expires_at','') is not null and nullif(p_data->>'starts_at','') is not null
        and (p_data->>'expires_at')::timestamptz <= (p_data->>'starts_at')::timestamptz then
        raise exception 'INVALID: Expiry must be after the start date.';
      end if;
      if (p_data->>'price_amount') is null and (p_data->>'price_currency') is not null
        or (p_data->>'price_amount') is not null and (
          (p_data->>'price_currency') not in ('SLE','USD')
          or (p_data->>'price_amount')::numeric <= 0
          or (p_data->>'price_amount')::numeric > 1000000
          or scale((p_data->>'price_amount')::numeric) > 2
        ) then
        raise exception 'INVALID: Enter a positive price up to two decimal places and choose SLE or USD.';
      end if;
      if p.id is null then
        if p_expected<>0 then raise exception 'CONFLICT: Post no longer exists.'; end if;
        insert into public.matmove_homepage_posts(
          id,title,summary,body,image_path,starts_at,expires_at,display_order,
          price_amount,price_currency,created_by,updated_by
        )
        values(
          p_id,btrim(p_data->>'title'),btrim(p_data->>'summary'),btrim(p_data->>'body'),
          nullif(p_data->>'image_path',''),nullif(p_data->>'starts_at','')::timestamptz,
          nullif(p_data->>'expires_at','')::timestamptz,(p_data->>'display_order')::integer,
          nullif(p_data->>'price_amount','')::numeric,nullif(p_data->>'price_currency',''),p_actor,p_actor
        ) returning * into p;
      else
        if p.version<>p_expected or p.deleted_at is not null or p.status='archived' then raise exception 'CONFLICT: Reload this post before editing.'; end if;
        update public.matmove_homepage_posts
        set title=btrim(p_data->>'title'),summary=btrim(p_data->>'summary'),body=btrim(p_data->>'body'),
            image_path=nullif(p_data->>'image_path',''),starts_at=nullif(p_data->>'starts_at','')::timestamptz,
            expires_at=nullif(p_data->>'expires_at','')::timestamptz,display_order=(p_data->>'display_order')::integer,
            price_amount=nullif(p_data->>'price_amount','')::numeric,
            price_currency=nullif(p_data->>'price_currency',''),
            version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
        where id=p_id returning * into p;
      end if;
      result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
    else
      if p.id is null or p.version<>p_expected or p.deleted_at is not null then raise exception 'CONFLICT: Reload this post before changing its status.'; end if;
      if p_action='publish' then
        if p.status='published' then
          result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
        else
          select count(*) into active_count from public.matmove_homepage_posts
            where status='published' and deleted_at is null and (expires_at is null or expires_at>clock_timestamp());
          if active_count>=3 then raise exception 'INVALID: You can have no more than three published homepage posts. Unpublish or expire one first.'; end if;
          update public.matmove_homepage_posts set status='published',version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
            where id=p_id returning * into p;
          result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
        end if;
      elsif p_action='publish_now' then
        if p.status<>'published' then
          select count(*) into active_count from public.matmove_homepage_posts
            where status='published' and deleted_at is null and (expires_at is null or expires_at>clock_timestamp());
          if active_count>=3 then raise exception 'INVALID: You can have no more than three published homepage posts. Unpublish or expire one first.'; end if;
        end if;
        update public.matmove_homepage_posts
          set status='published',starts_at=clock_timestamp(),version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
          where id=p_id returning * into p;
        result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status,'starts_at',p.starts_at);
      elsif p_action='unpublish' then
        update public.matmove_homepage_posts set status='draft',version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
          where id=p_id returning * into p;
        result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
      else
        update public.matmove_homepage_posts set status='archived',deleted_at=clock_timestamp(),version=version+1,updated_by=p_actor,updated_at=clock_timestamp()
          where id=p_id returning * into p;
        result=jsonb_build_object('id',p.id,'version',p.version,'status',p.status);
      end if;
    end if;
  end if;

  insert into public.matmove_homepage_post_mutations(request_key,actor_id,action,target_id,payload,response)
  values(p_key,p_actor,p_action,p_id,jsonb_build_object('version',p_expected,'data',coalesce(p_data,'{}'::jsonb)),result);
  return result;
end;
$function$
