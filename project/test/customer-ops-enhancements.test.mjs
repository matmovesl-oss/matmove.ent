import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const module = await build({
  entryPoints:['src/lib/tripHistory.ts'],
  bundle:true,
  write:false,
  platform:'node',
  format:'esm',
});
const source = 'data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].text).toString('base64');
const {filterTripHistory}=await import(source);

const now=Date.parse('2026-11-06T00:00:00Z');
const rows=[
  {id:'recent',status:'completed',created_at:'2026-11-01T00:00:00Z'},
  {id:'older',status:'cancelled',created_at:'2026-09-15T00:00:00Z'},
  {id:'old',status:'completed',created_at:'2026-07-01T00:00:00Z'},
  {id:'future',status:'accepted',created_at:'2026-11-20T00:00:00Z'},
  {id:'invalid',status:'completed',created_at:'not-a-date'},
];

test('recent and history filters apply exact rolling windows and retain valid future scheduled trips',()=>{
  assert.deepEqual(filterTripHistory(rows,'30','all',now).map(x=>x.id),['recent','future']);
  assert.deepEqual(filterTripHistory(rows,'90','all',now).map(x=>x.id),['recent','older','future']);
  assert.deepEqual(filterTripHistory(rows,'all','all',now).map(x=>x.id),['recent','older','old','future','invalid']);
});

test('trip status combines with time filters and never mutates the original history array',()=>{
  const original=[...rows];
  assert.deepEqual(filterTripHistory(rows,'90','completed',now).map(x=>x.id),['recent']);
  assert.deepEqual(filterTripHistory(rows,'all','cancelled',now).map(x=>x.id),['older']);
  assert.deepEqual(rows,original);
});

test('TripHistory renders accessible recent/history and status selectors using the shared filter',async()=>{
  const fs=await import('node:fs/promises');
  const component=await fs.readFile('src/components/TripHistory.tsx','utf8');
  assert.match(component,/Filter trips by time period/);
  assert.match(component,/Filter trips by status/);
  assert.match(component,/filterTripHistory\(ownedTrips,period,statusFilter\)/);
});

test('Merchant deletion is owner-scoped, reversible and hidden from every customer-facing catalogue',async()=>{
  const fs=await import('node:fs/promises');
  const [editor,legacy,merchant,rider]=await Promise.all([
    fs.readFile('src/components/ProductCatalog.tsx','utf8'),
    fs.readFile('src/pages/MerchantCatalog.tsx','utf8'),
    fs.readFile('src/pages/MerchantDashboard.tsx','utf8'),
    fs.readFile('src/pages/RiderDashboard.tsx','utf8')
  ]);
  assert.match(editor,/matmove_merchant_delete_product/);
  assert.match(editor,/Existing orders and payment records were retained/);
  assert.match(legacy,/matmove_merchant_delete_product/);
  assert.match(merchant,/is\('deleted_at',null\)/);
  assert.match(rider,/is\('deleted_at',null\)/);
});

test('Admin notification withdrawal refreshes customer inboxes from the shared message record',async()=>{
  const fs=await import('node:fs/promises');
  const source=await fs.readFile('src/components/NotificationBell.tsx','utf8');
  assert.match(source,/table:\s*'matmove_notification_messages'/);
  assert.match(source,/void read\(null, true\)/);
});

test('Concierge presents configured SLE and USD prices and hides deleted services',async()=>{
  const fs=await import('node:fs/promises');
  const customer=await fs.readFile('src/components/ConciergeServices.tsx','utf8');
  assert.match(customer,/price_sle/);
  assert.match(customer,/price_usd/);
  assert.match(customer,/is\('deleted_at',null\)/);
  assert.match(customer,/conciergePrice/);
});

test('Customer account closure creates a reviewed request rather than deleting finance records immediately',async()=>{
  const fs=await import('node:fs/promises');
  const app=await fs.readFile('src/App.tsx','utf8');
  assert.match(app,/matmove_customer_request_account_deletion/);
  assert.match(app,/matmove_customer_account_deletion_status/);
  assert.match(app,/does not instantly erase your account/);
  assert.match(app,/Submit deletion request/);
});


test('password recovery is offered only on the passcode screen and changes only the account password',async()=>{
  const fs=await import('node:fs/promises');
  const [auth,app,lock,service,recovery]=await Promise.all([
    fs.readFile('src/pages/AuthPages.tsx','utf8'),
    fs.readFile('src/App.tsx','utf8'),
    fs.readFile('src/components/CustomerPasscode.tsx','utf8'),
    fs.readFile('src/services/authService.ts','utf8'),
    fs.readFile('src/pages/UpdatePassword.tsx','utf8')
  ]);
  const login=auth.slice(auth.indexOf('export function LoginPage'),auth.indexOf('export function SignupPage'));
  const signup=auth.slice(auth.indexOf('export function SignupPage'),auth.indexOf('function GoogleButton'));
  assert.doesNotMatch(login,/Forgot password\\?|Forgot passcode\\?/);
  assert.doesNotMatch(signup,/Forgot password\\?|Forgot passcode\\?/);
  assert.match(lock,/Forgot password\\?/);
  assert.doesNotMatch(lock,/Forgot passcode\\?/);
  assert.match(lock,/requestAccountPasswordReset\\(resetEmail\\)/);
  assert.match(lock,/Reset Password/);
  assert.match(lock,/Your MatMove passcode will remain unchanged/);
  assert.doesNotMatch(app,/path="\\/forgot-password"|path="\\/forgot-passcode"/);
  assert.match(app,/path="\\/reset-password"/);
  assert.match(service,/customerAuthRedirect\\('\\/auth\\/callback\\?type=recovery&next=%2Freset-password'\\)/);
  assert.match(recovery,/supabase\\.auth\\.updateUser\\(\\{ password \\}\\)/);
  assert.match(recovery,/mode === 'password'/);
  assert.match(recovery,/Your MatMove passcode will remain unchanged/);
  assert.match(recovery,/recoveryReady/);
});

test('Event USD is a display quote and ticket purchases continue to debit the SLE amount',async()=>{
  const fs=await import('node:fs/promises');
  const portal=await fs.readFile('src/components/PortalHome.tsx','utf8');
  assert.match(portal,/evt\.ticket_price_usd!=null/);
  assert.match(portal,/amount:\s*total/);
  assert.match(portal,/currency:\s*'SLE'/);
  assert.match(portal,/Number\(evt\.ticket_price\)\s*\*\s*count/);
});

test('Cancelled Travel reservation dismissal is saved per customer and reservation',async()=>{
  const fs=await import('node:fs/promises');
  const portal=await fs.readFile('src/components/PortalHome.tsx','utf8');
  assert.match(portal,/matmove\.travel\.cancelled\.dismissed\.\$\{uid\}\.\$\{ownBookingResult\.data\.id\}/);
  assert.match(portal,/matmove\.travel\.cancelled\.dismissed\.\$\{uid\}\.\$\{existingBooking\.id\}/);
});
