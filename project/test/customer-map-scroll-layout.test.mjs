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
