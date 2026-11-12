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

Suggested design (final names may be adjusted after schema reconciliation):

- `matmove_cash_ride_payments`: one row per booking; immutable rider/driver IDs, quoted fare minor, driver cash minor, MatMove fee minor, currency SLE, reserved/settled/refunded state, fee-hold account, fee revenue account, provider reference, version and timestamps.
- `matmove_cash_ride_legs`: idempotent reserve / capture / refund operations; unique (booking, leg kind), stable request key, amount, source and destination, provider transfer ID, attempted timestamp, verified receipt and terminal status. No direct browser grants; RLS enabled.
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

## Included mock screens

- Customer Rider page: local cash-fee reservation/completion/refund simulation.
- Public `/guest-payment-preview` page: no-account guest checkout, Orange Money/Afrimoney selection and a simulated verified event.
- Admin Financials page: sample cash collection/fee status and guest USSD payment rows. All rows are demo data and must not be mistaken for live transactions.

### Monime collect_payment prompt requirements

The USSD flow draft uses Monime's built-in `collect_payment` template, which accepts a Payment Code or UVAN in `payment_target_ref`, and a fixed amount supplied from validated server data. The PIN prompt uses Monime's documented `{{amount}}` placeholder, without adding a currency prefix before it; the customer enters the mobile-money PIN on the operator prompt. On successful collection, the page value is the transaction ID. The guest payer does not need a MatMove account. Monime documents the template for Orange Money and Afrimoney.

The Exchange endpoint must decrypt Monime's encrypted request, validate the guest reference and exact open amount, create a short-lived one-time Payment Code, and return an encrypted `navigate` reply within Monime's 10-second window. The actual response schema must be implemented from Monime's Exchange response documentation before this draft is imported or published. This JSON is a **design draft**, not an import-ready/publishable flow until the endpoint, response contract, RSA key, Test Space IDs and webhook verification are in place. Never infer that the USSD template's success screen alone settles or fulfils the MatMove order; reconcile the signed webhook and current Payment object first.
