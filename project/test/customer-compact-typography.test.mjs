import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer portal uses compact responsive headings and preserves mobile form readability', async () => {
  const css = await readFile('src/index.css', 'utf8');
  assert.match(css, /\.portal-shell \.welcome-row h1[\s\S]*?font-size: clamp\(1\.25rem/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.portal-shell \.page-content/);
  assert.match(css, /font-size: max\(16px, 1rem\)/);
});

test('Rider, Driver and Merchant role headers stay compact without wrapping on phones', async () => {
  const [css, rider, driver, merchant] = await Promise.all([
    readFile('src/index.css', 'utf8'),
    readFile('src/pages/RiderDashboard.tsx', 'utf8'),
    readFile('src/pages/DriverDashboard.tsx', 'utf8'),
    readFile('src/pages/MerchantDashboard.tsx', 'utf8'),
  ]);
  assert.match(css, /\.portal-shell header\.sticky\.mm-role-header\s*\{\s*flex-wrap:\s*nowrap/);
  for (const source of [rider, driver, merchant]) {
    assert.match(source, /mm-role-header/);
    assert.match(source, /sm:hidden/);
    assert.match(source, /aria-label="Load wallet"/);
    assert.match(source, /aria-label="Withdraw from wallet"/);
    assert.match(source, /aria-label="Transfer between wallets"/);
  }
  assert.match(rider, /Where to,/);
  assert.match(driver, /Go offline/);
  assert.match(merchant, /Merchant Store/);
});

test('Support is a full-screen section with back navigation, Escape and an in-app inbox', async () => {
  const support = await readFile('src/components/CustomerSupport.tsx', 'utf8');
  assert.match(support, /aria-label=\{showInbox\\?'Back to Support & Socials':'Back to account'\}/);
  assert.match(support, /e\.key==='Escape'/);
  assert.match(support, /hideWhatsappLink\?"inline":"hidden sm:inline"/);
  assert.match(support, /min-h-\[100dvh\]/);
  assert.match(support, /No links have been added yet/);
  assert.match(support, /Message MatMove Support/);
});
