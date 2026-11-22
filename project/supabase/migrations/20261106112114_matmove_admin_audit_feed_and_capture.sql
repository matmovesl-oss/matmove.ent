
alter table public.admin_audit_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_logs_resource_idx
  on public.admin_audit_logs(resource_type,created_at desc);

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

  if record_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    record_id:=record_text::uuid;
  end if;
  if target_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    target_id:=target_text::uuid;
  end if;

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_before
  from jsonb_each(before_row)
  where key=any(array[
    'id','user_id','profile_id','rider_id','driver_id','role','status','kyc_status',
    'is_active','is_available','deleted_at','removed_at','is_payroll_staff','is_frozen',
    'currency','price','price_sle','price_usd','ticket_price','ticket_price_usd',
    'event_date','title','service_type','fare_amount','payment_state','department',
    'version','reviewed_at','submitted_at','is_verified','is_blocked','created_at','updated_at'
  ]);

  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_after
  from jsonb_each(after_row)
  where key=any(array[
    'id','user_id','profile_id','rider_id','driver_id','role','status','kyc_status',
    'is_active','is_available','deleted_at','removed_at','is_payroll_staff','is_frozen',
    'currency','price','price_sle','price_usd','ticket_price','ticket_price_usd',
    'event_date','title','service_type','fare_amount','payment_state','department',
    'version','reviewed_at','submitted_at','is_verified','is_blocked','created_at','updated_at'
  ]);

  if tg_op='UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key),'[]'::jsonb) into changed
    from jsonb_each(after_row) n
    where before_row->n.key is distinct from after_row->n.key;
  elsif tg_op='INSERT' then
    select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into changed
    from jsonb_object_keys(after_row) k;
  else
    select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into changed
    from jsonb_object_keys(before_row) k;
  end if;

  select coalesce(nullif(btrim(p.full_name),''),nullif(btrim(p.email),''),actor::text)
  into actor_label
  from public.profiles p
  where p.id=actor;

  insert into public.admin_audit_logs(
    admin_id,action,resource_type,resource_id,target_profile_id,
    before_data,after_data,metadata,reason
  ) values(
    actor,
    lower(tg_op),
    tg_table_name,
    record_id,
    target_id,
    case when tg_op='INSERT' then null else safe_before end,
    case when tg_op='DELETE' then null else safe_after end,
    jsonb_build_object(
      'capture','database_row_trigger',
      'operation',lower(tg_op),
      'actor_label',coalesce(actor_label,actor::text),
      'changed_fields',changed,
      'record_id',record_text
    ),
    nullif(coalesce(after_row->>'reason',before_row->>'reason',after_row->>'rejection_reason',before_row->>'rejection_reason'),'')
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','bookings','app_orders','platform_events','event_tickets',
    'matmove_staff_access','products','concierge_services','matmove_notification_messages',
    'kyc_submissions','kyc_documents','driver_documents','wallets','matmove_withdrawals',
    'withdrawal_requests','pricing_settings','travel_bookings','travel_settings',
    'vehicle_pricing','matmove_admin_payroll','matmove_admin_refunds',
    'matmove_account_deletion_requests','matmove_referral_campaign','matmove_arcade_configs',
    'matmove_spin_configs','admins'
  ] loop
    if to_regclass('public.'||quote_ident(t)) is not null then
      execute format('drop trigger if exists matmove_admin_audit_capture on public.%I',t);
      execute format(
        'create trigger matmove_admin_audit_capture after insert or update or delete on public.%I for each row execute function public.matmove_admin_audit_capture()',
        t
      );
    end if;
  end loop;
end
$$;

create or replace function public.matmove_admin_audit_feed(p_limit integer default 250)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid:=auth.uid();
  result_rows jsonb;
  max_rows integer:=least(greatest(coalesce(p_limit,250),1),1000);
  permitted boolean;
begin
  if actor is null then raise exception 'AUTH: Sign in to view Admin audit records.'; end if;

  select exists(
    select 1 from public.matmove_staff_access s
    where s.id=actor and s.is_active=true and s.removed_at is null
      and (s.is_owner=true or s.permissions ? 'logs')
  ) into permitted;

  if not permitted then
    raise exception 'FORBIDDEN: Audit access has not been assigned.';
  end if;

  with events as (
    select
      a.id::text event_id,
      a.admin_id actor_id,
      a.action,
      coalesce(nullif(a.resource_type,''),'admin_action') table_name,
      jsonb_strip_nulls(coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object(
        'resourceId',a.resource_id,'targetProfileId',a.target_profile_id,
        'reason',a.reason,'before',a.before_data,'after',a.after_data
      )) metadata,
      a.created_at
    from public.admin_audit_logs a

    union all
    select
      l.id::text,
      l.admin_id,
      l.action,
      'legacy_admin_actions',
      jsonb_build_object('details',l.details,'targetUserId',l.target_user_id),
      l.created_at
    from public.audit_logs l

    union all
    select
      s.id::text,
      s.actor_id,
      s.action,
      'matmove_staff_access',
      jsonb_build_object('targetId',s.target_id,'details',s.details),
      s.created_at
    from public.matmove_staff_audit s

    union all
    select
      k.id::text,
      k.reviewer_id,
      k.decision,
      'kyc_submissions',
      jsonb_build_object('profileId',k.profile_id,'submissionId',k.submission_id,'reason',k.reason,'reviewVersion',k.review_version),
      k.created_at
    from public.matmove_kyc_review_events k

    union all
    select
      d.request_id::text,
      d.actor_id,
      d.action,
      'bookings',
      jsonb_build_object('bookingId',d.booking_id,'driverId',d.driver_id,'expectedVersion',d.expected_version,'newVersion',d.new_version,'note',d.note),
      d.created_at
    from public.matmove_dispatch_audit d

    union all
    select
      c.id::text,
      c.actor_id,
      c.action,
      'concierge_services',
      jsonb_build_object('serviceId',c.service_id,'before',c.before_data,'after',c.after_data),
      c.created_at
    from public.concierge_service_audit c

    union all
    select
      w.id::text,
      w.admin_id,
      case when w.is_frozen then 'wallet_frozen' else 'wallet_unfrozen' end,
      'wallets',
      jsonb_build_object('walletId',w.wallet_id,'wasFrozen',w.was_frozen,'isFrozen',w.is_frozen,'reason',w.reason),
      w.created_at
    from public.matmove_wallet_freeze_audit w

    union all
    select
      s.id::text,
      s.admin_id,
      s.action,
      'matmove_spin',
      s.details,
      s.created_at
    from public.matmove_spin_admin_log s

    union all
    select
      r.id::text,
      r.actor_id,
      coalesce(r.payload->>'action','referral_admin_change'),
      'matmove_referral_campaign',
      jsonb_build_object('payload',r.payload,'receipt',r.receipt),
      r.created_at
    from public.matmove_referral_admin_events r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.event_id,
    'actor_name',coalesce(nullif(p.full_name,''),nullif(p.email,''),e.actor_id::text,'Admin'),
    'action',e.action,
    'table_name',e.table_name,
    'metadata',e.metadata,
    'created_at',e.created_at
  ) order by e.created_at desc),'[]'::jsonb)
  into result_rows
  from (
    select * from events order by created_at desc limit max_rows
  ) e
  left join public.profiles p on p.id=e.actor_id;

  return jsonb_build_object('actor',actor,'rows',result_rows,'limit',max_rows);
end;
$function$;

revoke all on function public.matmove_admin_audit_feed(integer) from public;
grant execute on function public.matmove_admin_audit_feed(integer) to authenticated;
