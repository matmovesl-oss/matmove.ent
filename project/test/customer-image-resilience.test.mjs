import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer announcements and product photos fall back when remote images fail', async () => {
  const [home, publicPosts, catalog, fallback, sw, main] = await Promise.all([
    readFile('src/components/CustomerHomePosts.tsx', 'utf8'),
    readFile('src/components/PublicHomepagePosts.tsx', 'utf8'),
    readFile('src/components/ProductCatalog.tsx', 'utf8'),
    readFile('public/image-unavailable.svg', 'utf8'),
    readFile('public/sw.js', 'utf8'),
    readFile('src/main.tsx', 'utf8')
  ]);
  for (const source of [home, publicPosts, catalog]) {
    assert.match(source, /image-unavailable\.svg/);
    assert.match(source, /currentTarget\.onerror=null/);
  }
  assert.match(fallback, /MatMove/);
  assert.match(sw, /matmove-shell-v3/);
  assert.ok(sw.includes('image-unavailable.svg'));
  assert.match(main, /document\.addEventListener\('error'/);
  assert.match(main, /image-unavailable\.svg/);
  assert.match(main, /mapboxgl-map, \.gm-style/);
});
