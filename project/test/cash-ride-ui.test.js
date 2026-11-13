import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const riderFile = new URL('../src/pages/RiderDashboard.tsx', import.meta.url);
const driverFile = new URL('../src/pages/DriverDashboard.tsx', import.meta.url);
const tripHookFile = new URL('../src/lib/useTripRequest.ts', import.meta.url);
const rideServiceFile = new URL('../src/services/rideService.ts', import.meta.url);

test('rider cash option is gated by server cash configuration and only applies to Ride', async () => {
  const code = await readFile(riderFile, 'utf8');
  assert.match(code, /start-ride\?action=cash_config/);
  assert.match(code, /data\?\.enabled === true/);
  assert.match(code, /data\?\.accountsVerified === true/);
  assert.match(code, /serviceType === 'ride'/);
  assert.match(code, /disabled=\{cashConfigLoading \|\| !cashEnabled\}/);
  assert.match(code, /payment_method: paymentMethod/);
});

test('rider cash booking requires only the 15 percent fee in the digital SLE wallet', async () => {
  const code = await readFile(riderFile, 'utf8');
  assert.match(code, /paymentMethod === 'cash'[\s\S]*?\(fareMinor - driverCashMinor\) \/ 100/);
  assert.match(code, /cash-ride fee/);
  assert.match(code, /Confirm Cash Handed to Driver/);
  assert.match(code, /updateRide\(activeBooking\.payment_method === 'cash' \? 'cash_confirm' : 'complete'/);
  assert.match(code, /payment\?\.status === 'settled'/);
});

test('cash rider UI explains the escrow hold and verified release without digital fare negotiation', async () => {
  const code = await readFile(riderFile, 'utf8');
  assert.match(code, /activeBooking\.payment_method !== 'cash'[\s\S]*?FareNegotiation/);
  assert.match(code, /activeBooking\.payment_method === 'cash'[\s\S]*?physically; MatMove/);
  assert.match(code, /into escrow, then releases it to the platform fee account after both rider and driver confirm/);
  assert.match(code, /Accepted cash rides cannot be cancelled by the rider/);
});

test('assigned driver must explicitly confirm physical cash received', async () => {
  const code = await readFile(driverFile, 'utf8');
  assert.match(code, /updateRide\('cash_confirm', booking\.id\)/);
  assert.match(code, /Confirm Cash Received/);
  assert.match(code, /booking\.payment_method === 'cash'/);
});

test('driver cash cancellation does not report a refund before provider verification', async () => {
  const code = await readFile(driverFile, 'utf8');
  assert.match(code, /if \(result\.pending\)[\s\S]*?cash fee refund is still being verified/i);
  assert.match(code, /reserved MatMove fee refund is verified/);
});

test('cash trip submission uses the same booking ID for fee reservation recovery', async () => {
  const hook = await readFile(tripHookFile, 'utf8');
  const service = await readFile(rideServiceFile, 'utf8');
  assert.match(hook, /payment_method\s*===\s*'cash'/);
  assert.match(hook, /reserveCashRide\(body\.id/);
  assert.match(hook, /start-ride\?action=cash_reserve/);
  assert.match(service, /cash_confirm: '\/api\/start-ride\?action=cash_confirm'/);
  assert.match(service, /cash_reserve: '\/api\/start-ride\?action=cash_reserve'/);
});
