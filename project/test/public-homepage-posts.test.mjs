import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('public landing page reads the restricted published-post view', async () => {
  const component = await read('../src/components/PublicHomepagePosts.tsx');
  const landing = await read('../src/pages/LandingPage.tsx');
  const migration = await read('../supabase/migrations/20261119174659_matmove_public_homepage_posts_view_v1.sql');

  assert.match(component, /from\('matmove_public_homepage_posts'\)/);
  assert.match(component, /image_path/);
  assert.match(component, /getPublicUrl/);
  assert.match(landing, /PublicHomepagePosts/);
  assert.match(migration, /status = 'published'/);
  assert.match(migration, /deleted_at is null/i);
  assert.match(migration, /grant select on public\.matmove_public_homepage_posts to anon/i);
  assert.doesNotMatch(migration, /created_by|updated_by/i);
});


test('public homepage view uses invoker security with narrowly scoped anonymous RLS access', async () => {
  const migration = await read('../supabase/migrations/20261122223335_matmove_public_homepage_posts_security_invoker_v1.sql');

  assert.match(migration, /grant select\s*\([\s\S]*?id[\s\S]*?title[\s\S]*?summary[\s\S]*?body[\s\S]*?image_path[\s\S]*?starts_at[\s\S]*?expires_at[\s\S]*?display_order[\s\S]*?price_amount[\s\S]*?price_currency[\s\S]*?created_at[\s\S]*?status[\s\S]*?deleted_at[\s\S]*?\)\s*on public\.matmove_homepage_posts to anon/i);
  assert.match(migration, /drop policy if exists matmove_homepage_posts_anon_public_feed_read/i);
  assert.match(migration, /create policy matmove_homepage_posts_anon_public_feed_read/i);
  assert.match(migration, /for select[\s\S]*?to anon/i);
  assert.match(migration, /using\s*\([\s\S]*?status\s*=\s*'published'/i);
  assert.match(migration, /deleted_at is null/i);
  assert.match(migration, /expires_at is null or expires_at > now\(\)/i);
  assert.doesNotMatch(migration, /starts_at is null or starts_at\s*<=\s*now\(\)/i);
  assert.match(migration, /alter view public\.matmove_public_homepage_posts\s+set\s*\(\s*security_invoker\s*=\s*true\s*,\s*security_barrier\s*=\s*true\s*\)/i);
  assert.doesNotMatch(migration, /grant select on public\.matmove_homepage_posts to anon/i);
  assert.doesNotMatch(migration, /created_by|updated_by|owner_id/i);
  assert.match(migration, /notify pgrst/i);
});
