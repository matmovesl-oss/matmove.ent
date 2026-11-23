import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const home = await readFile(new URL('../src/components/CustomerHome.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const merchant = await readFile(new URL('../src/pages/MerchantDashboard.tsx', import.meta.url), 'utf8');
const announcements = await readFile(new URL('../src/components/CustomerHomePosts.tsx', import.meta.url), 'utf8');
const publicUpdates = await readFile(new URL('../src/components/PublicHomepagePosts.tsx', import.meta.url), 'utf8');

test('customer portal exposes the shared glass theme and green-blue palette', () => {
  assert.match(css, /--mm-glass:\s*rgba\(255, 255, 255,/);
  assert.match(css, /--green:\s*#109b71/);
  assert.match(css, /--blue:\s*#1769e0/);
  assert.match(css, /backdrop-filter:\s*blur\(17px\)/);
  assert.match(css, /family=Manrope/);
  assert.match(css, /family=Sora/);
});

test('customer home uses reusable glass hero and glass action tiles', () => {
  assert.match(home, /mm-glass-hero/);
  assert.ok((home.match(/mm-glass-tile/g) || []).length >= 3);
  assert.match(home, /accent:'bg-sky-50 text-sky-700'/);
  assert.match(home, /accent:'bg-blue-50 text-blue-700'/);
});

test('portal section changes use the blur-and-horizontal-shift transition', () => {
  assert.match(css, /mm-section-glass-in/);
  assert.match(css, /filter:\s*blur\(9px\)/);
  assert.match(css, /translate3d\(13px, 3px, 0\)/);
  assert.match(app, /sectionTransitioning/);
  assert.match(app, /mm-section-enter/);
});

test('glass motion and controls respect reduced-motion preferences', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /mm-section-enter, \.portal-shell \.mm-portal-morph\s*\{\s*animation:\s*none/s);
  assert.match(css, /\.portal-shell \.mm-portal-nav/);
});


test('rounded white panels across account, wallet, trips and service sections use glass styling', () => {
  assert.match(css, /\.portal-shell :is\(div, section, article, aside, form\)\[class\*="rounded-"\]\[class~="bg-white"\]/);
  assert.match(css, /linear-gradient\(145deg, rgba\(255,255,255,\.88\), rgba\(242,249,255,\.72\)\)/);
  assert.match(css, /backdrop-filter: blur\(17px\) saturate\(145%\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});


test('customer announcements and public homepage updates use dedicated glass surfaces', () => {
  assert.match(css, /mm-glass-announcements/);
  assert.match(css, /mm-glass-announcement-card/);
  assert.match(css, /mm-glass-public-updates/);
  assert.match(announcements, /mm-glass-announcements/);
  assert.match(announcements, /mm-glass-announcement-card/);
  assert.match(publicUpdates, /mm-glass-public-updates/);
  assert.match(publicUpdates, /mm-glass-announcement-card/);
});

test('merchant workspace roots participate in the shared glass system', () => {
  assert.match(merchant, /mm-merchant-workspace/);
  assert.match(css, /\.portal-shell \.mm-merchant-workspace/);
  assert.match(css, /--mm-glass-depth-hover/);
});
