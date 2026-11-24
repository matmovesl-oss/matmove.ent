import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('rider marketplace reads merchant WhatsApp from the product row without an invalid profiles embed', async () => {
  const source = await readFile('src/pages/RiderDashboard.tsx', 'utf8');
  const start = source.indexOf('const fetchShopProducts = useCallback');
  const end = source.indexOf('const handleAddToCart', start);
  assert.ok(start >= 0 && end > start, 'shop catalog loader should be present');
  const loader = source.slice(start, end);

  assert.match(loader, /from\('products'\)\.select\('\*'\)/);
  assert.match(loader, /setProducts\(result\.data \|\| \[\]\)/);
  assert.doesNotMatch(loader, /merchant:merchant_id\([^)]*whatsapp_number/i);
  assert.doesNotMatch(loader, /profiles!.*whatsapp_number/i);
  assert.doesNotMatch(loader, /if \(result\.error\).*select\('\*'\)/s, 'the obsolete invalid embedded lookup must not be retried');
});
