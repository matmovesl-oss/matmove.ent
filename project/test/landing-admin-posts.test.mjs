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

test('public homepage refreshes from Realtime and retains a 15-second hidden-tab-safe fallback', async () => {
  const source = await readFile(new URL('../src/components/PublicHomepagePosts.tsx', import.meta.url), 'utf8');
  assert.match(source, /window\.setInterval\(refreshWhenVisible, 15000\)/);
  assert.match(source, /supabase\.channel\('matmove-public-homepage-posts'\)/);
  assert.match(source, /table:\s*'matmove_homepage_post_feed_events'/);
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', refreshWhenVisible\)/);
  assert.match(source, /removeChannel\(channel\)/);
});


test('landing page presents the official MatMove eFootball Gala registration CTA before the main hero', async () => {
  const source = await readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8');
  const navEnd = source.indexOf('</nav>');
  const galaStart = source.indexOf('id="efootball-league-title"');
  const heroStart = source.indexOf('Your world moves.');
  assert.ok(navEnd >= 0 && galaStart > navEnd && heroStart > galaStart);
  assert.match(source, /MatMove eFootball Gala/);
  assert.match(source, /Register for the Gala/);
  assert.match(source, /<GalaRegistration open=\{galaRegistrationOpen\}/);
  assert.doesNotMatch(source, /Join via WhatsApp/);
});

test('Gala application shows the published eligibility, fixed country and required player details', async () => {
  const source = await readFile(new URL('../src/components/GalaRegistration.tsx', import.meta.url), 'utf8');
  for (const value of ['An active MatMove account','MatMove KYC already approved','A valid, active MatMove SLE wallet','A valid eFootball User ID','An active WhatsApp contact number','Legal name','Sierra Leone','Contact phone','WhatsApp number','Email address','MatMove SLE Wallet ID','eFootball User ID','eFootball team name']) {
    assert.ok(source.includes(value), 'Missing Gala requirement or field: ' + value);
  }
  assert.match(source, /I have read and accept the MatMove Terms/);
  assert.match(source, /I have read and accept the MatMove eFootball Gala competition rules/);
  assert.match(source, /matmove_sports_submit_application/);
  assert.match(source, /matmove_sports_my_application/);
  assert.match(source, /matmove_sports_public_registration_info/);
});

test('Gala landing form is account-bound and never accepts a client-supplied user ID', async () => {
  const source = await readFile(new URL('../src/components/GalaRegistration.tsx', import.meta.url), 'utf8');
  assert.match(source, /supabase\.auth\.getSession\(\)/);
  assert.match(source, /setUserId\(session\?\.user\?\.id/);
  assert.match(source, /p_competition_id: registration\.id/);
  assert.doesNotMatch(source, /p_user_id/);
  assert.match(source, /statusLabel/);
});
test('landing page downloads the official MatMove APK directly and retains iPhone Home Screen steps', async () => {
  const source = await readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /matmove-app-releases/);
  assert.ok(source.includes("list('android',{limit:20,search:'MatMove.apk'})"));
  assert.match(source, /getPublicUrl\(ANDROID_RELEASE_PATH\)/);
  assert.match(source, /searchParams\.set\('download','MatMove\.apk'\)/);
  assert.match(source, /Install MatMove for Android/);
  assert.doesNotMatch(source, /VITE_ANDROID_DOWNLOAD_URL|median\.co/);
  assert.match(source, /allow your browser or Files app to install this app/);
  assert.match(source, /Keep Play Protect enabled/);
  assert.ok(source.includes('Open <b>Safari</b> or <b>Chrome</b>'));
  assert.match(source, /Add to Home Screen/);
  assert.ok(source.includes('matmove.space'));
});
