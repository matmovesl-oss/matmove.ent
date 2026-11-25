import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer header places notifications beside Quick guide on Home and Account only', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const start = app.indexOf('const accountHeader=');
  const end = app.indexOf('</header>', start);
  assert.ok(start >= 0 && end > start, 'customer header should be present');
  const header = app.slice(start, end);
  assert.doesNotMatch(header, /<CustomerSupport/);
  assert.match(header, /Quick guide/);
  assert.match(header, /<NotificationBell/);
  assert.match(header, /activeSection==='home'\\|\\|activeSection==='account'/);
  assert.match(header, /<MatMoveHelp/);
});

test('Account does not duplicate the header notification bell', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const start = app.indexOf('function AccountSection(');
  const nextSection = app.indexOf('function PortalNavigation', start);
  assert.ok(start >= 0 && nextSection > start);
  const account = app.slice(start, nextSection);
  assert.doesNotMatch(account, /<NotificationBell/);
  assert.match(account, /aria-label="Lock app"/);
  assert.match(account, /Account & Profile/);
});

test('Account keeps one Support Media entry and removes the legacy Customer Support card', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const account = app.indexOf('function AccountSection(');
  const mediaRow = app.indexOf("setActivePanel('support-media')", account);
  const dangerZone = app.indexOf('<section className="mb-4 rounded-2xl border border-red-100 bg-white p-4">', account);
  assert.ok(account >= 0 && mediaRow > account && dangerZone > mediaRow);
  const accountContent = app.slice(account, dangerZone);
  assert.ok(accountContent.includes('<b>Support Media</b>'));
  assert.equal(accountContent.includes('<CustomerSupport'), false);
  assert.equal(accountContent.includes('WHATSAPP_NUMBER'), false);
  assert.equal(accountContent.includes('wa.me'), false);
  assert.equal(accountContent.includes('Chat with Support'), false);
  assert.equal(accountContent.includes('<h2 className="flex items-center gap-2 font-bold text-slate-900">Customer Support'), false);
  assert.equal(app.includes("const CustomerSupport = lazy"), false);
  assert.ok(app.includes("const SupportMediaPage = lazy"));
});

test('Support Media uses the Admin-managed WhatsApp contact instead of a hardcoded customer link', async () => {
  const media = await readFile('src/components/SupportMediaPage.tsx', 'utf8');
  assert.ok(media.includes("from('matmove_public_contacts')"));
  assert.ok(media.includes(".eq('is_active',true)"));
  assert.ok(media.includes('item.whatsapp_phone'));
  assert.ok(media.includes("https://wa.me/"));
});
test('Account Support & Socials does not duplicate the separate WhatsApp link', async () => {
  const support = await readFile('src/components/CustomerSupport.tsx', 'utf8');
  assert.match(support, /hideWhatsappLink\?:boolean/);
  assert.match(support, /!hideWhatsappLink&&whatsappDigits/);
  assert.match(support, /hideWhatsappLink\?"inline":"hidden sm:inline"/);
});
