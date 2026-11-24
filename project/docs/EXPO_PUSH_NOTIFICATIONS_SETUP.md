# MatMove Expo push notifications

This setup connects the native Expo app to the existing MatMove notification inbox. It does not replace the in-app inbox or change the existing notification audience and permission rules.

## Delivery design

1. Admin sends a MatMove notification through the existing server RPC.
2. MatMove creates one `matmove_notification_inbox` row per recipient.
3. A database webhook sends that inserted inbox row to the `matmove-push` Edge Function.
4. The function reads the message and the recipient's active Expo device tokens using the Supabase server key.
5. Expo receives a generic alert only: **“You have a new notification. Open MatMove to view it.”**
6. The app opens the existing authenticated inbox or the notification's approved destination. Private message text is not placed on the phone lock screen.

The mobile app requests permission only when the customer opens Notifications and selects **Enable**. Device tokens are registered through authenticated RPCs; the token table has RLS enabled and no direct client table access.

## Files

- `EXPO_PUSH_NOTIFICATIONS_SETUP.sql`: database table, RLS, and authenticated register/unregister RPC definitions. This is a reviewed setup script, not an applied migration.
- `../supabase/functions/matmove-push/index.ts`: webhook receiver and Expo Push Service dispatcher.

## Required server configuration

Before deploying the function, create these Edge Function secrets in the Supabase Dashboard. Do not put either value in the mobile app or GitHub:

- `EXPO_ACCESS_TOKEN`: create an Expo access token in the Expo account's Access Tokens settings, with Enhanced Security for Push Notifications enabled.
- `MATMOVE_PUSH_WEBHOOK_SECRET`: create a long random secret. Use the same value in the database webhook header described below.

The function also reads Supabase's server-side `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` environment variables. It uses the `default` secret key server-side only.

## Deploy and connect

After the SQL has been reviewed and committed as a Supabase migration:

1. Deploy `matmove-push` with JWT verification disabled because the database webhook authenticates using the dedicated `x-matmove-push-secret` header. The function checks that header before reading any recipient or token data.
2. In Supabase Dashboard, open Database Webhooks and create a webhook:
   - Schema: `public`
   - Table: `matmove_notification_inbox`
   - Event: `INSERT`
   - Target: Edge Function `matmove-push`
   - Header: `x-matmove-push-secret: <the same MATMOVE_PUSH_WEBHOOK_SECRET>`
3. Do not attach this webhook to the legacy `notifications` table or the message broadcast table. The inbox table is the per-recipient delivery source.
4. Build and install the Expo development build on a physical iPhone or Android device. Remote push delivery is not available in Expo Go on Android for modern Expo SDKs.
5. Send one test notification to a single test customer account only. Verify that the generic alert arrives, tapping it opens MatMove, and the full message is loaded from the authenticated inbox.

## Release safeguards

- No service-role key, Expo access token, Monime credential, wallet ID, or escrow ID is stored in the app.
- Push alerts deliberately contain no notification title/body from the private inbox.
- Tokens are scoped to the authenticated customer and are re-assigned to the current account if the same device signs in to a different MatMove account.
- Device-not-registered responses disable stale tokens.
- Do not enable an all-customer test until a single-recipient test succeeds.
- A physical development build and server-side secrets are still required; this source code alone does not mean production push delivery is active.
