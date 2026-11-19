-- Hybrid vehicle fallback: matching category first, then approved alternatives after 2 minutes.
-- Fare offers snapshot the driver's KYC-approved vehicle; customers explicitly approve
-- the alternative category and fare before payment can be prepared.
begin;
alter table public.bookings add column if not exists matmove_confirmed_vehicle_type text;
alter table public.matmove_ride_fare_offers add column if not exists vehicle_type text;

create or replace function public.matmove_validate_fare_offer_vehicle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; p public.profiles%rowtype;
begin
 select * into b from public.bookings where id=new.booking_id for update;
 if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
 select * into p from public.profiles where id=new.driver_id;
 if not found or p.role::text<>'driver' or p.kyc_status::text<>'approved'
   or coalesce(p.is_wallet_frozen,false) or nullif(trim(p.vehicle_type),'') is null then
   raise exception 'FORBIDDEN: An approved driver with a verified vehicle is required.';
 end if;
 if exists(select 1 from public.wallets where user_id=new.driver_id and coalesce(is_frozen,false)) then
   raise exception 'FORBIDDEN: Wallet is frozen. Contact support.';
 end if;
 if lower(trim(p.vehicle_type))<>lower(trim(coalesce(b.vehicle_type,'')))
   and now()<b.created_at+interval '2 minutes' then
   raise exception 'VEHICLE_MATCH_REQUIRED: Matching vehicles get the first 2 minutes. Alternative vehicles can offer after that.';
 end if;
 new.vehicle_type:=p.vehicle_type;
 return new;
end;
$fn$;
drop trigger if exists matmove_validate_fare_offer_vehicle on public.matmove_ride_fare_offers;
create trigger matmove_validate_fare_offer_vehicle before insert on public.matmove_ride_fare_offers
for each row execute function public.matmove_validate_fare_offer_vehicle();
revoke all on function public.matmove_validate_fare_offer_vehicle() from public,anon,authenticated;

create or replace function public.matmove_record_confirmed_fare_vehicle()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if new.status='accepted' and old.status is distinct from 'accepted' then
   update public.bookings set matmove_confirmed_vehicle_type=new.vehicle_type
   where id=new.booking_id and status in ('pending','pending_admin') and driver_id is null;
   if not found then raise exception 'INVALID_STATE: Request changed before vehicle approval could be recorded.'; end if;
 end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_record_confirmed_fare_vehicle on public.matmove_ride_fare_offers;
create trigger matmove_record_confirmed_fare_vehicle after update of status on public.matmove_ride_fare_offers
for each row execute function public.matmove_record_confirmed_fare_vehicle();
revoke all on function public.matmove_record_confirmed_fare_vehicle() from public,anon,authenticated;

create or replace function public.matmove_read_ride_fares(p_user_id uuid,p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; v_role text; v_owner boolean; v_offers jsonb;
begin
 v_role:=public.matmove_preferences_role(p_user_id);
 select * into b from public.bookings where id=p_booking_id;
 if not found then raise exception 'NOT_FOUND: Request not found.'; end if;
 v_owner:=b.rider_id is not distinct from p_user_id;
 if not v_owner and (v_role='driver' and (b.driver_id=p_user_id or (b.status in ('pending','pending_admin') and b.driver_id is null and exists(select 1 from public.profiles where id=p_user_id and kyc_status::text='approved'))) is not true then
   raise exception 'FORBIDDEN: Request access denied.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'driverId',o.driver_id,'driverName',coalesce(nullif(p.full_name,''),'Driver'),
  'vehicleType',o.vehicle_type,'amountMinor',o.amount_minor,'fareVersion',o.fare_version,'agreedVersion',o.agreed_version,
  'status',case when o.status='pending' and (o.expires_at<=now() or o.fare_version<>b.matmove_fare_version) then 'expired' else o.status end,
  'expiresAt',o.expires_at,'createdAt',o.created_at
 ) order by o.created_at desc,o.id),'[]'::jsonb) into v_offers
 from public.matmove_ride_fare_offers o join public.profiles p on p.id=o.driver_id
 where o.booking_id=b.id and (v_owner or o.driver_id=p_user_id)
   and (o.status in ('pending','accepted') or o.created_at>now()-interval '1 day');
 return jsonb_build_object('bookingId',b.id,'viewerId',p_user_id,'fareMinor',round(b.fare_amount*100),
  'fareVersion',b.matmove_fare_version,'bookingStatus',b.status,'requestedVehicleType',b.vehicle_type,
  'confirmedVehicleType',b.matmove_confirmed_vehicle_type,'requestCreatedAt',b.created_at,
  'paymentStarted',exists(select 1 from public.ride_payments where booking_id=b.id),
  'selectedDriverId',(select driver_id from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted'),
  'serverTime',now(),'offers',v_offers);
end;
$fn$;
revoke all on function public.matmove_read_ride_fares(uuid,uuid) from public,anon;
grant execute on function public.matmove_read_ride_fares(uuid,uuid) to authenticated;

create or replace function public.matmove_enforce_confirmed_vehicle_payment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare b public.bookings%rowtype; p public.profiles%rowtype;
begin
 select * into b from public.bookings where id=new.booking_id;
 select * into p from public.profiles where id=new.driver_id;
 if b.matmove_confirmed_vehicle_type is not null and lower(trim(b.matmove_confirmed_vehicle_type))<>lower(trim(coalesce(p.vehicle_type,''))) then
   raise exception 'INVALID_VEHICLE: Payment driver does not match the customer-approved vehicle category.';
 end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_enforce_confirmed_vehicle_payment on public.ride_payments;
create trigger matmove_enforce_confirmed_vehicle_payment before insert on public.ride_payments
for each row execute function public.matmove_enforce_confirmed_vehicle_payment();
revoke all on function public.matmove_enforce_confirmed_vehicle_payment() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
