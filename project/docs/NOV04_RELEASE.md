# MatMove November 4 release

## What is already changed in the connected database

All four migrations (claims, assignments, restrictive legacy repair and Concierge management) are now applied to the connected MatMove.Ent database and passed read-only readiness checks. All three original Concierge services remain present. The existing payroll/refund ledgers were verified with RLS enabled and browser table access denied. The restrictive legacy RPC migration was applied on November 4: anonymous mutation access removed, legacy gateway/settlement/wallet-setup operations restricted to server roles, owner verification added to role changes, and browser access to the KYC storage view removed. No wallet balances, provider payments, accounts, grants or campaign switches were changed.

## What is in the review branches

- Payroll and refunds: verified current Admin authorization; dedicated business source; server-selected eligible recipient; exact minor units; immutable original request; single-use SQL transfer claim; strict provider receipt verification; terminal-state protection; retained uncertain requests; reviewed payroll batches and customer refunds.
- Admin entrance/sidebar: verified permissions replace email-based owner bypass, recovery remains gated, all current routes retained.
- Concierge: add/edit title, category, description, price label, availability and order; archive preserves history; enquiries show customer details and quoted price snapshots; paginated enquiry management; stale edits rejected; exact retries idempotent; private audit records.
- Customer Concierge uses the database catalog rather than three hardcoded prices and records authenticated owned enquiries. No Concierge card/wallet collection is introduced.

## Release steps

1. Install/test the local replacement package, or inspect the two draft pull requests. Your uploaded unpushed Stage 1 changes are included. Do not use git reset, git clean, git add . or a force push. The installer checks known existing file hashes before writing and backs up replacements outside Git.
2. Keep MATMOVE_ADMIN_MONEY_ENABLED=false in the Admin Vercel server environment. Configure the dedicated payroll/refund source IDs, MONIME_SPACE_ID, MONIME_API_KEY and MONIME_ENVIRONMENT. Secrets belong only in server settings. The API accepts the corrected PAYROLL variable and the legacy PAYROLE spelling as a fallback. Redeploy after settings change.
3. The claim, permission registry and Concierge migrations are already installed in the connected MatMove.Ent database. Keep RLS enabled. The lockdown migration is repeatable and already applied. Run both readiness queries. Deploy matching Admin and Customer builds, then verify authenticated Concierge creation/editing/enquiry flow and read-only source balances before enabling new money transfers.

Stage 1: 20261104000100_admin_money_ledgers.sql (already installed).
Stage 2: 20261104000200_admin_money_claims.sql.
Assignments: 20261104000300_admin_permission_registry.sql.
Restrictive legacy fix: 20261104000400_legacy_rpc_lockdown.sql (already applied).
Concierge: 20261104000500_concierge_management.sql (preserves existing three services).

The owner can open Concierge immediately after deployment. Other staff require an explicit Concierge assignment from the owner. Concierge enquiries are not proof of payment; status Completed means the enquiry was handled. Prices are display quotes with currency/unit labels, not amounts charged by a payment handler.

## Evidence and remaining checks

Local tests use real temporary PostgreSQL SQL execution plus simulated Monime responses. They cover duplicate/concurrent clicks, lost responses, removed assignments, wallet freezes, receipt mismatch, stale versions, browser privilege denial, enquiry privacy and migration reruns. Both production builds pass. Builds still warn about bundle size; Admin Browserslist data is outdated.

No live Monime transfer or Vercel environment verification has been performed. Main branches have not been merged or pushed by this release. Do not call payment settlement production-verified until the paused deployed endpoints and a reviewed test-environment payment have been checked.

This is a targeted repair, not a completed whole-platform security audit. Remaining database advisories include older mutable function search paths and disabled leaked-password protection. Tables intentionally using server-only access may correctly have RLS enabled and no browser policies; do not add permissive policies to silence that advisory. Reference: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Customer build repairs included

The uploaded current Customer source had missing map/icon imports and two calls passing browser-calculated cancellation amounts to a service that accepts only intent/booking ID. Those compile errors are repaired without passing amounts from the browser. Ride cancellation fees remain the backend's responsibility; this release does not certify the older five-minute fee message or redesign cancellation policy.

## Repository comparison

Connected Admin main was one commit newer than the uploaded snapshot (000486b); it only adds test/admin-reconcile-topups.mock.test.mjs. That commit is preserved in the review branch. Its imported api/admin-reconcile-topups.js is absent on connected main, so that unrelated reconciliation test is not counted as passing. Customer main matches the uploaded 6e46923 snapshot. Targeted Home tests were aligned to the current component split and skeleton loading labels; their privacy and no-automatic-payment checks remain enforced.
