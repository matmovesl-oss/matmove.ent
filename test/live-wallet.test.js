import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertMonimeEnvironment } from '../server/wallet-security.js';
import { liveWallet } from '../server/live-wallet.js';

const wallets = [{
  id: 'wallet-driver',
  user_id: 'driver',
  currency: 'SLE',
  monime_account_id: 'fac-driver',
  balance: 0
}];

const verify = async () => ({
  id: 'fac-driver',
  balance: {
    available: {
      currency: 'SLE',
      value: 8500
    }
  }
});

test('driver balance is 85 from the provider even when Supabase cached balance is zero', async () => {
  const result = await liveWallet(
    { wallets },
    { verify, provider: async () => [] }
  );

  assert.equal(result.sleWallet.balance, 85);
  assert.equal(result.sleWallet.balanceAvailable, true);
});

test('history outage does not replace a confirmed driver balance with zero', async () => {
  const result = await liveWallet(
    { wallets },
    {
      verify,
      provider: async () => {
        throw new Error('History unavailable');
      }
    }
  );

  assert.equal(result.sleWallet.balance, 85);
  assert.equal(result.sleWallet.balanceAvailable, true);
  assert.equal(result.warnings.length, 1);
});

test('unverifiable or duplicated wallet is marked unavailable, never falsely zero', async () => {
  for (const [rows, checker] of [
    [wallets, async () => { throw new Error('Bad link'); }],
    [[...wallets, wallets[0]], verify]
  ]) {
    const result = await liveWallet(
      { wallets: rows },
      { verify: checker, provider: async () => [] }
    );

    assert.equal(result.sleWallet.balance, null);
    assert.equal(result.sleWallet.balanceAvailable, false);
  }
});

test('latest dashboard source uses backend payment intents and cannot directly cancel paid bookings', async () => {
  for (const role of ['Rider', 'Merchant', 'Driver']) {
    const source = await readFile(
      new URL(`../src/pages/${role}Dashboard.tsx`, import.meta.url),
      'utf8'
    );

    assert.ok(source.includes("from '@/services/rideService'"));
    assert.ok(source.includes('balanceAvailable === true'));
    assert.ok(source.includes('window.setInterval(refresh, 10000)'));

    if (role !== 'Driver') {
      assert.ok(source.includes("updateRide('complete', activeBooking.id)"));
      assert.ok(source.includes("updateRide('cancel', activeBooking.id)"));
      assert.ok(!source.includes("update({ status: 'cancelled' })"));
      assert.ok(!source.includes("walletFetch('/api/complete-ride-payout'"));
    }
  }
});

test('restored withdrawal handler is valid JavaScript and performs a Mobile Money payout', async () => {
  const source = await readFile(
    new URL('../api/create-monime-payout.js', import.meta.url),
    'utf8'
  );

  assert.ok(source.includes("protectedWallet('payout'"));
  assert.ok(source.includes("monime('payouts'"));
  assert.ok(!source.includes('completeRidePayoutHandler'));
});

test('production cannot silently use a Monime test token for real-money payments', () => {
  const oldKey = process.env.MONIME_API_KEY;
  const oldMode = process.env.MONIME_ENVIRONMENT;

  try {
    process.env.MONIME_API_KEY = 'mon_test_not-a-real-secret';
    process.env.MONIME_ENVIRONMENT = 'live';

    assert.throws(assertMonimeEnvironment, /does not match/);

    process.env.MONIME_ENVIRONMENT = 'test';
    assert.doesNotThrow(assertMonimeEnvironment);
  } finally {
    if (oldKey === undefined) delete process.env.MONIME_API_KEY;
    else process.env.MONIME_API_KEY = oldKey;

    if (oldMode === undefined) delete process.env.MONIME_ENVIRONMENT;
    else process.env.MONIME_ENVIRONMENT = oldMode;
  }
});

test('SLE wallet creation uses owner authentication and onboarding sends a session token', async () => {
  const api = await readFile(
    new URL('../api/create-monime-wallet.js', import.meta.url),
    'utf8'
  );

  const page = await readFile(
    new URL('../src/pages/OnboardingPages.tsx', import.meta.url),
    'utf8'
  );

  assert.ok(api.includes("protectedWallet('create'"));
  assert.ok(api.includes("createWallet(req, res, 'SLE')"));

  assert.match(
    page,
    /walletFetch\(\s*['"]\/api\/create-monime-wallet['"]\s*,\s*\{\s*\}\s*\)/
  );

  assert.ok(!page.includes("fetch('/api/create-monime-wallet'"));
});