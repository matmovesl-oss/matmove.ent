import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCashRideSplit } from '../shared/cash-payment-rules.js';

test('SLE 100 cash ride conserves fare as SLE 85 driver cash plus SLE 15 MatMove fee', () => {
  const split = calculateCashRideSplit('100.00');
  assert.equal(split.fareMinor, 10000);
  assert.equal(split.driverCashMinor, 8500);
  assert.equal(split.matmoveFeeMinor, 1500);
  assert.equal(split.driverCashMinor + split.matmoveFeeMinor, split.fareMinor);
});

test('cent rounding conserves all minor units', () => {
  const split = calculateCashRideSplit('12.35');
  assert.equal(split.driverCashMinor, 1050);
  assert.equal(split.matmoveFeeMinor, 185);
  assert.equal(split.driverCashMinor + split.matmoveFeeMinor, 1235);
});

test('invalid and out-of-range cash fares are rejected', () => {
  for (const value of ['0', '-1', '1.234', 'abc', '1000001', '']) assert.throws(() => calculateCashRideSplit(value));
});

test('customer cash and guest USSD previews make no live payment calls', async () => {
  const cash = await readFile(new URL('../src/components/CashPaymentPreview.tsx', import.meta.url), 'utf8');
  const guest = await readFile(new URL('../src/components/GuestUSSDPaymentPreview.tsx', import.meta.url), 'utf8');
  assert.ok(cash.includes('Preview only'));
  assert.ok(cash.includes('does not read or debit your real wallet'));
  assert.ok(!cash.includes('supabase.rpc') && !cash.includes('walletFetch') && !cash.includes('fetch('));
  assert.ok(guest.includes('Guest checkout'));
  assert.ok(guest.includes('Orange Money'));
  assert.ok(guest.includes('Afrimoney'));
  assert.ok(guest.toLowerCase().includes('no matmove account'));
  assert.ok(!guest.includes('supabase.rpc') && !guest.includes('walletFetch') && !guest.includes('fetch('));
});

test('guest checkout preview is a public route, outside the signed-in customer portal', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('<Route path="/guest-payment-preview" element={<GuestUSSDPaymentPreview />} />'));
});
