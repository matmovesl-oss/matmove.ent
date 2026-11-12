import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apiFile = new URL('../server/ride-api.js', import.meta.url);
const cashFile = new URL('../server/cash-ride-payments.js', import.meta.url);

test('cash pending-leg recovery is behind the existing scheduler secret and never a customer action', async () => {
  const api = await readFile(apiFile, 'utf8');
  assert.match(api, /secret\.length < 32/);
  assert.match(api, /from\('matmove_cash_ride_legs'\)/);
  assert.match(api, /in\('status', \['pending','processing'\]\)/);
  assert.match(api, /cashBookingIds\.map\(bookingId => reconcileCashRide\(db, bookingId\)\)/);
  assert.match(api, /cashAvailable: !missingCashSchema/);
  assert.match(api, /cashFailed/);
});

test('cash reconciliation only retries existing pending/processing transfer IDs', async () => {
  const cash = await readFile(cashFile, 'utf8');
  assert.match(cash, /export async function reconcileCashRide/);
  assert.match(cash, /\['pending','processing'\]\.includes\(leg\.status\)/);
  const reconcile = cash.slice(
    cash.indexOf('export async function reconcileCashRide'),
    cash.indexOf('export async function cashRideAction')
  );
  assert.match(reconcile, /runCashLeg\(db, bookingId, leg\.leg_kind, provider\)/);
  assert.doesNotMatch(reconcile, /internal-transfers.*POST/i);
});

test('cash recovery shares the existing ride API route and does not add an API entry', async () => {
  const api = await readFile(new URL('../api/accept-ride-escrow.ts', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
  assert.match(api, /server\/ride-api\.js/);
  assert.match(routes, /reconcile-ride-payments/);
});
