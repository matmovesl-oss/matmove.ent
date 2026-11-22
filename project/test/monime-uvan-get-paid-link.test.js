import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { liveWallet } from '../server/live-wallet.js';

const SLE_WALLET = [{
  id: 'wallet-sle',
  user_id: 'customer-1',
  currency: 'SLE',
  monime_account_id: 'fac-customer-1-sle',
  balance: 0,
}];

const account = (currency, uvan) => ({
  id: `fac-customer-1-${currency.toLowerCase()}`,
  uvan,
  currency,
  balance: { available: { currency, value: 12500 } },
});

test('SLE wallet exposes the Monime-provided UVAN and Get Paid URL without deriving it from the account ID', async () => {
  const result = await liveWallet(
    { wallets: SLE_WALLET, user: { id: 'customer-1' } },
    {
      verify: async () => account('SLE', '027027550'),
      provider: async () => [],
    },
  );

  assert.equal(result.sleWallet.monime_account_id, 'fac-customer-1-sle');
  assert.equal(result.sleWallet.monime_uvan, '027027550');
  assert.equal(result.sleWallet.monime_payment_url, 'https://pay.monime.io/027027550');
  assert.ok(!result.sleWallet.monime_payment_url.includes('fac-customer-1-sle'));
});

test('SLE Get Paid link is omitted when Monime does not return a valid UVAN', async () => {
  for (const uvan of [undefined, null, '', 'fac-customer-1', '02702/7550', '0270275500000000000000000']) {
    const result = await liveWallet(
      { wallets: SLE_WALLET, user: { id: 'customer-1' } },
      {
        verify: async () => account('SLE', uvan),
        provider: async () => [],
      },
    );

    assert.equal(result.sleWallet.monime_uvan, undefined);
    assert.equal(result.sleWallet.monime_payment_url, undefined);
  }
});

test('USD wallet does not show the SLE mobile-money Get Paid URL', async () => {
  const result = await liveWallet(
    {
      wallets: [{
        id: 'wallet-usd',
        user_id: 'customer-1',
        currency: 'USD',
        monime_account_id: 'fac-customer-1-usd',
      }],
      user: { id: 'customer-1' },
    },
    {
      verify: async () => account('USD', '027027550'),
      provider: async () => [],
    },
  );

  assert.equal(result.usdWallet.monime_uvan, '027027550');
  assert.equal(result.usdWallet.monime_payment_url, undefined);
});

test('Wallet Cards only opens Monime HTTPS Get Paid URLs and provides copy/share actions', async () => {
  const source = await readFile(new URL('../src/components/WalletCards.tsx', import.meta.url), 'utf8');

  assert.match(source, /wallet\?\.monime_payment_url/);
  assert.match(source, /parsed\.protocol === 'https:'/);
  assert.match(source, /parsed\.hostname === 'pay\.monime\.io'/);
  assert.match(source, /Copy Get Paid link/);
  assert.match(source, /Share payment link/);
  assert.match(source, /rel="noopener noreferrer"/);
});

test('Get Paid link is delivered through the existing wallet API; the twelve-route limit remains unchanged', async () => {
  const api = await readdir(new URL('../api/', import.meta.url));
  const source = await readFile(new URL('../api/get-live-wallet.js', import.meta.url), 'utf8');

  assert.equal(api.length, 12);
  assert.match(source, /protectedWallet\('read'/);
  assert.match(source, /liveWallet\(req\.matmove\)/);
});
