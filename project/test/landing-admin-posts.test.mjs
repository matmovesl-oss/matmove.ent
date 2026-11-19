import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('public landing page reads only published, date-filtered MatMove posts from the public view', async () => {
  const source = await readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /from\('matmove_public_homepage_posts'\)/);
  assert.match(source, /getPublicUrl\(post\.image_path\)/);
  assert.match(source, /MatMove updates/);
  assert.match(source, /Updates, offers and announcements/);
});

test('landing page post loading is cancelled safely on unmount', async () => {
  const source = await readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /let live=true/);
  assert.match(source, /if\(live\)setPosts/);
  assert.match(source, /return\(\)=>\{live=false;\}/);
});
