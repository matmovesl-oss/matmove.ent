# MatMove authentication email setup — Resend + Supabase

## Current application behaviour

MatMove's customer application already uses Supabase Auth for:
- Signup confirmation
- Password reset
- Passcode recovery (the password-reset email link is reused, then the user selects the passcode recovery route)

The customer app calls Supabase Auth directly. Resend is the delivery provider, not a replacement for Supabase Auth. There is no Resend browser SDK/API key in the customer app and no Resend Edge Function in the current Supabase project.

The production customer email redirects resolve to `https://matmove.space`. Preview and localhost redirects continue to use their own origin unless `VITE_CUSTOMER_APP_URL` is deliberately set.

## Recommended Resend arrangement

Use Resend as the **custom SMTP provider for Supabase Auth**. This is the simplest option for MatMove now: Supabase continues to create and validate confirmation/recovery tokens; Resend only delivers the messages.

Use a dedicated sending subdomain so authentication email reputation is separate from the main website. Recommended sender:

- Sending domain: `auth.matmove.space`
- From name: `MatMove`
- From address: `no-reply@auth.matmove.space`

### 1. Verify the sending domain in Resend

1. Create or sign in to the MatMove Resend account.
2. Open **Domains** and add `auth.matmove.space`.
3. Resend will display the required DNS records for the domain. Add those exact records at the DNS provider that manages `matmove.space`.
4. Do not invent record values, replace existing SPF records blindly, or publish a second SPF record on the same hostname.
5. Return to Resend and wait until its domain status confirms sending is verified. Add/verify DMARC for the sending subdomain as recommended by Resend.

The DNS records and their exact hostnames/values must come from the Resend dashboard; they cannot be safely pre-filled in this repository.

### 2. Create a Resend API key

Create an API key in Resend for MatMove's Supabase SMTP integration. Store it in the password field below. Do not put this key in Vercel's public `VITE_*` variables, frontend code, GitHub files, email templates or chat messages.

### 3. Connect Resend to the MatMove Supabase project

In the Supabase dashboard, select the **MatMove.Ent** project, then open **Authentication → SMTP Settings** (the exact menu grouping may be under the project's Auth settings).

Enable custom SMTP and use:

| Supabase setting | Value |
|---|---|
| Sender name | `MatMove` |
| Sender email | `no-reply@auth.matmove.space` |
| SMTP host | `smtp.resend.com` |
| SMTP port | `465` |
| SMTP username | `resend` |
| SMTP password | Your Resend API key |

Port 465 is Resend's recommended secure SMTP port. Save the settings. Check Supabase **Authentication → Rate Limits** after enabling SMTP; newly configured custom SMTP projects can start with a conservative email limit.

If Supabase offers the official Resend integration in the project's Integrations catalogue, that guided integration can configure the SMTP connection for you. Do not configure two competing SMTP providers; verify the saved SMTP settings after using either method.

### 4. Confirm the Auth redirect allow-list

In Supabase **Authentication → URL Configuration**, use:

- Site URL: `https://matmove.space`
- Redirect URL: `https://matmove.space/auth/callback`

The app's customer recovery requests use that callback with a recovery query string; Supabase redirect allow-lists generally match the path, not every query-string value. Add local and preview URLs only when they are actually needed for testing.

The Admin portal has its own reset callback at `/reset-password` on the Admin origin. Keep the Admin origin in the Auth redirect allow-list too:

- `https://admin.matmove.space/reset-password`

Do not use a broad wildcard for all domains in production.

### 5. Set the MatMove Auth email templates

Open **Authentication → Email Templates** in Supabase. Keep the Supabase variables intact; the confirmation and recovery links must use `{{ .ConfirmationURL }}`.

#### Confirm signup

Subject:

`Confirm your MatMove account`

HTML:

```html
<div style="margin:0;padding:36px 16px;background:#f3f8fb;font-family:Arial,Helvetica,sans-serif;color:#17344d;">
  <div style="max-width:560px;margin:0 auto;padding:32px 28px;background:#ffffff;border:1px solid #e5edf3;border-radius:18px;">
    <div style="font-size:25px;font-weight:800;letter-spacing:-1px;color:#123b5b;">Mat<span style="color:#159b70;">Move</span></div>
    <p style="margin:28px 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#159b70;">WELCOME TO MATMOVE</p>
    <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#17344d;">Confirm your email address</h1>
    <p style="font-size:15px;line-height:1.7;color:#5b7183;">Thanks for creating a MatMove account. Confirm your email address to finish setting up your account.</p>
    <p style="margin:28px 0;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#109b71;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Confirm email</a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#718596;">If the button does not work, copy this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#1769e0;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #edf1f4;font-size:11px;line-height:1.6;color:#8092a1;">If you did not create a MatMove account, you can ignore this email.<br>MatMove · Eudenco Trading Company Limited</div>
  </div>
</div>
```

#### Reset password

Subject:

`Reset your MatMove password`

HTML:

```html
<div style="margin:0;padding:36px 16px;background:#f3f8fb;font-family:Arial,Helvetica,sans-serif;color:#17344d;">
  <div style="max-width:560px;margin:0 auto;padding:32px 28px;background:#ffffff;border:1px solid #e5edf3;border-radius:18px;">
    <div style="font-size:25px;font-weight:800;letter-spacing:-1px;color:#123b5b;">Mat<span style="color:#159b70;">Move</span></div>
    <p style="margin:28px 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#1769e0;">ACCOUNT SECURITY</p>
    <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#17344d;">Reset your password</h1>
    <p style="font-size:15px;line-height:1.7;color:#5b7183;">We received a request to reset your MatMove password. Use the secure button below to choose a new password.</p>
    <p style="margin:28px 0;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#1769e0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Reset password</a>
    </p>
    <p style="font-size:12px;line-height:1.7;color:#718596;">If the button does not work, copy this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#1769e0;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #edf1f4;font-size:11px;line-height:1.6;color:#8092a1;">If you did not request a password reset, ignore this message. Your password will not change unless you complete the reset.<br>MatMove · Eudenco Trading Company Limited</div>
  </div>
</div>
```

### 6. Test the full path

Use a real external inbox (not only an address on the Supabase organization):

1. Create a new MatMove test account and confirm it from the email.
2. Sign out, request a password reset and open the newest email link.
3. Confirm the link returns to `https://matmove.space` and opens the password update screen.
4. Request passcode recovery and confirm the callback opens the passcode update screen.
5. Test the Admin portal's password-reset link separately.
6. In Resend **Emails**, inspect the send/delivery/bounce result. In Supabase Auth logs, check for SMTP handover errors.

A successful Supabase request only confirms that Auth accepted the request; use Resend's delivery event to confirm the message reached the recipient's mail server.

## Important separation

- Supabase Auth + Resend SMTP: signup confirmation, password reset, passcode recovery and Admin staff password reset.
- Future transactional emails (for example, booking receipts or merchant order notices): send from a trusted backend/Edge Function using the Resend API. Never call Resend directly from the browser.
- Marketing campaigns should use a separate sending domain/address and consent-managed audience, not the authentication sender.
