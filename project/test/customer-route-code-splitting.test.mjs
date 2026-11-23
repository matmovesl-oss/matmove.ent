import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../src/components/ProductCatalog.tsx', import.meta.url), 'utf8');
const money = readFileSync(new URL('../src/lib/catalogMoney.ts', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../src/lib/customerHelpNavigation.ts', import.meta.url), 'utf8');

const lazyComponents = [
  'CustomerPasscode', 'InviteEarn', 'MatMoveHelp', 'CustomerSupport', 'NotificationBell',
  'ReceivePayLinkPage', 'ReceivePaymentCompletePage', 'CustomerHome', 'PortalGuide',
  'AccountProfile', 'AccountIdentity', 'PasskeySecurity', 'MerchantCheckout', 'AccountPolicy',
  'RoleSelectionPage', 'KycWorkspace', 'PersonalInfoPage', 'IdentityPage', 'DocumentsPage',
  'SelfiePage', 'VehicleSelectionPage', 'ReviewPage', 'SubmittedPage', 'VerificationPage'
];

test('customer portal and onboarding modules load lazily behind a route fallback', () => {
  for (const name of lazyComponents) assert.ok(app.includes('const ' + name + ' = lazy('), name + ' should be lazy loaded');
  assert.ok(app.includes('<Suspense fallback='));
  assert.ok(app.includes('<Suspense fallback={null}><MatMoveHelp'));
  assert.ok(app.includes('<Suspense fallback={<span className="text-xs text-slate-500">Account</span>}>'));
});

test('the application no longer eagerly imports the full ProductCatalog or help articles for small helpers', () => {
  assert.ok(app.includes("from '@/lib/catalogMoney'"));
  assert.ok(app.includes("from '@/lib/customerHelpNavigation'"));
  assert.equal(app.includes("from '@/components/ProductCatalog'"), false);
  assert.equal(app.includes("from '@/components/MatMoveHelp'"), false);
  assert.match(catalog, /from '@\\/lib\\/catalogMoney'/);
  assert.match(money, /export function catalogMoney/);
  assert.match(money, /export function catalogCheckoutAllowed/);
  assert.match(navigation, /export function customerHelpSection/);
});

test('customer public, recovery, payment and role routes are preserved', () => {
  for (const path of ['/auth/callback', '/pay/complete', '/pay/:slug', '/login', '/signup',
    '/reset-password', '/reset-passcode', '/select-role', '/onboarding/personal',
    '/onboarding/identity', '/onboarding/documents', '/onboarding/selfie',
    '/onboarding/vehicle', '/onboarding/review', '/onboarding/submitted',
    '/verification', '/customer/*']) {
    assert.ok(app.includes('path="' + path + '"'), 'missing route ' + path);
  }
  assert.ok(app.includes('<CustomerPortal />'));
});

test('lazy module changes preserve the shared customer role resolver and portal session guard', () => {
  assert.ok(app.includes("import { resolveCustomerRole } from '../shared/customer-access.js'"));
  assert.ok(app.includes('if(!session?.user?.id)return <Navigate to="/login" replace/>;'));
  assert.ok(app.includes('<CustomerPasscode key={session.user.id}'));
});
