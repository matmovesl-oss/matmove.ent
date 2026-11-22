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
