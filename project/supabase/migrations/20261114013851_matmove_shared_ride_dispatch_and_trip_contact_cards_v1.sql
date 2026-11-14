-- Shared Rider/Merchant ride dispatch and participant-only contact cards.
create or replace function public.matmove_normalize_merchant_ride_dispatch_status()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $merchant_ride_status$
begin
  if new.service_type='ride' and new.status='pending_admin'
     and exists(select 1 from public.profiles p where p.id=new.rider_id and p.role='merchant') then
    new.status:='pending';
  end if;
  return new;
end;
$merchant_ride_status$;
revoke all on function public.matmove_normalize_merchant_ride_dispatch_status() from public,anon,authenticated;
drop trigger if exists matmove_merchant_rides_enter_driver_radar on public.bookings;
create trigger matmove_merchant_rides_enter_driver_radar
before insert or update of service_type,status,rider_id on public.bookings
for each row execute function public.matmove_normalize_merchant_ride_dispatch_status();

update public.bookings b
set status='pending',updated_at=now()
from public.profiles p
where p.id=b.rider_id and p.role='merchant'
  and b.service_type='ride' and b.status='pending_admin' and b.driver_id is null;

create or replace function public.matmove_trip_contact_cards(p_booking_ids uuid[])
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public
as $trip_contacts$
declare
  v_uid uuid:=auth.uid();
  v_role text;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'AUTH: Sign in to view trip contacts.'; end if;
  if p_booking_ids is null or cardinality(p_booking_ids)=0 then return '[]'::jsonb; end if;
  if cardinality(p_booking_ids)>100 then raise exception 'INVALID: Request no more than 100 trip contact cards at once.'; end if;
  v_role:=public.matmove_preferences_role(v_uid);
  if v_role not in ('rider','merchant','driver') then raise exception 'FORBIDDEN: Customer or Driver account required.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingId',b.id,
    'status',b.status,
    'rider',case when rp.id is null then null else jsonb_build_object(
      'id',rp.id,
      'full_name',coalesce(nullif(btrim(rp.full_name),''),nullif(btrim(concat_ws(' ',nullif(btrim(rp.first_name),''),nullif(btrim(rp.last_name),''))),''),nullif(btrim(rp.business_name),''),'MatMove customer'),
      'phone',coalesce(nullif(btrim(rp.phone),''),nullif(btrim(rp.phone_number),''),'')
    ) end,
    'driver',case when dp.id is null then null else jsonb_build_object(
      'id',dp.id,
      'full_name',coalesce(nullif(btrim(dp.full_name),''),nullif(btrim(concat_ws(' ',nullif(btrim(dp.first_name),''),nullif(btrim(dp.last_name),''))),''),'MatMove driver'),
      'phone',coalesce(nullif(btrim(dp.phone),''),nullif(btrim(dp.phone_number),''),'')
    ) end
  ) order by b.created_at desc),'[]'::jsonb)
  into v_result
  from public.bookings b
  left join public.profiles rp on rp.id=b.rider_id
  left join public.profiles dp on dp.id=b.driver_id
  where b.id=any(p_booking_ids)
    and (
      (v_role in ('rider','merchant') and b.rider_id=v_uid)
      or (v_role='driver' and (
        b.driver_id=v_uid
        or (b.driver_id is null and b.status in ('pending','pending_admin')
            and public.matmove_driver_radar_visible(b.rider_id,b.driver_id,b.status))
      ))
    );
  return v_result;
end;
$trip_contacts$;
revoke all on function public.matmove_trip_contact_cards(uuid[]) from public,anon;
grant execute on function public.matmove_trip_contact_cards(uuid[]) to authenticated;
