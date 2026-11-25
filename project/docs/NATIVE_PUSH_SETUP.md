# MatMove native push notifications

This is the server-side delivery path for the Expo iOS/Android app. It deliberately sends a generic lock-screen message; the full title and body remain inside the authenticated MatMove inbox.

## What this adds

- `matmove_push_tokens` stores Expo device tokens server-side. RLS is enabled and direct `anon`/`authenticated` table access is revoked.
- `matmove_register_push_token` binds registration to `auth.uid()` and a verified customer role.
- `matmove_unregister_push_token` removes only the signed-in account's own token.
- The `matmove-push` Edge Function validates the webhook using Supabase's `auth: "secret"` mode, resolves message recipients, and sends a generic notification through Expo.
- Invalid `DeviceNotRegistered` tokens are pruned. The function never sends inbox message text or account/payment details to the lock screen.

## Deployment sequence

1. Apply the migration `20261125141500_matmove_native_push_tokens_v1.sql` to the active MatMove.Ent Supabase project.
2. Deploy `project/supabase/functions/matmove-push/index.ts` as the Edge Function `matmove-push` with `verify_jwt=false`. This is required because the webhook authenticates with an API secret key in the `apikey` header, not a user JWT in `Authorization`. The handler itself validates the key using Supabase's `withSupabase({ auth: "secret" })`.
3. Add the Expo access token as the Edge Function secret `EXPO_ACCESS_TOKEN`. Enable Enhanced Push Security for the Expo project so the delivery service requires this token. Do not place this token in the app, repository, or SQL.
4. In Supabase Dashboard → Database → Webhooks, create a webhook:
   - Table: `public.matmove_notification_messages`
   - Event: `INSERT`
   - Type: Supabase Edge Functions
   - Function: `matmove-push`
   - Method: `POST`
   - Under HTTP Headers, select **Add secret key** and use the project's default secret key. The Dashboard sends this key in `apikey`, which the Edge Function's secret auth mode validates. Do not use an `Authorization: Bearer sb_secret_...` header.
5. Add the required iOS APNs and Android FCM v1 credentials to the EAS project, then create development builds for physical devices.

The function uses the Supabase-managed `ctx.supabaseAdmin` client for server-only queries. Supabase validates the webhook's secret key before the handler executes. The separate `EXPO_ACCESS_TOKEN` secret authenticates outbound requests to Expo.

## Verification

- Run `node --test test/native-push-tokens.test.mjs` from `project/`.
- Run `npm run test:security` and the normal production build.
- After deployment, test registration and sign-out with separate rider/driver test accounts on physical iPhone and Android devices. Confirm that the notification lock-screen copy stays generic and tapping the notification opens the inbox destination.
- A successful Expo push ticket means Expo accepted the message; it is not proof that Apple/Google displayed it on the device. Complete device-side testing before release.
