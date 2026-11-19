import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const riderFile = new URL('../src/pages/RiderDashboard.tsx', import.meta.url);
const driverFile = new URL('../src/pages/DriverDashboard.tsx', import.meta.url);
const merchantFile = new URL('../src/pages/MerchantDashboard.tsx', import.meta.url);

test('rider account transfer cannot default a missing Monime status to completed', async () => {
  const code = await readFile(riderFile, 'utf8');
  assert.match(code, /data\?\.status \|\| data\?\.data\?\.status \|\| 'unknown'/);
  assert.match(code, /status === 'unknown' \|\| status === 'review_required'/);
  assert.match(code, /Transfer status could not be verified\. Do not submit another transfer\./);
  assert.doesNotMatch(code, /data\?\.data\?\.status \|\| 'completed'/);
});

test('driver and merchant account transfers only display completed when provider status is completed', async () => {
  const [driver, merchant] = await Promise.all([
    readFile(driverFile, 'utf8'),
    readFile(merchantFile, 'utf8')
  ]);
  assert.match(driver, /status === 'completed' \? 'Transfer completed\.'/);
  assert.match(merchant, /status === 'completed' \? 'Transfer completed\.'/);
  assert.doesNotMatch(driver, /\|\| 'completed'/);
  assert.doesNotMatch(merchant, /\|\| 'completed'/);
});
