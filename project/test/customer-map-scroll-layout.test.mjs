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

test('merchant wallet actions remain compact, non-wrapping, and individually clickable', async () => {
  const source = await readFile(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /flex flex-nowrap items-center justify-between gap-2/);
  assert.match(source, /grid w-\[8\.75rem\] shrink-0 grid-cols-3 gap-1/);
  assert.match(source, /aria-label="Load wallet"/);
  assert.match(source, /aria-label="Withdraw from wallet"/);
  assert.match(source, /aria-label="Transfer money"/);
  assert.match(source, /onClick=\{\(\) => setIsLoadModalOpen\(true\)\}/);
  assert.match(source, /onClick=\{\(\) => setIsPayoutModalOpen\(true\)\}/);
  assert.match(source, /onClick=\{\(\) => setIsTransferModalOpen\(true\)\}/);
  assert.ok((source.match(/flex h-11 w-11 items-center justify-center rounded-xl/g) || []).length >= 3, 'All three actions retain 44px tap targets');
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

test('rider cash-review notice stays collapsed and retains the full reconciliation explanation', async () => {
  const rider = await readFile(new URL('../src/pages/RiderDashboard.tsx', import.meta.url), 'utf8');
  assert.match(rider, /Cash review · saved safely/);
  assert.match(rider, /<details className="mx-3 mb-2 rounded-xl border border-blue-200 bg-blue-50 text-xs text-blue-950">/);
  assert.match(rider, /Its live dispatch has been closed/);
  assert.match(rider, /cash-return confirmations and fee reserve remain preserved for MatMove Support/);
  assert.match(rider, /No cash settlement or refund has been recorded/);
  assert.match(rider, /make a fresh request while the case remains visible in Trips/);
  assert.match(rider, /Do not make a duplicate payment/i);
  assert.match(rider, /Review in Trips/);
});
