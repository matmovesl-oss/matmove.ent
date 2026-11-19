import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public landing updates use the published, date-filtered MatMove posts view', async () => {
  const source = await readFile(new URL('../src/components/PublicHomepagePosts.tsx', import.meta.url), 'utf8');
  assert.match(source, /from\('matmove_public_homepage_posts'\)/);
  assert.match(source, /getPublicUrl\(path\)/);
  assert.match(source, /Latest updates/);
  assert.match(source, /Announcements, offers and news from MatMove/);
});

test('homepage post loading is cancelled safely on unmount', async () => {
  const source = await readFile(new URL('../src/components/PublicHomepagePosts.tsx', import.meta.url), 'utf8');
  assert.match(source, /let active = true/);
  assert.match(source, /if \(active\) setPosts/);
  assert.match(source, /active = false/);
  assert.match(source, /clearInterval\(refresh\)/);
});
