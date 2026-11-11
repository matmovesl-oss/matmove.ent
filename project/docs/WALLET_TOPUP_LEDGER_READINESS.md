# MatMove wallet top-up ledger readiness

**Audit date:** 11 November 2026  
**Status:** Not cleared for automatic local-ledger settlement

## Two different top-up generations

### Current Payment Code path

The current Customer API creates a one-time Monime Payment Code for the authenticated user's linked SLE financial account. The status route retrieves that code from Monime and validates its identifier, owner metadata, purpose, SLE amount and linked account. A completed provider lifecycle is shown as completed; an optional receipt lookup attempts to match a completed Payment by the Payment Code reference or immutable ownership graph and returns the provider payment ID, actual fee and net amount.

The receipt lookup is informational only. It does not create or finalize a row in `public.payment_transactions`, and the current Payment Code handler does not call `settle_wallet_topup`. The Customer dashboard reads available balance from the linked Monime financial account. This provider balance must not be presented as proof that the local MatMove double-entry wallet ledger has been posted.

The receipt matcher now treats a present Monime Ownership Graph as authoritative. A matching local reference cannot override a graph that points to a different Payment Code. Reference-only fallback is allowed only when the provider response omits the graph.

### Legacy Checkout Session cohort in production

Read-only production queries identified **11** pending SLE Monime `wallet_topup` rows, created between **12 September and 16 September 2026**. Aggregate checks found:

- All 11 are marked `provider = monime`, `processor = monime`, and `payment_method = mobile_money`.
- All 11 have a user ID, wallet ID, provider reference, idempotency key, and a stored provider response.
- All 11 have `checkout_session_id` and `checkout_reference` metadata.
- For all 11, `payment_transactions.provider_reference` exactly equals `metadata.checkout_session_id`. The rows therefore belong to the legacy Checkout Session flow, not the current Payment Code flow.
- All 11 local payment rows remain `pending`.
- None of the 11 has a linked `wallet_transactions` row or `ledger_transactions` row.

These are database-shape and relationship findings only. The saved response envelope contains `success`, `messages`, and `result` keys, but the aggregate audit did not validate the current Monime Checkout Session status, the associated Payment, Financial Transaction, fee transactions, or settlement statement for any individual row. A local `pending` label does not prove that the provider payment is pending or failed.

**Do not pass these legacy Checkout Session records through the current Payment Code receipt matcher.** Their provider ownership lineage is expected to begin with a Checkout Session, not a Payment Code. Each must be reconciled against its exact Checkout Session ID and associated provider Payment/Financial Transaction records before any correction.

## Production database and settlement-RPC findings (read-only)

- `public.settle_wallet_topup(uuid,text,jsonb)` exists and is executable only by `service_role`; it is not executable by `anon` or `authenticated`.
- The RPC expects an existing pending `payment_transactions` row linked to the correct user and wallet. It locks the payment, profile and wallet; checks provider, payment type, positive amount, currency, wallet ownership/currency/frozen state and the customer liability ledger account.
- The RPC then debits the global `MATMOVE_TREASURY_SLE` or `MATMOVE_TREASURY_USD` asset account, credits the customer wallet-liability ledger account, updates `wallets.balance`, writes wallet and ledger transactions, and completes the payment row.
- The two global treasury ledger accounts exist and are active. The read-only schema audit did not find a ledger account explicitly mapped to a Monime Financial Account ID. The customer wallet rows do hold a `monime_account_id`, but that does not automatically map the underlying provider asset to the global MatMove treasury control account.
- **The RPC does not independently fetch or validate a Monime Payment/Checkout Session.** It trusts the service-role caller's `p_provider_transaction_id` and `p_provider_response`; the provider transaction ID is optional. A caller that invokes it without independently verifying the exact provider object could post a local credit unsupported by a confirmed receipt.
- No other public database function references `settle_wallet_topup`.
- No ledger or wallet transaction is linked to the 11 pending legacy rows.

## Why automatic settlement must remain disabled

Monime documents a Space as the organizational boundary for a business and its data. Financial Accounts are single-currency internal ledgers held within that Space; each payment, payout and transfer moves money through a Financial Account. The Ownership Graph preserves the lineage of a resource, for example a Payment back to its Checkout Session or Payment Code. These concepts help prove technical flow and account scope, but do not by themselves establish the legal/beneficial ownership of balances for MatMove's customer-linked accounts.

Before posting the local wallet ledger, MatMove must confirm with Monime whether the linked customer financial accounts are:
1. individual sub-ledgers held within Eudenco/MatMove's business Space, with customer balances represented as MatMove liabilities; or
2. accounts whose balances are legally/operationally held for customers under a different custody or settlement arrangement.

The accounting counter-entry must match that confirmed model. If MatMove controls a pooled provider asset, the global treasury asset must be reconciled to the eligible Monime Financial Account balances and statements. If each MatMove wallet is backed by its own Monime Financial Account, the local ledger needs a reliable mapping/control-account design that reconciles each provider account to the corresponding MatMove wallet liability. Do not assume either model solely from the fact that a Monime account ID is stored on a wallet.

## Required release work

1. **Confirm account ownership and asset model with Monime.** Obtain written confirmation of the Space owner, the legal/operational treatment of wallet-linked Financial Accounts, and how balances are safeguarded/settled. Decide whether the correct double-entry asset is a pooled MatMove Monime asset or per-Financial-Account control accounts.
2. **Create the canonical local payment intent before provider collection.** Persist a stable idempotency key, user, wallet, currency, intended net wallet credit, quoted gross collection amount, fee-policy version, source Financial Account ID, payment-generation type, and provider Checkout Session/Payment Code reference before issuing the provider create request.
3. **Verify the right provider object by generation.** For new Payment Codes, fetch the exact current Payment and require completed status, exact Payment Code ownership lineage, account, currency, amount, provider payment ID and fee details. For legacy Checkout Sessions, fetch the exact Checkout Session and its associated Payment and Financial Transaction records; require the Checkout Session lineage, exact amount/currency/account, terminal completed state and actual fee data. Do not identify a payment by amount alone.
4. **Use an idempotent, receipt-aware settlement contract.** Only after server-side provider verification, pass a normalized verified receipt to a service-role-only settlement function. The database function must verify that the pending local intent, exact provider object/reference, account, currency, gross amount, actual fee, net credit, wallet owner, wallet freeze state, and asset-account mapping agree. Persist a unique provider payment ID and idempotency constraint so concurrent/repeated webhook and polling calls cannot credit twice.
5. **Post balanced accounting entries.** Debit the verified provider asset/control account (pooled or per Financial Account, as confirmed), credit the customer's wallet-liability account for the verified net credit, record provider fees separately according to the confirmed settlement model, preserve reserved balance, and write the payment, wallet and ledger records in one database transaction. Reject missing fee details, ambiguous duplicate provider matches, frozen wallets, missing/inactive asset or liability accounts and any unbalanced entry.
6. **Reconcile the 11 legacy rows individually.** For each stored Checkout Session ID, retrieve the current Monime Checkout Session and linked Payment/Financial Transaction/fee records, reconcile the result with the local amount/currency/account/reference and MatMove funding statement, then classify it as confirmed paid, pending, failed/expired, disputed, or unmatched. Only a confirmed provider receipt plus the approved accounting model can justify an audited manual correction. Do not replay the old Checkout Session create request or bulk-settle the cohort.
7. **Test failure and retry cases.** Cover duplicate/out-of-order callbacks, concurrent requests, lost provider responses, altered references, wrong owner lineage, amount/currency/account mismatch, missing fees, multiple matching payments, frozen wallets, insufficient/missing ledger accounts, already completed payments and rollback on an unbalanced posting.

## Supabase and deployment compatibility note

Supabase's 30 October 2026 Data API change means new public-schema tables are no longer automatically exposed by default. Any future settlement-support table must have an explicit exposure decision, RLS and grants designed together; service-only financial records should not be granted to browser roles merely to make a UI query work. Supabase CLI v3 also changes database-command defaults to local unless `--remote` is supplied. Any future migration workflow must pin or explicitly configure the CLI target. No migration was applied as part of this audit.

## Safety boundary

This document is an implementation and reconciliation specification. It does not authorize a production migration, wallet adjustment, provider transfer, refund, payout, replay or automatic settlement. Keep the provider balance and MatMove local wallet ledger visibly distinct until the provider asset model and individual receipts reconcile.
