import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer portal uses compact responsive headings and preserves mobile form readability', async () => {
  const css = await readFile('src/index.css', 'utf8');
  assert.match(css, /\.portal-shell \.welcome-row h1[\s\S]*?font-size: clamp\(1\.25rem/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.portal-shell \.page-content/);
  assert.match(css, /font-size: max\(16px, 1rem\)/);
});
