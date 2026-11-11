# Supabase SECURITY DEFINER Review — 2026-11-11

## Scope and method

This is a read-only production database review of selected higher-impact functions from the Supabase Security Advisor's authenticated-callable `SECURITY DEFINER` findings. It supplements, but does not replace, a complete review of all 77 Advisor entries.

The review inspected function definitions, execution privileges for `anon`, `authenticated` and `service_role`, function-level `search_path` settings, relevant helper functions, and profile/wallet/staff protection triggers. No production database writes, migrations, grants, secret changes, or provider operations were performed.

## Findings

### Admin and staff functions

- `matmove_admin_account_deletion_requests(text, uuid, text)`: requires a non-null `auth.uid()` matching an active, non-removed owner in `matmove_staff_access`. Listing personal details and changing request state are therefore owner-only. The target request is selected `FOR UPDATE` before review state is changed.
- `matmove_admin_bulk_update_role(uuid[], text)`: requires the caller to be an active, non-removed owner; accepted target roles are `rider`, `driver`, `merchant` and `staff`; the batch is intended to be capped at 100 IDs. The profile audit trigger is attached. Minor input-validation hardening remains possible for NULL arguments; this is not an observed privilege bypass because the function is owner-gated.
- `matmove_admin_set_staff_role(uuid)`: requires the active owner, locks the target profile, resolves and preserves the original customer role, and only marks a verified customer as payroll staff.
- `matmove_admin_trip_review(uuid)`: delegates authorization to `matmove_dispatch_actor()`, which binds the caller to `auth.uid()`, checks `matmove_admin_can('dispatch')`, and requires active, non-removed staff. Trip and fresh GPS details are returned only after that gate.
- `matmove_admin_dispatch_change(...)`: uses the same Dispatch actor guard, checks the expected actor, locks the booking, verifies request-key idempotency and state/version constraints, and refuses dispatch cancellation/reassignment after ride payment processing has started.
- `matmove_admin_set_wallet_frozen(uuid, boolean, text)`: requires `financials` permission, validates the reason, locks the profile and wallet, updates the wallet/profile freeze state, and records staff audit data. The wallet table also has an audit trigger and a freeze guard.
- `matmove_admin_delete_notification(uuid)`: delegates to `matmove_notification_sender()`, which requires an authenticated active, non-removed owner or staff member with the `notifications` permission. The function deliberately marks a selected message deleted for all recipients; this is a broad action within that permission and should remain assigned only to trusted notification operators.

### Customer, merchant and KYC functions

- `matmove_catalog_save(...)`: requires `matmove_catalog_is_merchant()`; that helper binds to the signed-in user, excludes staff identities and resolves the caller's customer role. Updates lock the product and verify `merchant_id = auth.uid()`; create/edit paths use an expected catalog version and validate the WhatsApp number format.
- `matmove_customer_trip_location(...)`: requires a signed-in non-staff user, locks the booking, restricts access to the assigned rider/driver on an active trip, permits sharing only by the rider, checks approved KYC and frozen-wallet state before starting sharing, validates coordinate accuracy/time, and requires the matching share key to publish or clear a session.
- `matmove_review_customer_kyc(...)` and `review_kyc_submission(...)`: require the `kyc` admin assignment. The inspected customer KYC RPC locks the profile and latest submission, checks the expected review version, verifies document storage ownership and metadata, and records reviewer identity/event data.
- `set_currency_rate(text, text, numeric, numeric)`: requires a signed-in user with `financials` permission, restricts conversion pairs to SLE/USD in either direction, validates a positive rate and fee between 0 and 100, then retires the active pair and inserts the new active rate. No unauthenticated execution grant was present.

### Wallet transfer idempotency follow-up

`transfer_wallet_funds(uuid, numeric, text, text, text)` is executable by `authenticated` and not by `anon`. The inspected function binds the sender to `auth.uid()`, limits senders to riders and recipients to approved drivers/merchants, requires both parties to have approved KYC, locks both wallets in deterministic order, checks both freeze states and available balance, and writes paired ledger entries and wallet transaction records.

One material reliability gap remains: `p_idempotency_key` is optional. The function only performs its duplicate-request lookup when a key is supplied; when it is omitted, it generates a new key and posts a new transfer. A caller retry that omits the key can therefore create a second transfer. The Customer and Admin GitHub repositories' default-branch code search did not reveal an RPC call site, so the FlutterFlow/client call path remains unverified. Before enabling or relying on this flow, require a bounded caller-supplied idempotency key and test duplicate/concurrent requests. No live transfer was attempted.

### Arcade administration

The inspected Admin arcade RPCs are all `SECURITY DEFINER`, but none is executable by `anon`:

- `matmove_arcade_admin_report(...)`: requires the exact view permission (`games.settings`, `games.overview`, `games.players`, `games.entries`, or `games.winnings`) through `matmove_admin_any()` / `matmove_admin_can()`. Filters and pagination are bounded.
- `matmove_arcade_admin_save(...)`: requires `games.settings`, validates the settings payload, locks the current configuration and writes an admin event.
- `matmove_arcade_admin_receipt(...)`: requires `games.recovery`, validates the provider-ID shape, locks the round and leg, and records a supplied receipt ID for server reconciliation. Its function body explicitly states that reconciliation must independently match amount, both accounts and metadata. This RPC does not itself credit a wallet; the separate reconciliation path must preserve that requirement.

**High-priority least-privilege finding:** `matmove_spin_admin_snapshot()` is executable by `authenticated` and checks only `matmove_admin_can('games.settings')`. It then calls the private staff-base helper that returns a broad snapshot containing configuration, global financial aggregates, recent round records, recent payment-leg/receipt records, and player access records. Other Spin Admin report RPCs distinguish permissions such as `games.overview`, `games.players`, `games.entries` and `games.winnings`. Therefore, a staff member assigned only `games.settings` can call the snapshot RPC directly and retrieve data beyond the settings permission. This is a confirmed permission-scope mismatch in the function definitions/grants; whether the current UI still calls this legacy snapshot was not established by repository code search. Keep this RPC blocked from narrower roles until its response is split or filtered by the same per-section permissions as the report RPCs. Do not assume a frontend-hidden tab protects a callable database RPC.

The helper `matmove_admin_can(text)` binds authorization to `auth.uid()` and an active, non-removed staff row, then checks owner status or the requested permission. `matmove_admin_any(text[])` only returns whether one of those checks succeeds. The inspected `matmove_spin_admin_access` RPC is not executable by `anon` or `authenticated`; the report and save wrappers enforce their specific permission checks.

## Database-level protection checks

- Selected administrative and arcade RPCs have no `anon` EXECUTE privilege. Authenticated EXECUTE on these functions is gated inside the function/helper body rather than being treated as authorization by itself.
- Function settings inspected use `search_path = pg_catalog` or `pg_catalog, public`; the reviewed table references are schema-qualified.
- `prevent_unauthorized_profile_role_change()` rejects profile-role changes unless the effective database role is `postgres`, `supabase_admin`, or `service_role`. Direct browser-role profile changes therefore fail at the trigger.
- `matmove_staff_protect_profile()` blocks authenticated direct changes to protected staff/profile fields.
- `matmove_guard_wallet_freeze()` blocks unauthorized wallet-freeze changes; `matmove_staff_protect_wallet()` blocks direct wallet changes by authenticated staff.
- `matmove_staff_removal_guard()` preserves revocation records and prevents a removed staff record from retaining active/owner permissions or being silently restored.

### Passcode release alignment

The read-only production function still accepts exactly six digits for new passcodes. The Customer security branch's coordinated migration `20261111120000_matmove_passcode_email_recovery.sql` updates the table constraint and RPC to accept 6–10 digits, while retaining the four-digit legacy verification/upgrade path and the one-time Auth recovery-session binding. The Customer UI validates the same 6–10 digit range. These are aligned on the branch, but the migration is not installed in production. Do not publish the matching Customer code to production before the database migration is applied in the approved release window; otherwise the client will advertise passcodes the live RPC currently rejects.

## Assessment and follow-up

No confirmed anonymous access or cross-user authorization bypass was identified in most of the inspected functions. Two items need corrective follow-up before launch: the Spin Admin snapshot returns broader data than its `games.settings` gate implies, and wallet-to-wallet transfer idempotency can be omitted. The raw Advisor count must not be read as 77 proven vulnerabilities; each callable definer function needs its own authorization and data-scope assessment.

Before release, keep these follow-ups open:

1. Locate the canonical source/migration for `matmove_spin_admin_snapshot()`, then split or filter its response by `games.settings`, `games.overview`, `games.players`, `games.entries` and `games.winnings`. Migration history has no clearly named Spin snapshot migration entry; do not patch production directly.
2. Require a non-null, bounded `p_idempotency_key` for `transfer_wallet_funds`, after confirming the FlutterFlow/client usage, and add retry/concurrency tests.
3. Complete the remaining function-by-function review rather than extrapolating this sample to every Advisor entry.
4. Add authorization-matrix regression tests for owner, assigned staff, unassigned staff, removed staff, customer, merchant, and anonymous callers for the corresponding RPCs.
5. Keep arcade receipt attachment quarantined until its independent server reconciliation verifies the exact provider transaction, amount, currency, source/destination accounts and MatMove reference before any ledger posting.
6. Consider rejecting NULL `p_user_ids` and `p_new_role` explicitly in `matmove_admin_bulk_update_role` for clearer fail-closed input handling.
7. Preserve the existing Auth gates: enroll active staff in MFA before enforcing AAL2, and enable leaked-password protection before production release.

**Change boundary:** this note records read-only observations only. It does not authorize or apply a production migration, alter permissions, enable MFA, change Auth settings, or perform financial operations.
