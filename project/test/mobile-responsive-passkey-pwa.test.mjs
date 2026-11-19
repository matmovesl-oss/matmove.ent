import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('MatMove customer app has compact responsive rules for phone and landscape layouts', async () => {
  const css = await readFile('src/index.css', 'utf8');
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /--mm-page-title:\s*clamp\(/);
  assert.match(css, /@media\s*\(max-width:\s*360px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /input, select, textarea\s*\{\s*font-size:\s*16px/);
});

test('customer sign-in uses Supabase verified passkeys and keeps password fallback', async () => {
  const [auth, context, profile, client] = await Promise.all([
    readFile('src/pages/AuthPages.tsx', 'utf8'),
    readFile('src/context/AuthContext.tsx', 'utf8'),
    readFile('src/components/AccountProfile.tsx', 'utf8'),
    readFile('src/lib/supabase.ts', 'utf8'),
  ]);
  assert.match(auth, /signInWithPasskey/);
  assert.match(auth, /Sign in with a passkey/);
  assert.match(auth, /Use your password or Google sign-in/);
  assert.match(context, /supabase\.auth\.signInWithPasskey\(\)/);
  assert.match(context, /getCustomerSession\(\)/);
  assert.match(profile, /supabase\.auth\.registerPasskey\(\)/);
  assert.match(profile, /supabase\.auth\.passkey\.list\(\)/);
  assert.match(profile, /supabase\.auth\.passkey\.delete\(/);
  assert.match(profile, /Biometrics & Face ID/);
  assert.match(profile, /Face ID or fingerprint on this device/);
  assert.match(profile, /min-h-\[56px\]/);
  assert.doesNotMatch(profile, /Supabase Auth/);
  assert.match(profile, /Device passkeys are not enabled for MatMove yet/);
  assert.match(auth, /Passkey sign-in is not enabled for MatMove yet/);
  assert.match(client, /experimental:\s*\{\s*passkey:\s*true\s*\}/);
  assert.match(client, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(client, /SERVICE_ROLE|SECRET_KEY/i);
});

test('PWA shell does not cache API, authentication or private user data', async () => {
  const [html, manifest, worker] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('public/manifest.webmanifest', 'utf8'),
    readFile('public/sw.js', 'utf8'),
  ]);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /viewport-fit=cover/);
  const app = JSON.parse(manifest);
  assert.equal(app.name, 'MatMove');
  assert.equal(app.display, 'standalone');
  assert.ok(app.icons.some(icon => icon.src === '/logo.jpg'));
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /auth\|wallet\|payment\|transaction\|profile\|booking/i);
  assert.match(worker, /APP_SHELL/);
  assert.match(worker, /offline\.html/);
  assert.ok(worker.includes("return (await caches.match('/offline.html')) || (await caches.match('/index.html'))"), 'offline navigation must prefer the safe offline page over the cached app shell');
});

test('customer account uses compact arrow rows and focused profile, referral and policy screens', async () => {
  const [app, css, profile] = await Promise.all([
    readFile('src/App.tsx', 'utf8'),
    readFile('src/index.css', 'utf8'),
    readFile('src/components/AccountProfile.tsx', 'utf8'),
  ]);
  assert.match(app, /setActivePanel\('profile'\)/);
  assert.match(app, /setActivePanel\('invite'\)/);
  assert.match(app, /setActivePanel\('policy'\)/);
  assert.match(app, /className="mm-account-row"/);
  assert.match(app, /Account & verified details/);
  assert.match(app, /Verified · Locked/);
  assert.match(app, /setViewingAnalytics\(true\)/);
  assert.match(app, /setViewingCartOrders\(true\)/);
  assert.match(app, /Customer Support/);
  assert.match(app, /Request Account Deletion/);
  assert.match(css, /\.mm-account-row/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(profile, /<PasskeySecurity userId=\{userId\}\/>/);
});

test('biometric controls stay on the Account hub while profile editing opens separately', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const profile = await readFile('src/components/AccountProfile.tsx', 'utf8');
  assert.ok(app.includes('<PasskeySecurity key={profile.id} userId={profile.id}/>'));
  assert.ok(app.includes('showPasskey={false}'));
  assert.ok(profile.includes('export function PasskeySecurity'));
  assert.ok(profile.includes('{showPasskey&&<PasskeySecurity userId={userId}/>'));
});

test('Trips uses compact cards and only exposes full receipts after verified payment settlement', async () => {
  const trips = await readFile('src/components/TripHistory.tsx', 'utf8');
  assert.match(trips, /<h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Trips<\/h1>/);
  assert.match(trips, /View full receipt/);
  assert.match(trips, /info\.status!=='settled'/);
  assert.match(trips, /driverConfirmed && customerConfirmed/);
  assert.match(trips, /return t\.status==='completed'/);
  assert.match(trips, /paymentConfirmed\(t\)/);
  assert.match(trips, /max-w-3xl/);
  assert.doesNotMatch(trips, /Unfinished requests/);
  assert.doesNotMatch(trips, /Time period/);
  assert.match(trips, /Download \/ Share full receipt PDF/);
});
