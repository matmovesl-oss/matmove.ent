-- Fix the legacy Driver KYC wrapper: the underlying secure submission RPC
-- returns a success receipt, not a profile_id property. Bind driver profile
-- writes to the authenticated caller ID rather than a missing/client field.
CREATE OR REPLACE FUNCTION public.submit_customer_kyc_v2(p_role text, p_first_name text DEFAULT ''::text, p_last_name text DEFAULT ''::text, p_phone text DEFAULT ''::text, p_address text DEFAULT ''::text, p_documents jsonb DEFAULT '[]'::jsonb, p_vehicle_type text DEFAULT NULL::text, p_plate_number text DEFAULT NULL::text, p_operating_region text DEFAULT NULL::text, p_driver_license_no text DEFAULT NULL::text, p_license_class text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_profile_id uuid;
  v_documents jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_role NOT IN ('rider', 'driver', 'merchant') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  /*
    ----------------------------------------------------------
    NORMALIZE KYC DOCUMENT STORAGE PATHS
    ----------------------------------------------------------

    The frontend stores the Supabase Storage path in `id`
    because DocumentUpload receives it from data.path.

    The database requires `storage_path`.

    Therefore:
      storage_path = existing storage_path
      OR
      storage_path = id
  */

  IF jsonb_typeof(p_documents) <> 'array' THEN
    RAISE EXCEPTION 'KYC documents must be an array';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN NULLIF(
          TRIM(COALESCE(document_item->>'storage_path', '')),
          ''
        ) IS NOT NULL
        THEN document_item

        ELSE document_item ||
          jsonb_build_object(
            'storage_path',
            NULLIF(
              TRIM(COALESCE(document_item->>'id', '')),
              ''
            )
          )
      END
    ),
    '[]'::jsonb
  )
  INTO v_documents
  FROM jsonb_array_elements(p_documents) AS document_item;

  /*
    Every submitted KYC document MUST have a storage path.
  */

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_documents) AS document_item
    WHERE NULLIF(
      TRIM(COALESCE(document_item->>'storage_path', '')),
      ''
    ) IS NULL
  ) THEN
    RAISE EXCEPTION
      'Every KYC document must contain a storage path';
  END IF;

  /*
    ----------------------------------------------------------
    DRIVER VALIDATION
    ----------------------------------------------------------
  */

  IF p_role = 'driver' THEN

    IF p_vehicle_type IS NULL
       OR p_vehicle_type NOT IN (
         'Bike',
         'Car',
         'Van',
         'Keke'
       )
    THEN
      RAISE EXCEPTION
        'Vehicle type must be Bike, Car, Van, or Keke';
    END IF;

    IF NULLIF(TRIM(p_plate_number), '') IS NULL THEN
      RAISE EXCEPTION
        'License plate number is required';
    END IF;

    IF NULLIF(TRIM(p_operating_region), '') IS NULL THEN
      RAISE EXCEPTION
        'Operating region is required';
    END IF;

    IF NULLIF(TRIM(p_driver_license_no), '') IS NULL THEN
      RAISE EXCEPTION
        'Driver license number is required';
    END IF;

    IF NULLIF(TRIM(p_license_class), '') IS NULL THEN
      RAISE EXCEPTION
        'Driver license class is required';
    END IF;

  END IF;

  /*
    ----------------------------------------------------------
    CALL THE EXISTING SECURE KYC FUNCTION
    ----------------------------------------------------------
  */

  v_result := public.submit_customer_kyc(
    p_role,
    p_first_name,
    p_last_name,
    p_phone,
    p_address,
    v_documents
  );

  -- The secure KYC RPC is scoped to auth.uid() and returns a success
  -- receipt, not a profile_id field. Never derive this target from client data.
  IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'KYC submission was not confirmed.';
  END IF;

  v_profile_id := v_uid;

  /*
    ----------------------------------------------------------
    SAVE DRIVER INFORMATION
    ----------------------------------------------------------
  */

  IF p_role = 'driver' THEN

    UPDATE public.profiles
    SET
      vehicle_type = p_vehicle_type,
      plate_number = TRIM(p_plate_number),
      operating_region = TRIM(p_operating_region),
      driver_license_no = TRIM(p_driver_license_no),
      updated_at = now()
    WHERE id = v_profile_id;

    INSERT INTO public.driver_profiles (
      profile_id,
      license_number,
      license_class
    )
    VALUES (
      v_profile_id,
      TRIM(p_driver_license_no),
      TRIM(p_license_class)
    )
    ON CONFLICT (profile_id)
    DO UPDATE SET
      license_number = EXCLUDED.license_number,
      license_class = EXCLUDED.license_class;

    v_result :=
      v_result ||
      jsonb_build_object(
        'vehicle_type',
        p_vehicle_type,

        'plate_number',
        TRIM(p_plate_number),

        'operating_region',
        TRIM(p_operating_region),

        'driver_license_no',
        TRIM(p_driver_license_no),

        'license_class',
        TRIM(p_license_class)
      );

  END IF;

  RETURN v_result;
END;
$function$
;