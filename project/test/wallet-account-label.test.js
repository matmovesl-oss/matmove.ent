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
