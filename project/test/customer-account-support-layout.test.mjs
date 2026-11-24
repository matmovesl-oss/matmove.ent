import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer global header is uncluttered: no Support trigger or notification bell', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const start = app.indexOf('const accountHeader=');
  const end = app.indexOf('</header>;', start);
  assert.ok(start >= 0 && end > start, 'customer header should be present');
  const header = app.slice(start, end);
  assert.doesNotMatch(header, /<CustomerSupport/);
  assert.doesNotMatch(header, /<NotificationBell/);
  assert.match(header, /<MatMoveHelp/);
});

test('Account contains the notification bell at the right side of its heading', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const start = app.indexOf('function AccountSection(');
  const heading = app.indexOf('<div className="mb-4 flex flex-wrap items-center justify-between gap-3">', start);
  const bell = app.indexOf('<NotificationBell', heading);
  const lock = app.indexOf('Lock app</button>', heading);
  const nextSection = app.indexOf('<div className="mb-3 grid', heading);
  assert.ok(start >= 0 && heading > start && bell > heading && lock > bell && nextSection > lock);
  assert.match(app.slice(heading, nextSection), /items-center gap-2/);
  assert.match(app.slice(heading, nextSection), /onNavigate={onNavigate}/);
});

test('Account keeps one Support Media entry and removes the legacy Customer Support dropdown and static WhatsApp link', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const account = app.indexOf('function AccountSection(');
  const mediaRow = app.indexOf("setActivePanel('support-media')", account);
  const dangerZone = app.indexOf('<section className="mb-4 rounded-2xl border border-red-100 bg-white p-4">', account);
  assert.ok(account >= 0 && mediaRow > account && dangerZone > mediaRow);
  const accountContent = app.slice(account, dangerZone);
  assert.match(accountContent, /<b>Support Media<\\/b>/);
  assert.doesNotMatch(accountContent, /<CustomerSupport|WHATSAPP_NUMBER|https:\\/\\/wa\\.me\\/|Chat with Support/);
  assert.doesNotMatch(accountContent, /<h2[^>]*>Customer Support/);
  assert.doesNotMatch(app, /const CustomerSupport = lazy/);
  assert.doesNotMatch(app, /const WHATSAPP_NUMBER =/);
  assert.match(app, /const SupportMediaPage = lazy/);
});

test('Support Media routes WhatsApp using the Admin-managed public contact record', async () => {
  const media = await readFile('src/components/SupportMediaPage.tsx', 'utf8');
  assert.match(media, /from\\('matmove_public_contacts'\\)/);
  assert.match(media, /\\.eq\\('is_active',true\\)/);
  assert.match(media, /const number=digits\\(item\\.whatsapp_phone\\)/);
  assert.match(media, /https:\\/\\/wa\\.me\\/\'+number/);
});
test('Account Support & Socials does not duplicate the separate WhatsApp link', async () => {
  const support = await readFile('src/components/CustomerSupport.tsx', 'utf8');
  assert.match(support, /hideWhatsappLink\?:boolean/);
  assert.match(support, /!hideWhatsappLink&&whatsappDigits/);
  assert.match(support, /hideWhatsappLink\?"inline":"hidden sm:inline"/);
});
