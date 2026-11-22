
create or replace function public.matmove_admin_dispatch_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  actor uuid;
  requests jsonb;
  drivers jsonb;
begin
  actor:=public.matmove_dispatch_actor();

  select coalesce(jsonb_agg(x.row order by x.created_at desc,x.id),'[]'::jsonb)
  into requests
  from(
    select
      b.id,
      b.created_at,
      jsonb_build_object(
        'id',b.id,
        'version',b.matmove_dispatch_version::text,
        'status',b.status,
        'fare',b.fare_amount::text,
        'serviceType',b.service_type,
        'vehicleType',to_jsonb(b)->>'vehicle_type',
        'pickup',b.pickup_location,
        'destination',b.destination_location,
        'scheduledTime',to_jsonb(b)->>'scheduled_time',
        'createdAt',b.created_at,
        'riderId',b.rider_id,
        'driverId',b.driver_id,
        'riderLabel',coalesce(nullif(to_jsonb(r)->>'full_name',''),nullif(to_jsonb(r)->>'email',''),nullif(to_jsonb(r)->>'phone_number',''),nullif(to_jsonb(r)->>'phone',''),b.rider_id::text),
        'driverLabel',coalesce(nullif(to_jsonb(d)->>'full_name',''),nullif(to_jsonb(d)->>'email',''),nullif(to_jsonb(d)->>'phone_number',''),nullif(to_jsonb(d)->>'phone',''),b.driver_id::text),
        'paymentStarted',exists(select 1 from public.ride_payments where booking_id=b.id),
        'pendingOffers',(select count(*)::text from public.matmove_ride_fare_offers where booking_id=b.id and status='pending' and expires_at>now() and fare_version=b.matmove_fare_version),
        'agreedDriverId',(select driver_id from public.matmove_ride_fare_offers where booking_id=b.id and status='accepted')
      ) row
    from public.bookings b
    left join public.profiles r on r.id=b.rider_id
    left join public.profiles d on d.id=b.driver_id
    order by b.created_at desc,b.id
    limit 2000
  ) x;

  select coalesce(jsonb_agg(x.details order by (x.details->>'eligible')::boolean desc,x.details->>'label',x.id),'[]'::jsonb)
  into drivers
  from(
    select p.id,public.matmove_dispatch_driver_status(p.id,null) details
    from public.profiles p
    where p.role::text='driver'
       or exists(select 1 from public.user_roles where profile_id=p.id and role::text='driver')
  ) x;

  return jsonb_build_object('actor',actor,'bookings',requests,'drivers',drivers,'generatedAt',clock_timestamp(),'limit',2000);
end;
$function$;
