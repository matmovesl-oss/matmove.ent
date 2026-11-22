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

test('homepage post hard-delete migration deletes records and removes archived rows from Admin list', async () => {
  const [migration, baseMigration] = await Promise.all([
    readFile(new URL('../supabase/migrations/20261122022007_matmove_homepage_posts_permanent_delete_and_active_list_v1.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20261113105352_matmove_homepage_posts_and_enquiries.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /'delete'/);
  assert.match(migration, /delete from public\.matmove_homepage_posts where id=p_id/i);
  assert.match(migration, /where deleted_at is null and status <> 'archived'/i);
  assert.match(migration, /'image_path',p\.image_path/);
  assert.match(baseMigration, /post_id uuid references public\.matmove_homepage_posts\(id\) on delete set null/i);
});

test('public homepage refreshes post changes frequently and when a hidden tab becomes visible', async () => {
  const source = await readFile(new URL('../src/components/PublicHomepagePosts.tsx', import.meta.url), 'utf8');
  assert.match(source, /}, 15000\)/);
  assert.match(source, /addEventListener\('visibilitychange', refreshWhenVisible\)/);
  assert.match(source, /removeEventListener\('visibilitychange', refreshWhenVisible\)/);
});
