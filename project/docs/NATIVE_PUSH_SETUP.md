# MatMove native push notifications

This is the server-side delivery path for the Expo iOS/Android app. It deliberately sends a generic lock-screen message; the full title and body remain inside the authenticated MatMove inbox.

## What this adds

- `matmove_push_tokens` stores Expo device tokens server-side. RLS is enabled and direct `anon`/`authenticated` table access is revoked.
- `matmove_register_push_token` binds registration to `auth.uid()` and a verified customer role.
- `matmove_unregister_push_token` removes only the signed-in account's own token.
- The `matmove-push` Edge Function validates the Database Webhook row, loads only that recipient's tokens, and sends a generic notification through Expo.
- Invalid `DeviceNotRegistered` tokens are pruned. The function never sends inbox message text or account/payment details to the lock screen.

## Deployment sequence

1. Apply the migration `20261125141500_matmove_native_push_tokens_v1.sql` to the active MatMove.Ent Supabase project.
2. Deploy `project/supabase/functions/matmove-push/index.ts` as the Edge Function `matmove-push` with JWT verification enabled.
3. Add the Expo access token as the Edge Function secret `EXPO_ACCESS_TOKEN`. Enable Enhanced Push Security for the Expo project so the delivery service requires this token. Do not place this token in the app, repository, or SQL.
4. In Supabase Dashboard → Database → Webhooks, create a webhook:
   - Table: `public.matmove_notification_messages`
   - Event: `INSERT`
   - Type: Supabase Edge Function
   - Function: `matmove-push`
   - Method: `POST`
   - Headers: `Content-Type: application/json` and the Supabase service-key Authorization header supplied by the Dashboard's service-key helper.
5. Add the required iOS APNs and Android FCM v1 credentials to the EAS project, then create development builds for physical devices.

The Edge Function uses the Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server environment values. The webhook should be configured with the Dashboard's service-key helper; never put a service key in application code or in this file.

## Verification

- Run `node --test test/native-push-tokens.test.mjs` from `project/`.
- Run `npm run test:security` and the normal production build.
- After deployment, test registration and sign-out with separate rider/driver test accounts on physical iPhone and Android devices. Confirm that the notification lock-screen copy stays generic and tapping the notification opens the inbox destination.
- A successful Expo push ticket means Expo accepted the message for delivery; it is not proof that Apple/Google displayed it on the device. Complete device-side testing before release.
