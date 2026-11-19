import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const picker = readFileSync(new URL('../src/components/RideLocationPicker.tsx', import.meta.url), 'utf8');
const activeTrip = readFileSync(new URL('../src/components/ActiveTripMap.tsx', import.meta.url), 'utf8');

test('pickup GPS lookup reports automatic attempts and permission failures', () => {
  assert.match(picker, /Checking your phone GPS for the pickup location/);
  assert.match(picker, /MatMove does not have location permission/);
  assert.match(picker, /tap Use live location/);
});

test('pickup GPS retries with network-assisted location after a GPS error', () => {
  assert.match(picker, /Trying the phone’s network-assisted location/);
  assert.match(picker, /enableHighAccuracy: false, timeout: 12000, maximumAge: 30000/);
  assert.match(picker, /ageMs > 60000/);
});

test('active-trip GPS sharing explains permission failures and browser background limits', () => {
  assert.match(activeTrip, /location permission is denied/i);
  assert.match(activeTrip, /Backgrounding or closing this screen stops sharing/);
});

test('rider and merchant ride-map back arrows return to the customer home screen', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const merchant = readFileSync(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');
  assert.match(app, /onBack=\{\(\) => setActiveSection\('home'\)\}/);
  assert.match(merchant, /function MerchantMain\(\{ profile, wallet, activeSection, resumeTripId, onOpenTrips, onBack \}: any\)/);
  assert.match(merchant, /onBack=\{onBack \|\| \(\(\) => \{ setRouteEditing\(true\)/);
});
