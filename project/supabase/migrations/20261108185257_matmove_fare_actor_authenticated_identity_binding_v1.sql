
CREATE OR REPLACE FUNCTION public.matmove_fare_actor(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role text;
  v_actor uuid := auth.uid();
  v_jwt_role text := auth.role();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH: User identity is required.';
  END IF;

  -- Client calls must be bound to the signed-in identity.
  -- Only trusted service-role requests may supply a different identity.
  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR p_user_id IS DISTINCT FROM v_actor) THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller identity mismatch.';
  END IF;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH: Sign in to continue.';
  END IF;

  v_role := public.matmove_preferences_role(p_user_id);

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND coalesce(is_wallet_frozen, false)
  ) OR EXISTS (
    SELECT 1
    FROM public.wallets
    WHERE user_id = p_user_id
      AND coalesce(is_frozen, false)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Wallet is frozen. Contact support.';
  END IF;

  IF v_role IN ('driver', 'merchant')
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles
       WHERE id = p_user_id
         AND kyc_status::text = 'approved'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Approval is required before negotiating fares.';
  END IF;

  RETURN v_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.matmove_fare_actor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matmove_fare_actor(uuid) TO service_role;
