import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Customer Help sends non-sensitive questions to a durable support conversation and keeps sensitive text local',async()=>{
 const help=await read('../src/components/MatMoveHelp.tsx');
 assert.match(help,/matmove_support_customer_open/);
 assert.match(help,/matmove_support_customer_message/);
 assert.match(help,/matmove_support_customer_list/);
 assert.match(help,/matmove_support_customer_messages/);
 assert.match(help,/guidance\.kind==='privacy'/);
 assert.match(help,/Your question has been sent to MatMove Support/);
 assert.match(help,/My support/);
 assert.match(help,/MatMove Support/);
 assert.match(help,/Never include your password, passcode, one-time code/);
});

test('Support inbox data is checked against the signed-in customer and the current ticket before display',async()=>{
 const help=await read('../src/components/MatMoveHelp.tsx');
 assert.match(help,/data\?\.user_id!==userId/);
 assert.match(help,/data\?\.conversation\?\.id!==id/);
 assert.match(help,/identity\.current!==userId/);
 assert.match(help,/requestKey\(\)/);
});

test('Wallet shows the MatMove logo once instead of the generic wallet pictogram',async()=>{
 const cards=await read('../src/components/WalletCards.tsx');
 const services=await read('../src/components/PortalHome.tsx');
 assert.match(cards,/src="\/logo\.jpg"/);
 assert.doesNotMatch(cards,/<Wallet\b/);
 assert.match(services,/src="\/logo\.jpg"/);
 assert.doesNotMatch(services,/title: 'Earnings & wallet'/);
 assert.doesNotMatch(services,/title: 'Business wallet'/);
 assert.doesNotMatch(services,/title: 'Wallet & payments'/);
 assert.match(services,/title: 'Wallet & payments'/);
});

test('Passcode keypad uses larger round number buttons and a stronger number weight',async()=>{
 const pin=await read('../src/components/CustomerPasscode.tsx');
 assert.match(pin,/h-\[4\.5rem\] w-\[4\.5rem\]/);
 assert.match(pin,/text-2xl font-extrabold/);
 assert.match(pin,/border-2 border-black/);
});

test('Public landing page refreshes when an Admin post changes and marks scheduled posts as coming soon',async()=>{
 const page=await read('../src/components/PublicHomepagePosts.tsx');
 const migration=await read('../supabase/migrations/20261120123000_matmove_public_homepage_posts_scheduled_realtime_v1.sql');
 assert.match(page,/matmove_public_homepage_posts/);
 assert.match(page,/matmove_homepage_post_feed_events/);
 assert.match(page,/postgres_changes/);
 assert.match(page,/window\.setInterval\(refresh,20000\)/);
 assert.match(page,/is_scheduled/);
 assert.match(page,/Coming soon/);
 assert.match(migration,/status = 'published'/);
 assert.match(migration,/starts_at is not null and starts_at > now\(\)/i);
 assert.doesNotMatch(migration,/starts_at is null or starts_at <= now\(\)/i);
 assert.match(migration,/matmove_homepage_post_feed_emit/);
 assert.match(migration,/for select to anon, authenticated\s+using \(true\)/i);
});

test('The first landing page continues to render the synced public posts component',async()=>{
 const landing=await read('../src/pages/LandingPage.tsx');
 assert.match(landing,/PublicHomepagePosts/);
});
