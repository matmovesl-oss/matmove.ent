import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('cash booking reader returns only booking fields and never leaks or references the fee account', async () => {
  const source = await readFile('server/cash-ride-payments.js', 'utf8');
  const start = source.indexOf('async function readBooking');
  const end = source.indexOf('async function readPayment', start);
  assert.ok(start >= 0 && end > start, 'readBooking must exist');
  const reader = source.slice(start, end);
  assert.match(reader, /return data;/);
  assert.doesNotMatch(reader, /platformFeeAccountId|fee_revenue_account_id/);
  const settingsStart = source.indexOf('async function readSettings');
  const settingsEnd = source.indexOf('function providerAccountBalance', settingsStart);
  const settings = source.slice(settingsStart, settingsEnd);
  assert.match(settings, /process\\.env\\.MONIME_PLATFORM_FEE_ACCOUNT_ID/);
  assert.match(settings, /data\\.fee_revenue_account_id !== platformFeeAccountId/);
});
