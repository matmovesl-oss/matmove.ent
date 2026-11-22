
CREATE OR REPLACE FUNCTION public.matmove_read_ride_fares(
  p_user_id uuid,
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  b public.bookings%ROWTYPE;
  v_role text;
  v_owner boolean;
  v_offers jsonb;
BEGIN
  -- Never trust a caller-supplied profile ID inside a SECURITY DEFINER RPC.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH: Sign in to continue.';
  END IF;

  IF p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller identity mismatch.';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: Booking ID is required.';
  END IF;

  v_role := public.matmove_preferences_role(v_actor);

  SELECT *
    INTO b
    FROM public.bookings
   WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Request not found.';
  END IF;

  v_owner := b.rider_id IS NOT DISTINCT FROM v_actor;

  IF NOT v_owner
     AND NOT (
       v_role = 'driver'
       AND (
         b.driver_id = v_actor
         OR (
           b.status IN ('pending', 'pending_admin')
           AND b.driver_id IS NULL
           AND EXISTS (
             SELECT 1
               FROM public.profiles
              WHERE id = v_actor
                AND kyc_status::text = 'approved'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Request access denied.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'driverId', o.driver_id,
        'driverName', coalesce(nullif(p.full_name, ''), 'Driver'),
        'amountMinor', o.amount_minor,
        'fareVersion', o.fare_version,
        'agreedVersion', o.agreed_version,
        'status',
          CASE
            WHEN o.status = 'pending'
             AND (o.expires_at <= now()
                  OR o.fare_version <> b.matmove_fare_version)
            THEN 'expired'
            ELSE o.status
          END,
        'expiresAt', o.expires_at,
        'createdAt', o.created_at
      )
      ORDER BY o.created_at DESC, o.id
    ),
    '[]'::jsonb
  )
    INTO v_offers
    FROM public.matmove_ride_fare_offers o
    JOIN public.profiles p ON p.id = o.driver_id
   WHERE o.booking_id = b.id
     AND (v_owner OR o.driver_id = v_actor)
     AND (
       o.status IN ('pending', 'accepted')
       OR o.created_at > now() - interval '1 day'
     );

  RETURN jsonb_build_object(
    'bookingId', b.id,
    'viewerId', v_actor,
    'fareMinor', round(b.fare_amount * 100),
    'fareVersion', b.matmove_fare_version,
    'bookingStatus', b.status,
    'paymentStarted',
      EXISTS (
        SELECT 1
          FROM public.ride_payments
         WHERE booking_id = b.id
      ),
    'selectedDriverId',
      coalesce(
        (
          SELECT driver_id
            FROM public.matmove_ride_fare_offers
           WHERE booking_id = b.id
             AND status = 'accepted'
        ),
        b.driver_id
      ),
    'serverTime', now(),
    'offers', v_offers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.matmove_read_ride_fares(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matmove_read_ride_fares(uuid, uuid) TO authenticated, service_role;
