
create or replace function public.matmove_admin_audit_capture()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid:=auth.uid();
  before_row jsonb:='{}'::jsonb;
  after_row jsonb:='{}'::jsonb;
  safe_before jsonb:='{}'::jsonb;
  safe_after jsonb:='{}'::jsonb;
  changed jsonb:='[]'::jsonb;
  record_text text;
  target_text text;
  record_id uuid;
  target_id uuid;
  actor_label text;
begin
  if actor is null or not exists(
    select 1 from public.matmove_staff_access s
    where s.id=actor and s.is_active=true and s.removed_at is null
  ) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if tg_op in ('UPDATE','DELETE') then before_row:=to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then after_row:=to_jsonb(new); end if;

  record_text:=coalesce(after_row->>'id',before_row->>'id',after_row->>'request_id',before_row->>'request_id');
  target_text:=coalesce(
    case when tg_table_name='profiles' then after_row->>'id' else null end,
    case when tg_table_name='profiles' then before_row->>'id' else null end,
    after_row->>'profile_id',before_row->>'profile_id',
    after_row->>'user_id',before_row->>'user_id',
    after_row->>'rider_id',before_row->>'rider_id',
    after_row->>'driver_id',before_row->>'driver_id'
  );

  if record_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then record_id:=record_text::uuid; end if;
  if target_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then target_id:=target_text::uuid; end if;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_before
  from jsonb_each(before_row)
  where key=any(array['id','user_id','profile_id','rider_id','driver_id','role','status','kyc_status','is_active','is_available','deleted_at','removed_at','is_payroll_staff','is_frozen','currency','price','price_sle','price_usd','ticket_price','ticket_price_usd','event_date','title','service_type','fare_amount','payment_state','department','version','reviewed_at','submitted_at','is_verified','is_blocked','created_at','updated_at']);

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_after
  from jsonb_each(after_row)
  where key=any(array['id','user_id','profile_id','rider_id','driver_id','role','status','kyc_status','is_active','is_available','deleted_at','removed_at','is_payroll_staff','is_frozen','currency','price','price_sle','price_usd','ticket_price','ticket_price_usd','event_date','title','service_type','fare_amount','payment_state','department','version','reviewed_at','submitted_at','is_verified','is_blocked','created_at','updated_at']);

  if tg_op='UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key),'[]'::jsonb) into changed
    from jsonb_each(after_row) n
    where before_row->n.key is distinct from after_row->n.key;
  elsif tg_op='INSERT' then
    select coalesce(jsonb_agg(q.key order by q.key),'[]'::jsonb) into changed
    from jsonb_object_keys(after_row) as q(key);
  else
    select coalesce(jsonb_agg(q.key order by q.key),'[]'::jsonb) into changed
    from jsonb_object_keys(before_row) as q(key);
  end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.email),''),actor::text)
  into actor_label from public.profiles p where p.id=actor;

  insert into public.admin_audit_logs(
    admin_id,action,resource_type,resource_id,target_profile_id,before_data,after_data,metadata,reason
  ) values(
    actor,lower(tg_op),tg_table_name,record_id,target_id,
    case when tg_op='INSERT' then null else safe_before end,
    case when tg_op='DELETE' then null else safe_after end,
    jsonb_build_object('capture','database_row_trigger','operation',lower(tg_op),'actor_label',coalesce(actor_label,actor::text),'changed_fields',changed,'record_id',record_text),
    nullif(coalesce(after_row->>'reason',before_row->>'reason',after_row->>'rejection_reason',before_row->>'rejection_reason'),'')
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;
