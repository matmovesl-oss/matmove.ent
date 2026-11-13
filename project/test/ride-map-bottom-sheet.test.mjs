import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pickerFile = new URL('../src/components/RideLocationPicker.tsx', import.meta.url);
const riderFile = new URL('../src/pages/RiderDashboard.tsx', import.meta.url);

test('Rider map and booking controls use one expandable, scrollable bottom sheet', async () => {
  const picker = await readFile(pickerFile, 'utf8');
  const rider = await readFile(riderFile, 'utf8');

  assert.match(picker, /layout === 'map-first'/);
  assert.match(picker, /h-\[calc\(100dvh-164px\)\]/);
  assert.match(picker, /absolute inset-0 h-full w-full/);
  assert.match(picker, /max-h-\[68%\]/);
  assert.match(picker, /overflow-y-auto overscroll-contain/);
  assert.match(picker, /aria-expanded=\{sheetExpanded\}/);
  assert.match(picker, /\{locationControls\}\s*\{sheetContent\}/);

  assert.match(rider, /sheetContent=\{bookingPanelContent\}/);
  assert.match(rider, /Total Fare \(SLE\)/);
  assert.match(rider, /Payment method/);
  assert.match(rider, /Confirm Request/);
});

test('Cash availability remains guarded by the server settings and is not force-enabled in the client', async () => {
  const rider = await readFile(riderFile, 'utf8');
  assert.match(rider, /accept-ride-escrow\?action=cash_config/);
  assert.match(rider, /data\?\.enabled === true/);
  assert.match(rider, /disabled=\{cashConfigLoading \|\| !cashEnabled\}/);
  assert.match(rider, /separate restricted Monime fee-holding account/);
});
