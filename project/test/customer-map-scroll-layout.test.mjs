import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('map-first ride location picker participates in page flow and leaves the map independently interactive', async () => {
  const source = await readFile(new URL('../src/components/RideLocationPicker.tsx', import.meta.url), 'utf8');
  assert.match(source, /relative z-10 w-full min-w-0 bg-\[#e9eef1\]/);
  assert.match(source, /h-\[min\(56dvh,520px\)\]/);
  assert.match(source, /gestureHandling: 'greedy'/);
  assert.doesNotMatch(source, /mapFirst\?"fixed inset-0/);
  assert.doesNotMatch(source, /fixed inset-x-0 bottom-\[calc\(64px/);
  assert.doesNotMatch(source, /fixed bottom-\[calc\(82px/);
});

test('merchant wallet actions stay in one compact row without wrapping or shrinking', async () => {
  const source = await readFile(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /flex flex-nowrap items-center justify-between gap-2/);
  assert.match(source, /flex shrink-0 items-center gap-1\.5 whitespace-nowrap/);
  assert.ok((source.match(/shrink-0 whitespace-nowrap rounded-lg/g) || []).length >= 3, 'All three wallet actions must remain compact and non-wrapping');
  assert.match(source, />Load<\/button>/);
  assert.match(source, />Withdraw<\/button>/);
  assert.match(source, />Transfer<\/button>/);
});

test('merchant ride booking panel stays in normal page flow and map keeps one-finger gestures', async () => {
  const merchant = await readFile(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../src/components/RideLocationPicker.tsx', import.meta.url), 'utf8');
  assert.match(merchant, /relative z-30 mx-auto w-full max-w-5xl min-w-0/, 'merchant booking details should be inline');
  assert.doesNotMatch(merchant, /fixed inset-x-0 bottom-\[calc\(76px/, 'merchant booking details must not be fixed over the map');
  assert.doesNotMatch(merchant, /Drag or tap to expand or collapse ride booking panel/, 'merchant booking panel must not trap page scrolling');
  assert.match(picker, /gestureHandling: 'greedy'/, 'map should pan with a single finger');
});

test('all rider, merchant and driver map surfaces show a scroll cue that scrolls the page down', async () => {
  const cue = await readFile(new URL('../src/components/MapScrollCue.tsx', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../src/components/RideLocationPicker.tsx', import.meta.url), 'utf8');
  const trip = await readFile(new URL('../src/components/ActiveTripMap.tsx', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../src/pages/DriverDashboard.tsx', import.meta.url), 'utf8');
  assert.match(cue, /aria-label="Scroll down to see more details below the map"/);
  assert.match(cue, /window\.scrollBy\(\{ top: distance, behavior: 'smooth' \}\)/);
  assert.match(cue, /absolute bottom-3 left-1\/2/);
  assert.match(picker, /MapScrollCue/);
  assert.match(trip, /MapScrollCue/);
  assert.match(driver, /MapScrollCue/);
});

test('rider cash-review notice is compact while retaining the full original reconciliation explanation', async () => {
  const rider = await readFile(new URL('../src/pages/RiderDashboard.tsx', import.meta.url), 'utf8');
  assert.match(rider, /A previous cash request is under review/);
  assert.match(rider, /Review in Trips/);
  assert.match(rider, /<details className="mt-2 border-t border-blue-200 pt-2 text-xs text-blue-900">/);
  assert.match(rider, /No cash settlement or refund has been recorded/);
  assert.match(rider, /do not make a duplicate payment/i);
});
