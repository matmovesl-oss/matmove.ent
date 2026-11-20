# MatMove mobile responsiveness, passkeys and PWA readiness

## Current application/runtime findings

- The customer portal is a Vite + React + TypeScript browser application using Supabase Auth.
- The existing stylesheet already contained desktop/tablet/mobile breakpoints (1100px, 800px, 640px and 450px) and a 320px minimum viewport. This update adds a shared compact typography/spacing baseline, smaller-phone rules, landscape handling, safe-area padding and minimum touch-target rules rather than applying a global scale transform.
- The customer app does not currently declare Capacitor or a native Android/iOS wrapper dependency. Native LocalAuthentication and Android BiometricPrompt cannot be invoked from this browser-only repository.
- The app uses @supabase/supabase-js 2.119.0 from the lockfile. Supabase Auth passkey support is documented as experimental and must be enabled in the Supabase project Auth configuration. The implementation is opt-in at the UI level and does not replace password or Google login.

## Implemented

- Added a passkey sign-in action to the customer sign-in page. Supabase Auth performs the WebAuthn challenge and server verification; the app then reloads the normal MatMove customer session and role authorization.
- Added optional passkey registration and registered-device listing/removal in Account & Profile. All operations require the current authenticated account. No biometric templates or private keys are collected by MatMove.
- Kept password and Google sign-in as fallback. Passkey cancellation and unsupported browsers receive fallback messaging.
- Added compact typography variables, fluid page headings, 44px touch targets for primary controls, 16px form-control text to prevent iOS zoom, responsive 320px/360px rules, landscape layout adjustments and safe-area-aware bottom navigation.
- Added a PWA manifest, viewport-fit metadata, service worker and offline fallback. The worker caches only the app shell and versioned static build assets. It explicitly bypasses API paths and account/payment-related paths; no wallet, transaction, auth or profile response is cached.
- No database tables, migrations, RLS policies, wallet logic, payment APIs or Supabase secrets were changed.

## Supabase configuration required

Supabase's current hosted-project guide requires both the dashboard feature and the WebAuthn relying-party settings. The client flag alone is not enough.

For the current production host, the required production configuration is:

1. Open Supabase Dashboard → Authentication → Passkeys for project jjqtpnrnfzlwhnvhbsdy.
2. Enable Passkey authentication.
3. Set Relying Party Display Name to MatMove.
4. Set Relying Party ID to matmove.space.
5. Set Relying Party Origins to https://matmove.space and https://www.matmove.space.
6. Save and verify passkey registration/sign-in on both production HTTPS origins.

The Vercel preview hostname (including matmove-ent.vercel.app) is a different origin and must not be used as the production RP ID or origin. The production app is served from matmove.space; www.matmove.space is also an allowed origin under the matmove.space RP ID. Do not register real user passkeys on a preview hostname.

**Domain migration warning:** WebAuthn passkeys are bound to the RP ID. Changing the RP ID later (for example, moving from the Vercel default domain to a future custom MatMove domain) invalidates passkeys created under the old RP ID; affected users must register new passkeys. The custom production domain is now selected. Use matmove.space as the RP ID before enabling user rollout. Any passkeys created under the old Vercel RP ID must be registered again.

The connected Supabase tools can inspect the project and database but do not expose the hosted Auth Passkeys configuration endpoint. I have therefore not enabled the server-side setting or claimed that passkey enrollment is live. The UI and SDK integration are committed; project dashboard configuration and real-device tests remain outstanding.

## Platform compatibility

- **Android browser/PWA:** Chrome and other supported browsers can invoke the platform passkey UI. The OS/authenticator may use fingerprint, face unlock, device PIN or a synced passkey. Android biometric UI is mediated by the browser and OS, not by MatMove JavaScript.
- **iOS browser/PWA:** Supported Safari versions can invoke the platform passkey UI backed by Face ID, Touch ID or device passcode. MatMove never receives biometric data.
- **Native Android/iOS wrapper:** Not implemented because no Capacitor/native wrapper project is present in this repository. When the wrapper is selected, add a maintained native passkey integration and configure Android Digital Asset Links and iOS Associated Domains. Do not pretend the web button invokes native APIs inside an arbitrary WebView.

## Validation limits and remaining work

- Static regression tests are included for the responsive baseline, verified passkey flow and privacy-safe PWA cache policy.
- Automated browser viewport screenshots at 320, 360, 375, 390, 414, 430px, tablet and desktop widths still need a browser/device runner. Native Face ID, Touch ID and Android biometric hardware have not been physically tested.
- The current MatMove logo asset is reused for the manifest icon. Dedicated 192px and 512px PNG install icons should be supplied/created before store packaging.
- Confirm the Supabase Passkeys toggle and RP ID/allowed domains, then test registration, passkey sign-in, cancellation, device removal and password fallback on real devices.
- Service worker registration occurs only in production builds. Do not rely on the offline shell for booking, payments, wallet access or other live operations.
