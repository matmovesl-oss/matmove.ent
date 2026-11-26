import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('password and passcode recovery each open a dedicated secure email-entry screen', async () => {
  const [auth, app, pages, lock, recovery, recoveryState, supabase, service] = await Promise.all([
    readFile('src/pages/AuthPages.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
    readFile('src/pages/PasswordPages.tsx', 'utf8'),
    readFile('src/components/CustomerPasscode.tsx', 'utf8'),
    readFile('src/pages/UpdatePassword.tsx', 'utf8'),
    readFile('src/services/authRecoveryState.ts', 'utf8'),
    readFile('src/lib/supabase.ts', 'utf8'),
    readFile('src/services/authService.ts', 'utf8')
  ]);
  const login = auth.slice(auth.indexOf('export function LoginPage'), auth.indexOf('export function SignupPage'));
  assert.ok(login.includes("navigate('/forgot-password'"));
  assert.ok(login.includes("navigate('/forgot-passcode'"));
  assert.ok(!login.includes('handlePasswordReset'));
  assert.ok(!login.includes('resetPassword(email)'));
  assert.ok(app.includes('path="/forgot-password"') && app.includes('<ForgotPasswordPage />'));
  assert.ok(app.includes('path="/forgot-passcode"') && app.includes('<ForgotPasscodePage />'));
  assert.ok(pages.includes('export function ForgotPasswordPage()'));
  assert.ok(pages.includes('export function ForgotPasscodePage()'));
  assert.ok(pages.includes('type="email"'));
  assert.ok(pages.includes('await resetPasscode(normalizedEmail)'));
  assert.ok(pages.includes('await resetPassword(normalizedEmail)'));
  assert.ok(lock.includes("navigate('/forgot-passcode')"));
  assert.ok(!lock.includes('requestPasscodeReset(resetEmail)'));
  assert.ok(service.includes("customerAuthRedirect('/auth/callback?type=recovery&next=%2Freset-password')"));
  assert.ok(service.includes("customerAuthRedirect('/auth/callback?type=recovery&next=%2Freset-passcode')"));
  assert.ok(auth.includes("event !== 'PASSWORD_RECOVERY'"));
  assert.ok(auth.includes('supabase.auth.getSession()'));
  assert.ok(auth.includes('hasVerifiedPasswordRecovery(userId)'));
  assert.ok(auth.includes('navigate(destination, { replace: true })'));
  assert.ok(recovery.includes("type RecoveryMode = 'password' | 'passcode'"));
  assert.ok(recovery.includes("supabase.auth.updateUser({ password })"));
  assert.ok(recovery.includes("customerPasscode(userId, 'recover', null, newPin)"));
  assert.ok(recovery.includes('hasVerifiedPasswordRecovery(userId)'));
  assert.ok(recoveryState.includes("event === 'PASSWORD_RECOVERY'"));
  assert.ok(supabase.includes('observePasswordRecoveryEvent(event, session?.user.id)'));
});
