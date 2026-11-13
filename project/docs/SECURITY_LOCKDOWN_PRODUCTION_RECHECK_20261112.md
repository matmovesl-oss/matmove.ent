# MatMove Production Security Recheck — 12 November 2026

Read-only recheck against Production Supabase project `jjqtpnrnfzlwhnvhbsdy` and the current Customer/Admin security branches.

## Scope and safety boundary

This review did not apply migrations, change grants or Auth settings, deploy either application, modify wallets or ledger rows, or call Monime. No secret values were retrieved. The two security pull requests remain Draft and unmerged.

## Corrections confirmed from live Production

### Spin Admin snapshot scope repair is installed

Production migration history includes `20261112132330_matmove_spin_admin_snapshot_permission_scope_lockdown`. The live `matmove_spin_admin_snapshot()` definition now returns configuration to the `games.settings` role, entry totals only to `games.entries`, winnings only to `games.winnings`, and reserved totals only to `games.overview` or `games.winnings`. Raw round, receipt and player-access arrays are not returned. This resolves the previously documented snapshot permission-scope mismatch; keep the regression test and migration in the release evidence.

### Idempotency isolation migrations do not require a caller key

Production contains `20261108180754_matmove_wallet_transfer_idempotency_isolation_v1` and `20261108180757_matmove_conversion_withdrawal_idempotency_isolation_v1`. The live function definitions still show that the caller key is optional:

- `transfer_wallet_funds(..., p_idempotency_key text DEFAULT NULL)` only enters its duplicate-request lock/lookup when a key is non-null.
- `initiate_wallet_withdrawal(..., p_idempotency_key text DEFAULT NULL)` generates a new `WD-...` key when the caller omits or blanks the key.
- `convert_wallet_currency(..., p_idempotency_key text DEFAULT NULL)` generates a new `FX-...` key when the caller omits or blanks the key.

The isolation migrations prevent collisions across users/operations but do not close retry duplication when a client omits a stable key. This remains a release blocker for any direct FlutterFlow/client invocation. Before changing the SQL contract, inspect the FlutterFlow actions/custom functions/export, verify the key is generated once per user action and reused on retry, then make a coordinated client + SQL change with duplicate and concurrent-retry tests. Do not patch Production directly.

## Cash and staff-MFA release gates remain absent in Production

The current Production migration history does not include the Customer Draft cash-ledger/state-machine migrations or the Admin Draft AAL2 migration. The Production cash settings/payment/leg schema is therefore not installed. Cash remains unavailable; do not interpret the Draft cash UI or Admin read-only cash manager as live collection capability.

The Admin AAL2 staff migration is not installed. Prior read-only staff inventory remains 4 active staff and 0 verified TOTP factors. Do not enforce AAL2 until all four staff complete verified enrollment and the coordinated cutover is approved.

## Current exact-head automation

- Customer PR #11 is Draft/open at `f72975c743a3ba03f37cd92489c53dc5bbf0b192`; its latest Customer CI and Security Validation runs completed successfully.
- Admin PR #10 is Draft/open at `456d17cd8e3888687ae61713aba9a49ee5e4e874`; its latest Admin CI completed successfully.
- Exact-head Vercel checks remain blocked by the Vercel Hobby daily build-rate limit; a prior READY Preview is not evidence for a newer head.

## Next required work

1. Verify FlutterFlow wallet RPC call arguments and stable idempotency-key lifecycle.
2. Complete the remaining function-by-function SECURITY DEFINER authorization/data-scope review; the Advisor count alone is not a vulnerability count.
3. Complete Monime Test reconciliation and cash reserve/capture/refund/dual-confirmation tests using isolated Test accounts.
4. Enroll all four Admin staff in verified TOTP, then review and schedule the AAL2 cutover.
5. Configure and test protected reconciliation workers only after isolated Test verification; Production currently has no `CRON_SECRET` or schedule.
6. Resolve Vercel commercial hosting/build quota and Supabase leaked-password protection plan requirements before commercial Production approval.

**Release status:** not Production-ready. Keep both PRs Draft. No Production action is authorized by this note.


### 12 November 2026 — exact-head preview correction

After the preceding note was committed, the Customer PR advanced to commit `99a0b3a0d271798c3733790bf3bd169c702f789c`. Vercel now reports an exact-head Customer Preview deployment as **READY**:

- Deployment: `dpl_VehRWuacezJygmrRHWUisj7i3dtx`
- Preview: https://matmove-20hvoh27d-matmovesl-5262s-projects.vercel.app
- Git branch: `security/monime-webhook-lockdown-20261109`
- Exact deployed commit: `99a0b3a0d271798c3733790bf3bd169c702f789c`

This supersedes the preceding sentence about the Customer exact-head Vercel check being blocked. It does not change Production: the deployment target is a Preview, not Production. Customer CI is green on this commit; Security Validation was still running at the time of this addendum.

Admin PR #10 remains at `456d17cd8e3888687ae61713aba9a49ee5e4e874`; its CI is green, while its Vercel status remains failed due to the Hobby daily build-rate limit.

No Production deployment, migration, Auth setting, grant, financial record or Monime operation was changed.
