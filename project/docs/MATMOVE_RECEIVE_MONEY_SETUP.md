# MatMove Receive Money — Monime setup

This feature is deployed behind server-side switches. Keep both switches disabled until the Monime dashboard flow, webhook subscriptions and test credentials have been checked.

## What the customer sees

- A wallet owner creates one secure URL: `https://matmove.space/pay/<opaque-slug>`.
- The owner can also share the short recipient code, formatted as `MM-XXXXXXXX`.
- Smartphone users open the URL, confirm the displayed recipient, enter an amount in SLE and continue to Monime hosted checkout.
- Basic-phone users dial the USSD access code published by Monime, select the MatMove Receive Money flow, enter the recipient code and amount, confirm the recipient, then approve with their mobile-money PIN.
- The encrypted exchange resolves the short code to the recipient's verified SLE UVAN and supplies that UVAN only to Monime's `collect_payment` template. Each USSD session has its own MatMove payment reference and metadata.
- MatMove only marks an incoming payment completed after retrieving the matching completed Monime object and checking its account, currency, amount, reference and private MatMove metadata.
- An SMS receipt is optional. It is queued only after verified completion and only when the recipient has opted in.

The UVAN and Monime financial-account ID remain server-side. The public page reveals only the customer's display name and short recipient code.

## API and data

- USSD exchange URL: `https://matmove.space/api/get-live-wallet?action=receive_ussd_exchange`
- Public link lookup: `GET https://matmove.space/api/get-live-wallet?action=receive_link_public&slug=<slug>`
- Checkout creation: `POST https://matmove.space/api/create-monime-checkout?action=receive_checkout`
- Existing webhook endpoint: `https://matmove.space/api/monime-webhook`
- Private tables: `matmove_receive_links`, `matmove_received_payments`, `matmove_receive_sms_outbox`. RLS is enabled and direct `anon` / `authenticated` grants are revoked; server access uses the service role.

The USSD import file is `project/MATMOVE_RECEIVE_MONEY_USSD_FLOW.json`. It already points to the production exchange URL, but the feature flags keep it inactive until configuration is complete.

## Required environment variables

Set server-side Vercel Environment Variables only. Never put a Monime token, private key or Apphive credential in `VITE_*`, client source, a public GitHub repository, or a customer-visible field.

| Variable | Purpose |
|---|---|
| `MATMOVE_RECEIVE_MONEY_ENABLED` | Master switch for public links and checkout. Leave unset or `false` until the web checkout is tested. |
| `MATMOVE_RECEIVE_USSD_ENABLED` | USSD switch. Requires the master switch plus an imported and tested Monime flow. |
| `MONIME_RSA_PRIVATE_KEY` | PKCS#8 private key for the published Monime USSD flow. Use a separate key pair for Test and Live. |
| `MONIME_API_KEY` | Existing environment-appropriate Monime API token. |
| `MONIME_SPACE_ID` | MatMove Monime Space. |
| `MONIME_ENVIRONMENT` | Must match the token and Vercel target (test for Preview, live for Production). |
| `MATMOVE_PUBLIC_URL` | Optional. If set, it must be exactly `https://matmove.space` or `https://www.matmove.space`. |
| `APPHIVE_SMS_CLIENT_ID` | Apphive SMS client ID; optional until recipient SMS is enabled. |
| `APPHIVE_SMS_CLIENT_SECRET` | Apphive SMS client secret; server-side only. |
| `APPHIVE_SMS_WALLET_TOKEN` | Apphive SMS wallet token; server-side only. |
| `APPHIVE_SMS_SENDER_ID` | MatMove-approved sender ID registered with the SMS provider. |

The master switch is deliberately disabled by default. Do not turn it on in Production until the test and live environments are independently verified.

## Generate a dedicated RSA key pair

Run this locally in PowerShell or a terminal with OpenSSL installed. Create a **different pair for Test and Live**. Keep the private key on your secure machine and in Vercel only.

```powershell
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out matmove-ussd-private.pem
openssl pkey -in matmove-ussd-private.pem -pubout -out matmove-ussd-public.pem
```

- Paste the contents of `matmove-ussd-public.pem` into the Security section of the matching Monime USSD flow.
- Add the complete contents of `matmove-ussd-private.pem` to Vercel as `MONIME_RSA_PRIVATE_KEY` for that same environment.
- Never commit either key to Git.
- Do not reuse the Test key in Production.

Monime's exchange encryption uses RSA-OAEP with SHA-256 and AES-128-GCM. The server code uses the matching Node.js crypto implementation and returns the encrypted response as plain base64 text with HTTP 200.

## Monime webhook subscriptions

Keep the existing MatMove events. Add these Caph events to the same signed webhook destination:

- `checkout_session.completed`
- `checkout_session.cancelled`
- `checkout_session.expired`
- `payment.processing_completed`

The worker retrieves the full checkout session or Payment before it trusts the event. It checks the MatMove metadata ID, account ID, SLE amount, reference and terminal state. Unrelated checkout/payment events are ignored by the receive-money handler. Incomplete or mismatched provider data is not marked as a successful incoming payment.

Do not treat `payment.processing_started` as a successful payment; only `payment.processing_completed` is accepted as final settlement.

## Configure and test the USSD flow

1. In Monime Test mode, import `project/MATMOVE_RECEIVE_MONEY_USSD_FLOW.json` as a new draft USSD flow.
2. Confirm the exchange URL is exactly `https://matmove.space/api/get-live-wallet?action=receive_ussd_exchange`.
3. Add the **Test public RSA key** under Flow Security.
4. Keep the flow unpublished and leave `MATMOVE_RECEIVE_MONEY_ENABLED` and `MATMOVE_RECEIVE_USSD_ENABLED` off until the simulator passes.
5. Use Monime's Simulator to test: invalid recipient, valid recipient, invalid amount, cancel, Orange Money, Afrimoney, successful payment, duplicate callback and a webhook arriving late.
6. Confirm the UVAN target resolves to the intended SLE financial account, the template charges the displayed amount and carries the MatMove reference and metadata.
7. Confirm that only the matching `payment.processing_completed` webhook marks the MatMove incoming-payment record completed.
8. Only after Test mode is verified, configure the separate Live key and Live webhook subscriptions. Publish the Live flow and then activate the Production switches.

Monime assigns the USSD dial code when the flow is published. MatMove must display only the dial code returned by Monime; do not invent or hardcode one.

## Configure optional recipient SMS

Recipient SMS is an Apphive service call, independent from Resend email. Before enabling it:

1. Confirm the Apphive SMS account is approved for Sierra Leone delivery and the MatMove sender ID is authorized.
2. Set the four `APPHIVE_SMS_*` values in Vercel Production.
3. Confirm the provider wallet has SMS credit and run a controlled Test-mode delivery.
4. Enable the customer's explicit “SMS receipt to my phone” preference.

If Apphive credentials are not configured, incoming payments still reconcile; SMS remains queued and is not falsely shown as sent. Uncertain SMS-send outcomes go to review instead of being blindly retried.

## Go-live checklist

- [ ] Test credentials and Live credentials are different.
- [ ] Test and Live RSA pairs are different.
- [ ] Monime Test exchange simulator passes.
- [ ] Monime Test checkout and USSD UVAN collection both settle to the intended account.
- [ ] Duplicate webhook deliveries do not duplicate completed receipts or SMS.
- [ ] Cancelled and expired sessions do not become successful receipts.
- [ ] The full Monime provider object matches the expected account, amount, currency, reference and private MatMove metadata.
- [ ] Apphive SMS delivery is confirmed before enabling recipient SMS.
- [ ] Production switches are enabled only after all relevant checks pass.

## Important accounting note

Monime settles these payments directly to the recipient's linked SLE Monime financial account. MatMove records the verified receipt for history and notification; it must not create a second internal wallet credit or transfer the money again. The wallet balance should continue to reflect the provider's financial-account balance.
