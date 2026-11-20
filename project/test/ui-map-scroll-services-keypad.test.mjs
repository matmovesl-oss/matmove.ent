import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('rider, driver and merchant map screens share the bottom-aware scroll cue', async () => {
  const [hint, rider, driver, merchant] = await Promise.all([
    readFile('src/components/ScrollDownHint.tsx', 'utf8'),
    readFile('src/pages/RiderDashboard.tsx', 'utf8'),
    readFile('src/pages/DriverDashboard.tsx', 'utf8'),
    readFile('src/pages/MerchantDashboard.tsx', 'utf8'),
  ]);

  assert.match(hint, /height - viewport > 120/);
  assert.match(hint, /position \+ viewport >= height - 48/);
  assert.match(hint, /setVisible\(canScroll && !reachedBottom\)/);
  assert.match(hint, /window\.scrollBy\(/);
  for (const dashboard of [rider, driver, merchant]) {
    assert.match(dashboard, /import ScrollDownHint from '@\/components\/ScrollDownHint'/);
    assert.match(dashboard, /<ScrollDownHint \/>/);
  }
});

test('passcode number keys, zero, delete and clear are circular with black borders', async () => {
  const keypad = await readFile('src/components/CustomerPasscode.tsx', 'utf8');
  assert.match(keypad, /aria-label="Passcode keypad" className="grid grid-cols-3 justify-items-center gap-3"/);
  assert.equal((keypad.match(/rounded-full border-2 border-black/g) || []).length, 4);
  assert.match(keypad, /h-14 w-14[^"]*rounded-full border-2 border-black/);
  assert.match(keypad, /aria-label="Delete last digit"/);
  assert.match(keypad, /appendDigit\('0'\)/);
});

test('account Services is a compact single row and its arrow opens the dedicated full-screen Services page', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  assert.match(app, /onServices=\{\(\) => setActiveSection\('services'\)\}/);
  assert.match(app, /onClick=\{onServices\} aria-label="Open Services"/);
  assert.match(app, /<b>Services<\/b><small>Open your services and tools<\/small>/);
  assert.match(app, /<ArrowRight size=\{18\}\/>/);
  assert.match(app, /activeSection === 'services' && <PortalHome[^>]*mode="services"/);
  assert.doesNotMatch(app, /servicesExpanded|mm-account-services-options|Explore all services/);
});
