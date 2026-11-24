import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Mapbox JavaScript and styles load only when the active-trip map is mounted', async () => {
  const paths = [
    'src/components/ActiveTripMap.tsx',
    'src/pages/RiderDashboard.tsx',
    'src/pages/DriverDashboard.tsx',
    'src/pages/MerchantDashboard.tsx',
  ];
  const [map, rider, driver, merchant] = await Promise.all(
    paths.map(path => readFile(path, 'utf8'))
  );

  assert.match(map, /import type mapboxgl from ['"]mapbox-gl['"]/);
  assert.match(map, /import\(['"]mapbox-gl['"]\)/);
  assert.match(map, /import\(['"]mapbox-gl\/dist\/mapbox-gl\.css['"]\)/);
  assert.match(map, /void loadMapbox\(\)\.then/);
  assert.doesNotMatch(map, /^import\s+mapboxgl\s+from\s+['"]mapbox-gl['"]/m);
  assert.doesNotMatch(map, /^import\s+['"]mapbox-gl\/dist\/mapbox-gl\.css['"]/m);

  for (const [name, source] of [['Rider', rider], ['Driver', driver], ['Merchant', merchant]]) {
    assert.match(source, /ActiveTripMap/, name + ' keeps the active trip map');
    assert.doesNotMatch(source, /^import\s+['"]mapbox-gl\/dist\/mapbox-gl\.css['"]/m,
      name + ' must not load Mapbox CSS with the dashboard');
  }

  assert.match(map, /Mapbox is not configured for this deployment/,
    'missing preview map credentials keep the existing safe fallback');
  assert.match(map, /Mapbox could not be loaded/,
    'dynamic import failures remain visible and retryable');
});
