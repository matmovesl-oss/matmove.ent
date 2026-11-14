-- Enforce separate SLE destinations for every new active digital ride payment.
-- Historical shared-account rows are terminal (released/refunded/failed) and
-- remain readable. NOT VALID avoids rewriting or rejecting those legacy rows,
-- while PostgreSQL enforces this check on every new insert/update.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ride_payments'::regclass
      AND conname = 'ride_payments_active_platform_accounts_distinct'
  ) THEN
    ALTER TABLE public.ride_payments
      ADD CONSTRAINT ride_payments_active_platform_accounts_distinct
      CHECK (
        state IN ('released','refunded','failed')
        OR (
          escrow_account IS NOT NULL
          AND fee_account IS NOT NULL
          AND escrow_account <> fee_account
        )
      ) NOT VALID;
  END IF;
END
$migration$;
