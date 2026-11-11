# MatMove wallet top-up ledger readiness

**Audit date:** 11 November 2026  
**Status:** Not cleared for automatic local-ledger settlement

## Current customer payment-code path

The Customer API creates a one-time Monime Payment Code for the authenticated user's linked SLE financial account. The status route retrieves that code from Monime and validates its identifier, owner metadata, purpose, SLE amount and linked account. A completed provider lifecycle is shown as completed; an optional receipt lookup attempts to match a completed Payment by the Payment Code reference or ownership graph and returns the provider payment ID, actual fee and net credit.

That receipt lookup is informational only. It does not create or finalize a row in `public.payment_transactions`, and the current Payment Code handler does not call `settle_wallet_topup`. The Customer dashboard reads available balance from the verified Monime financial account.

## Production database findings (read-only)

- `public.settle_wallet_topup(uuid,text,jsonb)` exists and is executable only by `service_role`; it is not executable by `anon` or `authenticated`.
- The RPC expects an existing pending `payment_transactions` row linked to the correct user and wallet. It posts a balanced ledger transaction, debits a MatMove treasury ledger account, credits the wallet-liability ledger account, updates `wallets.balance`, records a wallet transaction and finalizes the payment row.
- No other public database function references `settle_wallet_topup`.
- The 11 November 2026 read-only aggregate query found **11** rows with `transaction_type = 'wallet_topup'`, `provider = 'monime'` and `status = 'pending'`. This aggregate does not identify which provider receipts, if any, match those records.

## Why automatic settlement must remain disabled

The current Payment Code is created against the customer's linked Monime financial account. The existing ledger RPC accounts for a top-up by debiting `MATMOVE_TREASURY_SLE` or `MATMOVE_TREASURY_USD` and crediting the customer's wallet liability. These are not automatically equivalent funding paths. Calling the RPC without first proving where the underlying funds are held and which ledger asset represents them could create a MatMove accounting balance unsupported by the provider settlement.

Do not replay or settle the 11 pending rows from status labels, redirects, amounts alone, or webhook event names. Do not insert a local credit just because the Payment Code status is completed.

## Required release work

1. Confirm with Monime whether customer-linked financial accounts are legally/operationally owned by the customer or held under MatMove's omnibus/treasury arrangement, and identify the correct asset ledger account for each model.
2. Define the canonical local pending-payment record before creating a Payment Code. Persist a stable idempotency key, user, wallet, currency, requested wallet credit, quoted gross collection amount, fee policy version and provider Payment Code reference.
3. Retrieve the current provider Payment object server-side. Require exact account, payment-code ownership/reference, terminal completed status, amount, currency and unique provider payment ID. Derive the actual net credit using the provider's returned fee details; do not trust client values or event labels.
4. Reconcile the provider gross amount, actual fee, net wallet credit and accounting counter-entry. Only then call a service-role-only, idempotent ledger settlement RPC.
5. Add tests for duplicate callbacks, concurrent retries, altered references, amount/currency/account mismatch, missing fee details, frozen wallets, insufficient/missing ledger accounts, already-completed payments and rollback on unbalanced entries.
6. Reconcile the 11 pending production rows against actual provider receipts individually before any manual correction. Keep the wallet ledger and available provider balance visibly distinct until they reconcile.

## Safety boundary

This document records an implementation blocker. It does not authorize a production migration, wallet adjustment, provider transfer, refund, payout, replay or automatic settlement. The existing customer-facing live balance remains a provider balance, not proof that the local MatMove double-entry top-up ledger has been posted.
