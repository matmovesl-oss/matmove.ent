# MatMove native push notifications

This backend connects the Expo iOS/Android app to the existing MatMove customer notification inbox. The in-app inbox remains the source of truth. Phone notifications contain only a generic alert and an optional safe destination; they never include the private message title or body.

## Included implementation

- `matmove_register_push_token` and `matmove_unregister_push_token` are authenticated customer RPCs. They only accept a signed-in, verified MatMove Rider, Driver or Merchant and bind changes to `auth.uid()`.
- Device tokens are stored in the non-exposed `private.matmove_push_tokens` table. API roles cannot read or write this table directly.
- `matmove_push_dispatch_context` and `matmove_push_remove_invalid_token` are service-role-only RPCs for the Edge Function.
- `matmove-push` validates a dedicated webhook secret, reads delivery tokens server-side, sends generic Expo push alerts in batches of 100 and removes tokens Expo reports as `DeviceNotRegistered`.

## Deployment steps

1. Apply the migration `20261125145204_matmove_native_push_notifications_v1.sql` to the active MatMove.Ent project after this pull request has been reviewed and merged.
2. Deploy `supabase/functions/matmove-push/index.ts` as the Edge Function named `matmove-push` with JWT verification disabled. The function authenticates the database webhook itself with a dedicated header; do not expose it as an unauthenticated public endpoint.
3. Add these Edge Function secrets in Supabase:
   - `EXPO_ACCESS_TOKEN`: a dedicated Expo access token with Enhanced Security for Push Notifications enabled.
   - `MATMOVE_PUSH_WEBHOOK_SECRET`: a new random secret of at least 32 characters. Keep it out of Git, the mobile app and logs.
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` to hosted Edge Functions. The code has a temporary legacy server-key fallback while the project's API-key migration is in progress.
4. Create a Supabase Database Webhook:
   - Table: `public.matmove_notification_messages`
   - Event: `UPDATE`
   - Method: `POST`
   - Destination: the `matmove-push` Edge Function URL
   - Custom HTTP header: `x-matmove-push-secret` with the same value as `MATMOVE_PUSH_WEBHOOK_SECRET`
   Do not put a Supabase secret key in a SQL migration or hard-code it in the webhook configuration.
5. Test with a physical iPhone and Android device. Sign in as a customer, open Notifications, enable phone notifications, then send a test message from the authorized MatMove Admin notification workflow. Confirm the phone receives a generic alert and tapping it opens the expected inbox destination.

## Why the webhook listens for UPDATE

The existing Admin send RPC inserts the message first, then inserts its recipient inbox rows, and finally updates `recipient_count`. The UPDATE webhook therefore runs after the recipient rows exist. The Edge Function ignores soft-deleted messages and does not read or send the private message body.

## Not yet complete

This code is not live until the migration, Edge Function secrets, Edge Function deployment and database webhook are configured in the active MatMove.Ent project. A successful GitHub build does not prove push delivery. Physical-device tests are still required for APNs/FCM credentials and the real Expo project.
