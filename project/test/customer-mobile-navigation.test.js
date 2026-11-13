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
  assert.ok(services.includes('Open wallet'));
});

test('ride booking uses the full map-first location picker for rider and merchant', async () => {
  const picker = await readFile('src/components/RideLocationPicker.tsx', 'utf8');
  const rider = await readFile('src/pages/RiderDashboard.tsx', 'utf8');
  const merchant = await readFile('src/pages/MerchantDashboard.tsx', 'utf8');
  assert.ok(picker.includes("layout === 'map-first'"));
  assert.ok(picker.includes("clamp(340px, 58dvh, 620px)"));
  assert.ok(rider.includes('layout="map-first"'));
  assert.ok(merchant.includes('layout="map-first"'));
  assert.ok(rider.includes('max-h-[58dvh]'));
  assert.ok(merchant.includes('max-h-[58dvh]'));
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
