-- Additive read-policy repair for the ONE shared Supabase project.
-- Does not modify requests, fares, payments, approval or staff assignments.
begin;
do $requirements$
begin
 if to_regprocedure('public.matmove_dispatch_driver_busy(uuid,uuid)') is null or to_regprocedure('public.matmove_admin_can(text)') is null then raise exception 'SETUP_REQUIRED: Complete Admin Dispatch setup first.';end if;
end;
$requirements$;
create or replace function public.matmove_driver_radar_visible(p_rider uuid,p_driver uuid,p_status text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare uid uuid:=auth.uid();p public.profiles%rowtype;
begin
 if uid is null then return false;end if;
 select * into p from public.profiles where id=uid;
 if not found or p.role::text is distinct from 'driver'
 or exists(select 1 from public.matmove_staff_access where id=uid and is_active=true and removed_at is null)
 or exists(select 1 from public.user_roles where profile_id=uid and (role is null or role::text not in ('rider','driver','merchant')))
 or (exists(select 1 from public.user_roles where profile_id=uid) and not exists(select 1 from public.user_roles where profile_id=uid and role::text='driver')) then return false;end if;
 -- A driver may still inspect their own assigned trip if approval is revoked;
 -- existing mutation/payment RPCs remain responsible for current authorization.
 if p_driver=uid then return coalesce(p_status in ('pending','pending_admin','accepted','in_progress'),false);end if;
 return coalesce(p_driver is null and p_rider is not null and p_rider is distinct from uid and p_status in ('pending','pending_admin')
  and p.kyc_status::text='approved' and not coalesce((to_jsonb(p)->>'is_wallet_frozen')::boolean,false)
  and exists(select 1 from public.wallets where user_id=uid and currency='SLE')
  and not exists(select 1 from public.wallets where user_id=uid and is_frozen=true)
  and not public.matmove_dispatch_driver_busy(uid,null),false);
end;
$fn$;
revoke all on function public.matmove_driver_radar_visible(uuid,uuid,text) from public,anon;
grant execute on function public.matmove_driver_radar_visible(uuid,uuid,text) to authenticated;

-- Keep the existing restrictive Dispatch policy consistent with the new
-- narrow permissive Driver policy. Rider/Merchant ownership policies remain.
create or replace function public.matmove_dispatch_booking_visible(p_rider uuid,p_driver uuid,p_status text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare role_name text;
begin
 if public.matmove_admin_can('dispatch') then return true;end if;
 select role::text into role_name from public.profiles where id=auth.uid();
 if role_name='driver' then return coalesce(p_rider=auth.uid() or public.matmove_driver_radar_visible(p_rider,p_driver,p_status),false);end if;
 if exists(select 1 from public.matmove_staff_access where id=auth.uid()) then return coalesce(p_rider=auth.uid() or p_driver=auth.uid(),false);end if;
 return true;
end;
$fn$;
revoke all on function public.matmove_dispatch_booking_visible(uuid,uuid,text) from public,anon;
grant execute on function public.matmove_dispatch_booking_visible(uuid,uuid,text) to authenticated;
alter table public.bookings enable row level security;
drop policy if exists matmove_dispatch_visibility on public.bookings;
create policy matmove_dispatch_visibility on public.bookings as restrictive for select to authenticated
 using(public.matmove_dispatch_booking_visible(rider_id,driver_id,status));
drop policy if exists matmove_no_anonymous_booking_reads on public.bookings;
create policy matmove_no_anonymous_booking_reads on public.bookings as restrictive for select to anon using(false);
drop policy if exists matmove_driver_radar_read on public.bookings;
create policy matmove_driver_radar_read on public.bookings for select to authenticated
 using(public.matmove_driver_radar_visible(rider_id,driver_id,status));
notify pgrst,'reload schema';
commit;

-- Read-only installation audit, including the existing payment preparation code.
-- No provider credentials, wallet balances or customer identity rows are read.
select jsonb_build_object(
 'driver_feed_policy_ready',exists(select 1 from pg_policy where polrelid='public.bookings'::regclass and polname='matmove_driver_radar_read'),
 'restrictive_dispatch_policy_ready',exists(select 1 from pg_policy where polrelid='public.bookings'::regclass and polname='matmove_dispatch_visibility' and not polpermissive),
 'anonymous_booking_reads_blocked',exists(select 1 from pg_policy where polrelid='public.bookings'::regclass and polname='matmove_no_anonymous_booking_reads' and not polpermissive),
 'open_request_counts',coalesce((select jsonb_agg(to_jsonb(x)) from (
  select status::text,service_type::text,count(*) as requests,count(*) filter(where fare_amount is null or fare_amount<=0) as awaiting_fare
  from public.bookings where status in ('pending','pending_admin') group by status,service_type order by status,service_type
 ) x),'[]'::jsonb),
 'payment_preparation_definitions',coalesce((select jsonb_agg(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='prepare_ride_payment'),'[]'::jsonb)
) as request_feed_audit;
