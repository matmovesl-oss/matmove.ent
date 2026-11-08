-- Fix permissive booking visibility fallback.
-- PostgreSQL combines permissive RLS policies with OR, so this helper must
-- never return TRUE for an unrelated authenticated customer.

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

  -- Riders and all other signed-in customers can only read a booking
  -- where they are the rider or assigned driver.
  RETURN COALESCE(
    p_rider = auth.uid() OR p_driver = auth.uid(),
    false
  );
END;
$function$;

-- This helper is needed by the authenticated RLS policy, but is never
-- callable anonymously. The function itself binds the check to auth.uid().
REVOKE ALL ON FUNCTION public.matmove_dispatch_booking_visible(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.matmove_dispatch_booking_visible(uuid, uuid, text) TO authenticated;
