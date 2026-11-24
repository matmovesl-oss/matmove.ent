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

test('Account keeps the direct WhatsApp contact and places Support & Socials beside it', async () => {
  const app = await readFile('src/App.tsx', 'utf8');
  const section = app.indexOf('<section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">', app.indexOf('function AccountSection('));
  const support = app.indexOf('<CustomerSupport', section);
  const whatsapp = app.indexOf('https://wa.me/${WHATSAPP_NUMBER}', section);
  const nextSection = app.indexOf('<section className="mb-4 rounded-2xl border border-red-100 bg-white p-4">', section);
  assert.ok(section >= 0 && support > section && whatsapp > support && nextSection > whatsapp);
  assert.match(app.slice(section, nextSection), /Chat with Support \(\+232 90 330 362\)/);
  assert.match(app.slice(section, nextSection), /Support & Socials/);
});

test('Account Support & Socials does not duplicate the separate WhatsApp link', async () => {
  const support = await readFile('src/components/CustomerSupport.tsx', 'utf8');
  assert.match(support, /hideWhatsappLink\?:boolean/);
  assert.match(support, /!hideWhatsappLink&&whatsappDigits/);
  assert.match(support, /hideWhatsappLink\?"inline":"hidden sm:inline"/);
});
