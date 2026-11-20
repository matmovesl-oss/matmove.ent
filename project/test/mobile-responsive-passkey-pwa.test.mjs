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
  assert.match(profile, /Biometrics/);
  assert.match(profile, /Face ID or fingerprint on this device/);
  assert.match(profile, /min-h-\[48px\]/);
  assert.doesNotMatch(profile, /Supabase Auth/);
  assert.match(profile, /Device passkeys are not enabled for MatMove yet/);
  assert.match(auth, /Passkey sign-in is not enabled for MatMove yet/);
  assert.match(client, /experimental:\s*\{\s*passkey:\s*true\s*\}/);
  assert.match(client, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(client, /SERVICE_ROLE|SECRET_KEY/i);
});

test('passcode keypad appends digits locally and only verifies after submission', async () => {
  const keypad = await readFile('src/components/CustomerPasscode.tsx', 'utf8');
  assert.match(keypad, /const appendDigit=/);
  assert.match(keypad, /setPin\(value=>value\.length<limit\?value\+digit:value\)/);
  assert.match(keypad, /appendDigit\(digit\)/);
  assert.match(keypad, /customerPasscode\(id,creating\?'create':changing\?'change':'verify'/);
});

test('wallet cards use a wallet symbol instead of the M-only artwork', async () => {
  const wallets = await readFile('src/components/WalletCards.tsx', 'utf8');
  assert.match(wallets, /<Wallet className="text-emerald-700" size=\{27\}\/>/);
  assert.doesNotMatch(wallets, /wallet-icon\.png/);
});

test('customer home uses the MatMove wordmark instead of the M-only logo', async () => {
  const home = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.match(home, /<span className="text-sm font-black tracking-tight text-slate-950">MATMOVE<\/span>/);
  assert.equal(home.includes('<div className="mm-brand"><img src="/logo.jpg"'), false);
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
  assert.ok(worker.includes("return (await caches.match('/index.html')) || (await caches.match('/offline.html'))"), 'offline navigation must prefer the cached app shell over the fallback page');
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
  assert.match(trips, /Physical cash return/);
  assert.doesNotMatch(trips, /Needs payment review/);
  assert.doesNotMatch(trips, /Cash return: \{t\.cashReturn/);
});


 
test('production passkey domain, country-wide live map label and receipt close control are correct', async () => {
  const [map, trips, biometricGuide] = await Promise.all([
    readFile('src/components/RideLocationPicker.tsx', 'utf8'),
    readFile('src/components/TripHistory.tsx', 'utf8'),
    readFile('docs/MOBILE_RESPONSIVE_BIOMETRIC_PWA.md', 'utf8'),
  ]);
  assert.ok(map.includes('SIERRA LEONE · LIVE MAP'));
  assert.ok(map.includes('absolute right-4 top-[calc(env(safe-area-inset-top)+14px)]'));
  assert.ok(map.includes('MatMove · Sierra Leone'));
  assert.equal(map.includes('FREETOWN · LIVE MAP'), false);
  assert.ok(trips.includes('h-8 min-h-8 shrink-0 items-center justify-center whitespace-nowrap'));
  assert.ok(trips.includes('text-xs font-semibold leading-none">Close</button>'));
  assert.ok(biometricGuide.includes('Relying Party ID to matmove.space'));
  assert.ok(biometricGuide.includes('https://matmove.space and https://www.matmove.space'));
  assert.ok(biometricGuide.includes('preview hostname'));
});

test('passcode keypad uses equal circular keys with a clear black border', async () => {
  const pin = await readFile('src/components/CustomerPasscode.tsx', 'utf8');
  assert.match(pin, /grid w-fit grid-cols-3 gap-3/);
  assert.match(pin, /h-16 w-16[^"]*rounded-full border-2 border-black/);
  assert.match(pin, /aria-label="Passcode keypad"/);
});


test('offline navigation returns the cached MatMove app shell, never caches private API data, and keeps versioned assets ready', async () => {
  const worker = await readFile('public/sw.js', 'utf8');
  assert.match(worker, /const CACHE_NAME = 'matmove-shell-v2'/);
  assert.match(worker, /return \(await caches\.match\('\/index\.html'\)\) \|\| \(await caches\.match\('\/offline\.html'\)\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /Only immutable, versioned Vite build assets are cached/);
});

test('wallet background refresh keeps only a minimal last-confirmed snapshot and never replaces it with a loading state on network loss', async () => {
  const home = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.match(home, /readWalletSnapshot\(uid\)/);
  assert.match(home, /writeWalletSnapshot\(uid, data, savedAt\)/);
  assert.match(home, /A failed background refresh must never erase a previously confirmed balance/);
  assert.match(home, /Wallet details will appear when you reconnect/);
  assert.doesNotMatch(home, /Loading wallet…/);
  assert.match(home, /Never cache account IDs/);
  const apiFetch = await readFile('src/lib/apiFetch.ts', 'utf8');
  assert.match(apiFetch, /if \(typeof navigator !== 'undefined' && !navigator\.onLine\)/);
  assert.match(apiFetch, /This server request was not sent/);
});

test('Events Hub has a compact always-visible close control and a clear empty-events message', async () => {
  const home = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.match(home, /No events currently available/);
  assert.match(home, /New events posted by MatMove will appear here/);
  assert.match(home, /aria-label="Close Events Hub"/);
  assert.match(home, /max-h-\[min\(88dvh,900px\)\]/);
  assert.match(home, /disabled=\{busy \|\| !networkOnline\}/);
});

test('Rider ride screen exposes compact Load, Withdraw and Transfer shortcuts but disables them offline', async () => {
  const rider = await readFile('src/pages/RiderDashboard.tsx', 'utf8');
  assert.match(rider, /activeSection === 'wallet' \? 'hidden' : ''/);
  assert.match(rider, /disabled=\{!networkOnline \|\| !canLoad \|\| !hasSleAccount/);
  assert.match(rider, /disabled=\{!networkOnline \|\| !canSend \|\| !hasSleAccount/);
  assert.match(rider, /Offline mode · showing saved information/);
});
