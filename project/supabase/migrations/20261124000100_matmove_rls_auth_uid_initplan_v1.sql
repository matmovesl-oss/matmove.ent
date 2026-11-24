begin;

-- Convert row-level auth.uid() references to statement-level scalar subqueries.
-- The predicates, policy names, commands, roles and permissive modes are preserved.
-- This lets PostgreSQL evaluate the JWT subject once per statement instead of
-- repeatedly for each candidate row. No policy is added, removed or broadened.

ALTER POLICY "admins_select_own" ON public."admins"
  USING (
  (id = ( SELECT auth.uid() ))
);

ALTER POLICY "Merchants update orders" ON public."app_orders"
  USING (
  (( SELECT auth.uid() ) = merchant_id)
);

ALTER POLICY "Riders insert orders" ON public."app_orders"
  WITH CHECK (
  (( SELECT auth.uid() ) = rider_id)
);

ALTER POLICY "Users read own orders" ON public."app_orders"
  USING (
  ((( SELECT auth.uid() ) = rider_id) OR (( SELECT auth.uid() ) = merchant_id))
);

ALTER POLICY "Riders can create bookings" ON public."bookings"
  WITH CHECK (
  (( SELECT auth.uid() ) = rider_id)
);

ALTER POLICY "Riders manage cart" ON public."cart_items"
  USING (
  (( SELECT auth.uid() ) = rider_id)
);

ALTER POLICY "Users view own tickets" ON public."event_tickets"
  USING (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "Users can insert own KYC documents" ON public."kyc_documents"
  WITH CHECK (
  (submission_id IN ( SELECT kyc_submissions.id
     FROM kyc_submissions
    WHERE (kyc_submissions.profile_id = ( SELECT auth.uid() ))))
);

ALTER POLICY "Users can view own KYC documents" ON public."kyc_documents"
  USING (
  (submission_id IN ( SELECT kyc_submissions.id
     FROM kyc_submissions
    WHERE (kyc_submissions.profile_id = ( SELECT auth.uid() ))))
);

ALTER POLICY "Users can insert own KYC submissions" ON public."kyc_submissions"
  WITH CHECK (
  (( SELECT auth.uid() ) = profile_id)
);

ALTER POLICY "Users can manage their own kyc" ON public."kyc_submissions"
  USING (
  (profile_id = ( SELECT auth.uid() ))
)
  WITH CHECK (
  (profile_id = ( SELECT auth.uid() ))
);

ALTER POLICY "Users can view own KYC submissions" ON public."kyc_submissions"
  USING (
  (( SELECT auth.uid() ) = profile_id)
);

ALTER POLICY "ledger_accounts_select_own" ON public."ledger_accounts"
  USING (
  (owner_profile_id = ( SELECT auth.uid() ))
);

ALTER POLICY "ledger_entries_select_own" ON public."ledger_entries"
  USING (
  (EXISTS ( SELECT 1
     FROM ledger_accounts la
    WHERE ((la.id = ledger_entries.ledger_account_id) AND (la.owner_profile_id = ( SELECT auth.uid() )))))
);

ALTER POLICY "ledger_transactions_select_own" ON public."ledger_transactions"
  USING (
  (EXISTS ( SELECT 1
     FROM payment_transactions pt
    WHERE ((pt.id = ledger_transactions.payment_transaction_id) AND (pt.user_id = ( SELECT auth.uid() )))))
);

ALTER POLICY "matmove_account_deletion_own_read" ON public."matmove_account_deletion_requests"
  USING (
  (user_id = ( SELECT auth.uid() ))
);

ALTER POLICY "matmove_driver_presence_driver_read" ON public."matmove_driver_presence"
  USING (
  (driver_id = ( SELECT auth.uid() ))
);

ALTER POLICY "matmove_kyc_draft_owner_read" ON public."matmove_kyc_drafts"
  USING (
  (user_id = ( SELECT auth.uid() ))
);

ALTER POLICY "payment_transactions_select_own" ON public."payment_transactions"
  USING (
  (user_id = ( SELECT auth.uid() ))
);

ALTER POLICY "matmove_catalog_insert" ON public."products"
  WITH CHECK (
  ((merchant_id = ( SELECT auth.uid() )) AND matmove_catalog_is_merchant())
);

ALTER POLICY "matmove_catalog_update" ON public."products"
  USING (
  ((merchant_id = ( SELECT auth.uid() )) AND matmove_catalog_is_merchant())
)
  WITH CHECK (
  ((merchant_id = ( SELECT auth.uid() )) AND matmove_catalog_is_merchant())
);

ALTER POLICY "Users can insert own profile" ON public."profiles"
  WITH CHECK (
  (( SELECT auth.uid() ) = id)
);

ALTER POLICY "Users can update own profile" ON public."profiles"
  USING (
  (( SELECT auth.uid() ) = id)
);

ALTER POLICY "Users can view own profile" ON public."profiles"
  USING (
  (( SELECT auth.uid() ) = id)
);

ALTER POLICY "Users can view own wallet transactions" ON public."wallet_transactions"
  USING (
  (EXISTS ( SELECT 1
     FROM wallets
    WHERE ((wallets.id = wallet_transactions.wallet_id) AND (wallets.user_id = ( SELECT auth.uid() )))))
);

ALTER POLICY "wallet_transactions_select_own" ON public."wallet_transactions"
  USING (
  (EXISTS ( SELECT 1
     FROM wallets w
    WHERE ((w.id = wallet_transactions.wallet_id) AND (w.user_id = ( SELECT auth.uid() )))))
);

ALTER POLICY "Users can only view own wallet" ON public."wallets"
  USING (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "Users can view own wallet" ON public."wallets"
  USING (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "Users can view their own wallets" ON public."wallets"
  USING (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "wallets_select_own" ON public."wallets"
  USING (
  (user_id = ( SELECT auth.uid() ))
);

ALTER POLICY "Users can create withdrawal requests" ON public."withdrawal_requests"
  WITH CHECK (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "Users can view own withdrawal requests" ON public."withdrawal_requests"
  USING (
  (( SELECT auth.uid() ) = user_id)
);

ALTER POLICY "withdrawal_requests_select_own" ON public."withdrawal_requests"
  USING (
  (user_id = ( SELECT auth.uid() ))
);

commit;
