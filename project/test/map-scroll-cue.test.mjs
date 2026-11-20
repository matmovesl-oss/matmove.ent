import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('map scroll cue is shown only while more page content remains and hides at the bottom', async () => {
  const cue = await readFile('src/components/MapScrollCue.tsx', 'utf8');
  assert.match(cue, /pageHeight - viewportHeight > 120/);
  assert.match(cue, /scrollTop \+ viewportHeight >= pageHeight - 48/);
  assert.match(cue, /setVisible\(hasMoreContent && !reachedBottom\)/);
  assert.match(cue, /window\.scrollBy\(/);
  assert.match(cue, /addEventListener\('scroll'/);
  assert.match(cue, /removeEventListener\('scroll'/);
});

test('rider, driver and merchant map screens all use the shared scroll cue', async () => {
  const [rider, driver, merchant] = await Promise.all([
    readFile('src/pages/RiderDashboard.tsx', 'utf8'),
    readFile('src/pages/DriverDashboard.tsx', 'utf8'),
    readFile('src/pages/MerchantDashboard.tsx', 'utf8'),
  ]);
  for (const source of [rider, driver, merchant]) {
    assert.match(source, /import MapScrollCue from '@\/components\/MapScrollCue'/);
    assert.match(source, /activeSection === 'home' && <MapScrollCue \/>/);
  }
  assert.doesNotMatch(driver, /<MapScrollCue\/>[\s\S]{0,40}mapError/);
});
