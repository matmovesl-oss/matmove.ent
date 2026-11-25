import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all customer roles use the same four compact bottom destinations', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const start = app.indexOf('function PortalNavigation');
  const end = app.indexOf('function CustomerPortal', start);
  assert.ok(start >= 0 && end > start);
  const nav = app.slice(start, end);
  for (const entry of ["id: 'home'", "id: 'ride'", "id: 'services'", "id: 'trips'"]) {
    assert.ok(nav.includes(entry), 'missing tab: ' + entry);
  }
  assert.equal(nav.includes("id: 'wallet'"), false);
  assert.equal(nav.includes("id: 'shop'"), false);
  assert.equal(nav.includes("id: 'inventory'"), false);
});

test('compact home routes ride intent, wallet and saved places without mounting the services hub', async () => {
  const home = await readFile('src/components/CustomerHome.tsx', 'utf8');
  const app = await readFile('src/App.tsx', 'utf8');
  assert.ok(home.includes('Where to?'));
  assert.ok(home.includes("onNavigate('ride')"));
  assert.ok(home.includes('Manage places'));
  assert.ok(home.includes("onNavigate('account')"));
  assert.equal(home.includes('Explore MatMove'), false);
  assert.ok(app.includes('<CustomerHome'));
  assert.ok(app.includes('activeSection === \'services\' && <PortalHome'));
});

test('wallet has full-screen entry points from Account and Services', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const services = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.ok(app.includes('Wallet & payments'));
  assert.ok(app.includes('setViewingWallet(true)'));
  assert.ok(services.includes("onNavigate('wallet')"));
  assert.ok(/title: '(?:Wallet & payments|Earnings & wallet|Business wallet)'/.test(services));
  assert.ok(app.includes('onServices={() => setActiveSection(\'services\')}'));
});

test('ride booking uses the full map-first location picker for rider and merchant', async () => {
  const picker = await readFile('src/components/RideLocationPicker.tsx', 'utf8');
  const rider = await readFile('src/pages/RiderDashboard.tsx', 'utf8');
  const merchant = await readFile('src/pages/MerchantDashboard.tsx', 'utf8');
  const driver = await readFile('src/pages/DriverDashboard.tsx', 'utf8');
  assert.ok(picker.includes("layout === 'map-first'"));
  assert.ok(picker.includes("min(56dvh,520px)"));
  assert.ok(picker.includes('Back to vehicle selection'));
  assert.ok(picker.includes('hasSelectedRoute&&onBackToSelection'));
  assert.ok(rider.includes('onBackToSelection={() => { setRouteEditing(false); setViewMode(\'new\'); setBookingSheetExpanded(true); }}'));
  assert.ok(merchant.includes('onBackToSelection={() => setRouteEditing(false)}'));
  assert.ok(picker.includes("Change locations"));
  assert.ok(rider.includes('layout="map-first"'));
  assert.ok(merchant.includes('layout="map-first"'));
  assert.ok(rider.includes('max-h-[min(66dvh,700px)]'));
  assert.ok(merchant.includes('bookingReady={Boolean(pickupCoords && destinationCoords && !routeEditing)}'));
  assert.ok(driver.includes('clamp(340px, 58dvh, 620px)'));
  assert.ok(driver.includes('order-2 relative z-20'));

});

test('public welcome screen rotates three clearly labelled illustrative routes and provides account entry', async () => {
  const landing = await readFile('src/pages/LandingPage.tsx', 'utf8');
  assert.ok(landing.includes("from:'Freetown'"));
  assert.ok(landing.includes("from:'Bo'"));
  assert.ok(landing.includes("from:'Makeni'"));
  assert.ok(landing.includes('Illustrative route preview'));
  assert.ok(landing.includes('navigate(\'/login\')'));
  assert.ok(landing.includes('navigate(\'/signup\')'));
  assert.ok(landing.includes('setInterval'));
});

test('portal entry animates without delaying the authenticated session bootstrap', async () => {
  const home = await readFile('src/components/CustomerHome.tsx', 'utf8');
  const app = await readFile('src/App.tsx', 'utf8');
  const css = await readFile('src/index.css', 'utf8');
  assert.ok(home.includes('mm-portal-morph'));
  assert.ok(app.includes('const initialProfile='));
  assert.ok(app.includes('useState(!initialProfile)'));
  assert.ok(css.includes('@keyframes mm-portal-morph-in'));
});

test('all customer roles have a clear back path from services and role dashboards', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const services = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.ok(app.includes('Back to Services'));
  assert.ok(app.includes('Back to Home'));
  assert.ok(app.includes("setActiveSection(activeSection === 'ride' || activeSection === 'delivery' ? 'home' : 'services')"));
  assert.ok(services.includes('aria-label="Back to Home"'));
  assert.ok(services.includes("onNavigate('home')"));
});

test('home map car motion can be paused, resumed and its selected route shared', async () => {
  const map = await readFile('src/components/CustomerHomeMap.tsx', 'utf8');
  assert.ok(map.includes('pauseAnimations()'));
  assert.ok(map.includes('unpauseAnimations()'));
  assert.ok(map.includes('Share route'));
  assert.ok(map.includes('navigator.share'));
  assert.ok(map.includes('setActiveRoute'));
});

test('Account Services entry is compact and the Services directory uses separate full-screen sections', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const services = await readFile('src/components/PortalHome.tsx', 'utf8');
  assert.match(app, /aria-label="Open services"/);
  assert.match(app, /className="mm-account-link mm-account-link-compact"/);
  const css = await readFile('src/index.css', 'utf8');
  assert.match(css, /\.mm-account-link\.mm-account-link-compact \{ min-height:56px/);
  assert.equal((services.match(/fixed inset-0 z-\[130\]/g) || []).length, 3);
  assert.match(app, /<b>Services<\/b>/);
  assert.match(services, /const coreServices = role === 'driver'/);
  assert.match(services, /const extraServices = \[/);
  assert.match(services, /const serviceRow =/);
  assert.match(services, /More from MatMove|Explore more/);
  assert.match(services, /fixed inset-0 z-\[100\]/);
  assert.match(services, /servicePage === 'travel'/);
  assert.match(services, /servicePage === 'games'/);
  assert.match(services, /servicePage === 'concierge'/);
  assert.match(services, /panel === 'events' && <EventsModal/);
  assert.match(services, /fixed inset-0 z-\[120\]/);
  assert.match(services, /fixed inset-0 z-\[130\]/);
  assert.match(services, /Back to Services/);
});


test('Get Paid opens the secure payment URL and gives a one-second copy confirmation', async () => {
  const panel = await readFile('src/components/ReceiveMoneyPanel.tsx', 'utf8');
  assert.match(panel, /href=\{link\.publicUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.match(panel, /aria-label="Open your personal MatMove payment page in a new tab"/);
  assert.match(panel, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(panel, /setTimeout\(\(\) => setCopiedLabel\(''\), 1000\)/);
  assert.match(panel, /role="status" aria-live="polite"/);
  assert.match(panel, /copiedLabel === 'Payment link' \? 'Copied ✓' : 'Copy link'/);
});

test('customer header keeps the bell beside Quick guide on Home and Account only', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const home = await readFile('src/components/CustomerHome.tsx', 'utf8');
  assert.match(app, /\(activeSection==='home'\|\|activeSection==='account'\)&&\(/);
  assert.match(app, /header-notifications:/);
  assert.match(app, /Quick guide/);
  assert.doesNotMatch(app, /const AccountIdentity =/);
  assert.match(home, /Hello, \{name\}\./);
  assert.doesNotMatch(app, /Where to, \{profile\?\.first_name/);
});
