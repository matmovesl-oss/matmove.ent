
CREATE OR REPLACE FUNCTION public.matmove_dispatch_booking_visible(
  p_rider uuid,
  p_driver uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  role_name text;
BEGIN
  IF public.matmove_admin_can('dispatch') THEN
    RETURN true;
  END IF;

  SELECT role::text
  INTO role_name
  FROM public.profiles
  WHERE id = auth.uid();

  IF role_name = 'driver' THEN
    RETURN COALESCE(
      p_rider = auth.uid()
      OR public.matmove_driver_radar_visible(p_rider, p_driver, p_status),
      false
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matmove_staff_access
    WHERE id = auth.uid()
  ) THEN
    RETURN COALESCE(
      p_rider = auth.uid() OR p_driver = auth.uid(),
      false
    );
  END IF;

  -- All other signed-in customers can only read bookings they own.
  -- Never default to TRUE: permissive RLS policies combine with OR.
  RETURN COALESCE(
    p_rider = auth.uid() OR p_driver = auth.uid(),
    false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.matmove_dispatch_booking_visible(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matmove_dispatch_booking_visible(uuid, uuid, text) TO authenticated;
