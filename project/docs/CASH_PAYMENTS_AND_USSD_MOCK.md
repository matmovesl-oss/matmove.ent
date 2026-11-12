# MatMove Cash + Guest USSD Payment — Mock Build

Status: **prototype branch only**. These screens and calculations are local mock behavior. They do not alter production bookings, wallet balances, Monime accounts, merchant settlements or ride ledgers.

## Cash ride commercial rule

The prototype uses the agreed working assumption: **SLE 100 fare = SLE 85 physical cash to the driver + SLE 15 MatMove fee paid digitally**. The customer’s total cost remains SLE 100. All arithmetic is performed in integer minor units (cents); the driver portion is rounded to the nearest cent and MatMove receives the remainder so the two portions always equal the original fare.

The customer demo screen previews:
- total fare,
- physical cash due to the driver,
- 15% fee to be secured from the customer’s SLE wallet,
- fee-reserved / completed / released example states.

No real wallet balance is read or debited by the preview. The current live booking RPC still accepts exactly its existing 11 fields and the existing digital ride path still escrows the full fare. The preview is deliberately not wired into live booking submission.

## Production cash ledger — required before activation

Do **not** reuse `ride_payments` or `ride_payment_transfers`; those tables are the existing full-fare digital escrow. Implement dedicated, immutable cash-payment records and separate provider-transfer legs.

Draft schema foundation added in `20261112180000_matmove_cash_ride_ledger_foundation.sql` (Customer PR only; not applied to Production):

- `matmove_cash_ride_payments`: one immutable fare snapshot per booking, with the rider, one-time driver assignment, SLE fare in cents, 85% physical driver cash, 15% MatMove fee, dual confirmation fields, review-resolution fields and a version counter. Database checks conserve the fare and enforce the 85/15 split.
- `matmove_cash_ride_legs`: one idempotent reserve, capture or refund leg per booking/kind, with fixed amount, source/destination account references, stable request key, unique provider transfer ID and exact verified receipt fields. A leg cannot be marked completed without exact SLE amount, source, destination, provider reference and verification timestamp.
- `matmove_cash_ride_audit_events`: append-only cash lifecycle audit trail. Store sanitized event metadata only; never raw Monime payloads or credentials.
- All three tables have RLS enabled and no browser-role grants. Only `service_role` can access them. Immutable guards prevent deletion/rewriting of cash records, transfer identity and verified receipts.
- A private service-role-only state machine. User-facing routes validate the Supabase session and profile role, KYC approval, account ownership, wallet/profile freeze flags, driver eligibility, current assignment, fare and idempotency key before calling the protected RPCs.
- A server-side cash fee reserve at booking creation: transfer only the 15% MatMove fee from the rider’s SLE Monime financial account into a **dedicated restricted cash-fee holding account**. Do not make the trip dispatchable or accept-able until Monime confirms the exact amount, SLE currency, source, destination, MatMove reference and completed status. Pending, failed, mismatched or uncertain receipts fail closed; never create a second POST after an uncertain attempt.
- At verified trip completion, require the assigned driver’s cash-collection attestation and customer confirmation (or an audited Admin resolution) before moving the reserved fee from the restricted holding account into the MatMove fee account. Record both attestations and immutable audit events. Do not count the SLE 85 cash as a digital wallet credit.
- Pre-acceptance cancellation or assigned-driver cancellation: return the reserved fee to the rider using an idempotent, verified refund leg. Accepted-rider cancellation remains blocked/manual-review until the approved cancellation fee and 50/50 allocation are configured; do not invent or infer it.
- Any cash shortfall, dispute, stale driver assignment, frozen wallet, KYC revocation, changed account link, amount mismatch or failed provider receipt goes to manual review. Do not mark paid/completed or release the fee because a browser says “success”.
- Admin endpoints return a permission-scoped summary only. Finance/Dispatch staff see booking reference, fare, driver cash due, MatMove fee, reservation/capture/refund status, driver/customer confirmation timestamps, Monime transfer references and exception state. No raw provider credentials, secrets or unnecessary phone details in the UI.

### Required test matrix

1. Exact arithmetic: SLE 100 -> SLE 85 + SLE 15; cent rounding; zero/negative/over-limit/invalid decimals rejected.
2. Insufficient rider fee balance; no booking dispatch; no provider request.
3. Reserve completed, failed, pending, mismatched or timeout; idempotent retries and duplicate requests.
4. KYC/frozen wallet/wrong rider/wrong assigned driver/account relink guard failures.
5. Duplicate/out-of-order webhooks and current-object verification.
6. Driver attests cash received; rider confirms; no completion if either is missing.
7. Driver cancellation/pre-accept cancellation refund; accepted-rider cancellation remains blocked pending the agreed policy.
8. Capture/refund provider legs reconcile exactly once; uncertain POST moves to manual review.
9. Admin permission isolation, audit history, pagination and reconciliation exports.

## Guest USSD / WhatsApp payment concept

Guest payers do not need a MatMove login. They receive a unique booking/order reference from MatMove via WhatsApp or another assisted channel.

1. The booking or merchant order is created server-side and quoted. It starts unpaid and receives a high-entropy, expiring reference. The WhatsApp agent shares the reference, amount and MatMove’s published USSD short code. A guest reference is not an authorization secret and cannot be used to change the price.
2. The payer dials the Monime USSD Flow code on a basic phone. The menu offers Ride, Food, Package, Rental or Merchant Order. The guest enters their reference.
3. Monime sends the entered answer to the MatMove USSD Exchange endpoint. The endpoint validates the flow session, encrypted request signature, reference, expiry, exact amount, order status and allowed payment use. It returns the next USSD screen and a short-lived one-time Payment Code target.
4. The Monime flow invokes `collect_payment` against that Payment Code. The payer selects Orange Money or Afrimoney and enters their PIN on the operator-controlled prompt. MatMove never asks for or receives the mobile-money PIN.
5. The USSD screen may say “Request submitted” only. MatMove records the order as paid only after the signed Monime webhook is durably stored and the current Payment object is fetched and independently checked: completed status, exact SLE amount, unique MatMove reference, Payment Code Ownership Graph lineage, Space/financial account and expected channel. Duplicate or late events do not create duplicate credits or fulfilments.
6. MatMove sends a WhatsApp/SMS receipt to the payer’s supplied number and updates the merchant/driver/order ledger only through the relevant idempotent fulfilment/settlement path.

### Scope by user type

- **Riders / guest customers:** can pay one-off rides and orders without a MatMove account; the order reference links payment to the booking.
- **Merchants:** get an order-specific reference/USSD collection path, then their merchant settlement is recorded through the existing merchant settlement ledger. A payment receipt is not itself a merchant payout.
- **Drivers:** keep verified MatMove driver accounts for accepting trips and receiving earnings. USSD can provide future balance/earnings inquiry and guarded cash-out initiation, but never pay a driver merely because someone knows a phone number or booking reference. Payout requires authenticated driver identity, step-up verification, limits, idempotency and the existing verified payout ledger.

### Monime flow format and test gates

The draft JSON follows Monime Flow Definition version 1.0: pages have typed components; the reference prompt calls on_done.action exchange; the server validates the reference and navigates to a collect_payment template with data.amount, data.payment_target_ref and data.payment_reference. The Exchange API request and response are encrypted. Monime requires a matching RSA-2048 keypair for a flow that calls the server, and the Exchange endpoint must respond with HTTP 200 within 10 seconds. The JSON contains a placeholder host and is not publishable until the Exchange endpoint exists and the response data contract is tested.

Monime assigns a 7-digit flow code when the flow is created. A memorable short code is a separate request to Monime support; do not print a made-up USSD code in customer marketing.

### Driver and merchant USSD services

A separate menu can provide registered drivers with trip status and earnings summaries, and registered merchants with paid-order alerts and order status. Identify the caller using the Monime subscriber identity plus a verified MatMove account link; use a one-time challenge to bind or recover access. Keep sensitive balances masked and expose only the minimum data needed. A driver payout/cash-out must still use the authenticated payout backend, step-up verification, limits and the verified idempotent payout ledger. Never pay out to a phone number supplied in a USSD answer. A guest customer needs no MatMove account to pay an order reference, but merchants and drivers remain registered MatMove counterparties for fulfilment and settlement.

### Monime enablement / test gates

- Confirm the MatMove Space has the USSD Flow feature enabled and obtain the actual production/test flow code.
- Confirm the correct Payment Code provider IDs for Orange Money and Afrimoney with Monime for Sierra Leone. Do not assume sample IDs are valid production IDs.
- Confirm exact event names/payloads, amount handling, fees, expiry and whether each channel is supported for the target Payment Code.
- Generate a dedicated RSA-2048 keypair for Exchange. Keep the private key only in server-side secret storage; configure the matching public key in Monime.
- Configure distinct Test and Live API keys and webhook secrets. Test signed callbacks, duplicate delivery, out-of-order delivery, retries, failed payments, expired references and reconciliation using Test credentials.
- Publish the flow only after the Exchange endpoint and webhook verification are deployed and reviewed. Start with Test, not Live.

## Isolated prototype source

- Cash and guest-USSD prototype components remain as local-only source/test fixtures. They are not mounted in the live Rider App and there is no live guest-preview route.
- The seeded Admin cash/guest-USSD sample panel is not mounted in the live Financials page.
- Demo rows are not payment records, driver cash receipts, MatMove fee collections or reconciliation evidence.

### Monime collect_payment prompt requirements

The USSD flow draft uses Monime's built-in `collect_payment` template, which accepts a Payment Code or UVAN in `payment_target_ref`, and a fixed amount supplied from validated server data. The PIN prompt uses Monime's documented `{{amount}}` placeholder, without adding a currency prefix before it; the customer enters the mobile-money PIN on the operator prompt. On successful collection, the page value is the transaction ID. The guest payer does not need a MatMove account. Monime documents the template for Orange Money and Afrimoney.

The Exchange endpoint must decrypt Monime's encrypted request, validate the guest reference and exact open amount, create a short-lived one-time Payment Code, and return an encrypted `navigate` reply within Monime's 10-second window. The actual response schema must be implemented from Monime's Exchange response documentation before this draft is imported or published. This JSON is a **design draft**, not an import-ready/publishable flow until the endpoint, response contract, RSA key, Test Space IDs and webhook verification are in place. Never infer that the USSD template's success screen alone settles or fulfils the MatMove order; reconcile the signed webhook and current Payment object first.


## 12 November 2026 — cash ledger foundation checkpoint

The Customer Draft PR now contains the first dedicated schema foundation for physical-cash rides. This is a code-branch milestone only: the migration has **not** been applied to Production.

Important limitations remain explicit:
- The migration adds private tables and immutable/audit safeguards only. It does not add reserve/capture/refund APIs, provider workers, booking-dispatch gating, customer confirmation screens, an Admin cash-collection endpoint or a live reconciliation dashboard.
- No production cash records are created and no customer wallet, driver wallet, booking, payment, ledger or Monime account is changed by this migration.
- Production does not currently have a dedicated restricted cash-fee holding account configured. A general MatMove Treasury or Platform Fee account must not be substituted. Before any reserve request, Monime must confirm and provision the correct restricted holding account and its Test/Live identifiers.
- Each cash reserve must debit only the authenticated rider's verified SLE Monime financial account and credit that restricted holding account. Capture must move the exact reserved amount from the hold account to the approved fee account only after driver attestation and rider confirmation (or an audited Admin resolution). Refunds must reverse the exact verified reserve leg.
- A pending or uncertain provider POST must be quarantined and reconciled against the same request/reference; it must never trigger a second transfer POST.
- Physical SLE driver cash is never entered as a digital wallet credit or as a driver payout.

The current cash split remains the agreed rule: SLE 100.00 = SLE 85.00 physical cash to the assigned driver + SLE 15.00 MatMove fee secured digitally. Accepted-rider cancellation remains manual-review only until the cancellation fee and 50/50 distribution are explicitly approved.

**Release state: cash collection is still disabled in Production.** Complete the API/state machine, Monime Test verification, Admin permission-scoped reconciliation, booking-dispatch integration and end-to-end test matrix before any Production rollout.


## 12 November 2026 — booking integration and current-object verification checkpoint

The Customer Draft branch has progressed beyond the original schema-only foundation:

- Added `matmove_cash_ride_settings`, disabled by default, with separate restricted fee-hold and fee-revenue account references and a Test/Live environment binding.
- Extended customer trip creation to accept an optional `payment_method: "cash"` only for rider Ride bookings. Cash bookings begin in `cash_reserve_pending` and are not exposed as ordinary dispatchable `pending` bookings.
- Added booking guards that block driver assignment until the 15% fee reserve is verified; block trip start without the verified reserve and assigned driver; block completion until the fee capture is verified; and block cancellation until a required refund is verified.
- Added server-side actions for reserve, accept, start, rider/driver cash confirmation, cancellation, and cash status. They are wired through the existing ride API route; no additional Vercel API route was added.
- The cash transfer worker now stores the Monime transfer ID immediately after POST and independently GETs the current transfer object before recording completion. If GET is unavailable, later attempts only GET the stored ID; no second POST is authorized.
- Added an Admin Financials Cash Collection Manager using the existing Admin transaction API route. It is a permission-scoped, AAL2-protected, read-only view of actual ledger rows and reserve/capture/refund states. It returns a clear unavailable response when the cash schema is absent. The old seeded preview remains unmounted.

### Still blocked from Production

- The two cash migrations are Draft PR files and are not installed in Production. Production has no cash ledger tables or cash state RPCs.
- Production has **zero** named cash/restricted-holding ledger accounts. Monime must confirm/provision the restricted holding account and fee revenue destination; no general Treasury account may be substituted.
- The settings row defaults to disabled. No account IDs or provider environment have been configured for cash.
- No Monime Test transfer has been executed to verify the actual Test Space account IDs, source/destination lineage, pending-to-completed transitions, duplicate webhook behavior or refund.
- Added cash-leg recovery to the existing CRON-protected ride reconciliation endpoint. It only revisits pending/processing cash legs with their stored provider IDs and never issues a second transfer POST. However, the scheduler secret (minimum 32 characters) and recurring schedule are not configured, and no Monime Test recovery run has been verified. Configure the scheduler only after Monime Test verification and the approved hosting plan support the required cadence.
- Accepted-rider cancellation after driver acceptance remains blocked/manual review; the cancellation fee and 50/50 allocation are not approved/configured.
- The Admin Cash Collection Manager is read-only. Admin resolution, exception workflow, audit export and cash settlement approvals remain to be built and reviewed.
- The Customer and Admin Vercel checks must pass on their exact final heads. Customer builds have previously hit the Hobby build quota.

The latest production read-only audit still shows 4 active staff and 0 verified TOTP factors. The Admin AAL2 migration remains unapplied until 4/4 staff enroll and the release window is approved.

**Cash Production state: disabled.** The new application path is protected by default-off settings and the booking state machine, but no production cash collection or money movement has been enabled.


### Rider and Driver cash journey wiring — Draft branch update

- Rider booking now checks the server's cash configuration before enabling the physical-cash payment choice. The option remains disabled unless the configured holding and revenue accounts can both be read from the matching Monime environment as SLE accounts.
- The rider's digital wallet sufficiency check for cash uses only the 15% fee reserve, not the entire fare. The booking payload records `payment_method: "cash"` and uses the same idempotent booking reference to recover a lost reserve response.
- The rider sees the physical driver-cash amount and MatMove fee separately. Cash bookings do not display digital fare negotiation or claim that the entire fare is in escrow.
- The rider's in-progress action records the rider's cash-handover confirmation. It does not claim driver payment or settlement while the driver's confirmation or fee capture is outstanding.
- The assigned driver has a separate **Confirm Cash Received** action. It is actor-bound to the assigned driver; only the actual physical cash receipt should be confirmed.
- The Admin Financials report now includes the cash enablement state and provider environment (without exposing account IDs). It is read-only and displays that collection is disabled when settings say so.
- Rider and Driver UI tests were added to the Customer security suite; Admin API tests cover permission, missing-schema and disabled-state reporting.

These are branch changes only. Production settings are not configured, cash remains disabled, and neither app has been deployed from this Draft PR.


### Cash recovery worker — Draft branch update

The existing ride reconciliation endpoint now includes cash-leg recovery without creating a thirteenth API route. It reads only pending/processing cash legs, calls the existing current-object GET path for the stored Monime transfer ID, and leaves uncertain cases in manual review. The same endpoint rejects absent or shorter-than-32-character scheduler secrets. It does not initiate a new cash transfer POST during reconciliation.

This is code support, not an active scheduled worker. The Production scheduler secret and schedule are not configured; no provider Test recovery run has been completed. Production cash remains disabled.
