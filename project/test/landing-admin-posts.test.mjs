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


test('landing page only shows Admin-published active competitions and refreshes the public feed', async () => {
  const source = await readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /supabase\.rpc\('matmove_sports_public_registration_info'\)/);
  assert.match(source, /sportsCompetitions\.length>0/);
  assert.match(source, /sportsCompetitions\.map\(\(competition\)/);
  assert.match(source, /\{competition\.name\}/);
  assert.match(source, /\['registration','in_progress'\]\.includes\(item\.status\)/);
  assert.match(source, /setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'\)void refreshCompetitions\(\);\},30000\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /<GalaRegistration open=\{!!selectedCompetitionId\} competitionId=\{selectedCompetitionId\}/);
  assert.ok(!source.includes('MatMove eFootball Gala</h2>'));
  assert.doesNotMatch(source, /Register for the Gala/);
});

test('public sports feed returns every registration or in-progress competition and hides unpublished or finished seasons', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261126210052_matmove_sports_public_competition_feed_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /where status in \('registration', 'in_progress'\)/);
  assert.match(sql, /'competitions', v_competitions/);
  assert.match(sql, /'competition', v_primary/);
  assert.match(sql, /'registration_open'/);
  assert.match(sql, /'ends_at', c\.ends_at/);
  assert.match(sql, /'in_progress' then 'This competition is in progress/);
  assert.match(sql, /There are no published sports competitions at the moment/);
});

test('competition application modal uses the selected public competition and its own application status', async () => {
  const source = await readFile(new URL('../src/components/GalaRegistration.tsx', import.meta.url), 'utf8');
  assert.match(source, /competitionId\?: string \| null/);
  assert.match(source, /feed\?\.competitions\?\.find\(item => item\.id === competitionId\)/);
  assert.match(source, /p_competition_id: selectedCompetition\.id/);
  assert.match(source, /const registrationOpen = !!registration/);
  assert.match(source, /registration\?\.status === 'in_progress'/);
  assert.match(source, /p_competition_id: registration\.id/);
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


test('public landing header stays contained on narrow iPhone widths and refreshes the offline shell', async () => {
  const [landing, css, worker] = await Promise.all([
    readFile(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  ]);
  assert.match(landing, /className="mm-landing-header/);
  assert.match(landing, /className="mm-landing-brand/);
  assert.match(landing, /className="mm-landing-logo/);
  assert.match(landing, /className="mm-landing-actions/);
  assert.match(css, /\.mm-landing-header[\s\S]*?isolation:\s*isolate/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.mm-landing-logo[\s\S]*?background:\s*transparent !important/);
  assert.match(worker, /matmove-shell-v5/);
});
