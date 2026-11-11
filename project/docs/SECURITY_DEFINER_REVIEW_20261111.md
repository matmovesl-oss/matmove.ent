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

### Customer and merchant functions

- `matmove_catalog_save(...)`: requires `matmove_catalog_is_merchant()`; that helper binds to the signed-in user, excludes staff identities and resolves the caller's customer role. Updates lock the product and verify `merchant_id = auth.uid()`; create/edit paths use an expected catalog version and validate the WhatsApp number format.
- `matmove_customer_trip_location(...)`: requires a signed-in non-staff user, locks the booking, restricts access to the assigned rider/driver on an active trip, permits sharing only by the rider, checks approved KYC and frozen-wallet state before starting sharing, validates coordinate accuracy/time, and requires the matching share key to publish or clear a session.

### Arcade administration

The inspected Admin arcade RPCs are all `SECURITY DEFINER`, but none is executable by `anon`:

- `matmove_arcade_admin_report(...)`: requires the exact view permission (`games.settings`, `games.overview`, `games.players`, `games.entries`, or `games.winnings`) through `matmove_admin_any()` / `matmove_admin_can()`. Filters and pagination are bounded.
- `matmove_arcade_admin_save(...)`: requires `games.settings`, validates the settings payload, locks the current configuration and writes an admin event.
- `matmove_arcade_admin_receipt(...)`: requires `games.recovery`, validates the provider-ID shape, locks the round and leg, and records a supplied receipt ID for server reconciliation. Its function body explicitly states that reconciliation must independently match amount, both accounts and metadata. This RPC does not itself credit a wallet; the separate reconciliation path must preserve that requirement.

The helper `matmove_admin_can(text)` binds authorization to `auth.uid()` and an active, non-removed staff row, then checks owner status or the requested permission. `matmove_admin_any(text[])` only returns whether one of those checks succeeds.

## Database-level protection checks

- Selected administrative and arcade RPCs have no `anon` EXECUTE privilege. Authenticated EXECUTE on these functions is gated inside the function/helper body rather than being treated as authorization by itself.
- Function settings inspected use `search_path = pg_catalog` or `pg_catalog, public`; the reviewed table references are schema-qualified.
- `prevent_unauthorized_profile_role_change()` rejects profile-role changes unless the effective database role is `postgres`, `supabase_admin`, or `service_role`. Direct browser-role profile changes therefore fail at the trigger.
- `matmove_staff_protect_profile()` blocks authenticated direct changes to protected staff/profile fields.
- `matmove_guard_wallet_freeze()` blocks unauthorized wallet-freeze changes; `matmove_staff_protect_wallet()` blocks direct wallet changes by authenticated staff.
- `matmove_staff_removal_guard()` preserves revocation records and prevents a removed staff record from retaining active/owner permissions or being silently restored.

## Assessment and follow-up

No confirmed anonymous access or cross-user authorization bypass was identified in the inspected functions. The raw Advisor count must not be read as 77 proven vulnerabilities; each callable definer function needs its own authorization and data-scope assessment.

Before release, keep these follow-ups open:

1. Complete the remaining function-by-function review rather than extrapolating this sample to every Advisor entry.
2. Add authorization-matrix regression tests for owner, assigned staff, unassigned staff, removed staff, customer, merchant, and anonymous callers for the corresponding RPCs.
3. Keep arcade receipt attachment quarantined until its independent server reconciliation verifies the exact provider transaction, amount, currency, source/destination accounts and MatMove reference before any ledger posting.
4. Consider rejecting NULL `p_user_ids` and `p_new_role` explicitly in `matmove_admin_bulk_update_role` for clearer fail-closed input handling.
5. Preserve the existing Auth gates: enroll active staff in MFA before enforcing AAL2, and enable leaked-password protection before production release.

**Change boundary:** this note records read-only observations only. It does not authorize or apply a production migration, alter permissions, enable MFA, change Auth settings, or perform financial operations.
