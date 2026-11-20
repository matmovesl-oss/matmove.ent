import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('map scroll cue is shown only while more page content remains and hides at the bottom', async () => {
  const cue = await readFile('src/components/MapScrollCue.tsx', 'utf8');
  assert.match(cue, /pageHeight - viewportHeight > 120/);
  assert.match(cue, /scrollTop \+ viewportHeight >= pageHeight - 48/);
  assert.match(cue, /setVisible\(hasMoreContent && !reachedBottom\)/);
  assert.match(cue, /window\.scrollBy\(\{ top: distance, behavior: 'smooth' \}\)/);
  assert.match(cue, /absolute bottom-3 left-1\/2/);
  assert.match(cue, /addEventListener\('scroll'/);
  assert.match(cue, /removeEventListener\('scroll'/);
});

test('the shared map components show the cue for rider, merchant and active driver trips', async () => {
  const [picker, trip, driver] = await Promise.all([
    readFile('src/components/RideLocationPicker.tsx', 'utf8'),
    readFile('src/components/ActiveTripMap.tsx', 'utf8'),
    readFile('src/pages/DriverDashboard.tsx', 'utf8'),
  ]);
  assert.match(picker, /import MapScrollCue from '@\/components\/MapScrollCue'/);
  assert.match(picker, /<MapScrollCue\/>/);
  assert.match(trip, /import MapScrollCue from '@\/components\/MapScrollCue'/);
  assert.match(trip, /<MapScrollCue\/>/);
  assert.match(driver, /import MapScrollCue from '@\/components\/MapScrollCue'/);
  assert.match(driver, /<MapScrollCue\/>/);
  assert.doesNotMatch(driver, /activeSection === 'home' && <MapScrollCue \/>/);
});
