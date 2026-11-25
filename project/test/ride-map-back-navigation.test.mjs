import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const picker = readFileSync(new URL('../src/components/RideLocationPicker.tsx', import.meta.url), 'utf8');
const rider = readFileSync(new URL('../src/pages/RiderDashboard.tsx', import.meta.url), 'utf8');

test('map back arrow reopens pickup and destination instead of advancing to vehicle selection', () => {
  assert.match(picker, /setEditingRoute\(true\);onRouteEditingChange\?\.\(true\);onBackToSelection\(\)/);
  assert.match(picker, /Back to pickup and destination/);
  assert.doesNotMatch(picker, /Back to vehicle selection/);
});

test('returning to route editing preserves the current pickup and destination state', () => {
  assert.match(rider, /onBackToSelection=\{\(\) => \{ setRouteEditing\(true\); setViewMode\('new'\); setBookingSheetExpanded\(true\); \}\}/);
  assert.match(rider, /onBack=\{onBack\}/);
});
