import test from 'node:test';
import assert from 'node:assert/strict';
import { monimeWalletDisplayName } from '../server/create-wallet.js';

test('Monime account label includes the verified MatMove user name, every service role and currency', () => {
  assert.equal(
    monimeWalletDisplayName({ full_name: 'Musa Kamara', roles: ['rider', 'driver'] }, 'SLE'),
    'Musa Kamara · Rider/Driver · SLE'
  );
  assert.equal(
    monimeWalletDisplayName({ first_name: 'Aminata', last_name: 'Sesay', role: 'merchant' }, 'USD'),
    'Aminata Sesay · Merchant · USD'
  );
});

test('Monime account label stays within the provider 100-character name limit', () => {
  const name = monimeWalletDisplayName({ full_name: 'A'.repeat(200), roles: ['rider', 'driver', 'merchant'] }, 'SLE');
  assert.ok(name.length <= 100);
  assert.match(name, /Rider\/Driver\/Merchant · SLE$/);
});

test('Monime account label fails closed when no verified MatMove role is present', () => {
  assert.throws(() => monimeWalletDisplayName({ full_name: 'Musa Kamara', roles: ['admin'] }, 'SLE'), /verified MatMove customer role/);
});


test('Monime account label falls back to the MatMove username when a full name is unavailable', () => {
  assert.equal(
    monimeWalletDisplayName({ username: 'sahr_driver', role: 'driver' }, 'SLE'),
    'sahr_driver · Driver · SLE'
  );
});

test('wallet refresh label reconciliation repairs every linked currency account without blocking access', async () => {
  const { syncMonimeWalletLabels } = await import('../server/create-wallet.js');
  const seen = [];
  const result = await syncMonimeWalletLabels({
    profile: { full_name: 'Musa Kamara', role: 'driver', roles: ['driver'] },
    wallets: [
      { currency: 'SLE', monime_account_id: 'fac-sle' },
      { currency: 'USD', monime_account_id: 'fac-usd' }
    ]
  }, {
    verify: async (_db, wallet) => ({ id: wallet.monime_account_id, currency: wallet.currency }),
    label: async (account, profile, currency) => {
      seen.push({ id: account.id, name: monimeWalletDisplayName(profile, currency) });
      return { account, pending: false };
    }
  });
  assert.deepEqual(seen, [
    { id: 'fac-sle', name: 'Musa Kamara · Driver · SLE' },
    { id: 'fac-usd', name: 'Musa Kamara · Driver · USD' }
  ]);
  assert.deepEqual(result, { labelsUpdated: 2, pending: [] });
});
