import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualReviewError, validateWalletTopupCheckoutSession } from '../server/monime-checkout-wallet-topup.js';

const payment = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  wallet_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  provider: 'monime', transaction_type: 'wallet_topup',
  provider_reference: 'cos-wallet-load-01', amount: '1.00', currency: 'SLE', status: 'pending',
  metadata: {
    checkout_session_id: 'cos-wallet-load-01',
    matmove_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    wallet_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    customer_role: 'rider', amount: '1.00', currency: 'SLE'
  }
};
const wallet = {
  id: payment.wallet_id, user_id: payment.user_id, currency: 'SLE',
  monime_account_id: 'fac-customer-wallet-01',
  metadata: { monime_account_id: 'fac-customer-wallet-01' }
};
const session = {
  id: 'cos-wallet-load-01', status: 'completed',
  financialAccountId: 'fac-customer-wallet-01',
  metadata: { userId: payment.user_id, role: 'rider' },
  lineItems: { data: [{
    name: 'Wallet Load', quantity: 1, price: { currency: 'SLE', value: 100 }
  }] }
};

test('accepts a checkout session matching the MatMove customer, wallet, amount and currency', () => {
  assert.deepEqual(validateWalletTopupCheckoutSession(payment, wallet, session), {
    status: 'completed', amountMinor: 100, currency: 'SLE', accountId: 'fac-customer-wallet-01'
  });
});
test('rejects a historical checkout account that no longer matches the wallet', () => {
  assert.throws(() => validateWalletTopupCheckoutSession(payment, wallet, { ...session, financialAccountId: 'fac-previous-wallet-01' }), ManualReviewError);
});
test('rejects a checkout linked to another customer', () => {
  const changed = { ...session, metadata: { ...session.metadata, userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } };
  assert.throws(() => validateWalletTopupCheckoutSession(payment, wallet, changed), ManualReviewError);
});
test('rejects changed amount and currency', () => {
  const amount = { ...session, lineItems: { data: [{ ...session.lineItems.data[0], price: { currency: 'SLE', value: 101 } }] } };
  const currency = { ...session, lineItems: { data: [{ ...session.lineItems.data[0], price: { currency: 'USD', value: 100 } }] } };
  assert.throws(() => validateWalletTopupCheckoutSession(payment, wallet, amount), ManualReviewError);
  assert.throws(() => validateWalletTopupCheckoutSession(payment, wallet, currency), ManualReviewError);
});
test('rejects mismatched checkout reference and stored ownership metadata', () => {
  assert.throws(() => validateWalletTopupCheckoutSession({ ...payment, provider_reference: 'cos-other' }, wallet, session), ManualReviewError);
  const badOwner = { ...payment, metadata: { ...payment.metadata, wallet_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } };
  assert.throws(() => validateWalletTopupCheckoutSession(badOwner, wallet, session), ManualReviewError);
});
test('rejects conflicting direct and legacy account IDs', () => {
  const badWallet = { ...wallet, metadata: { monime_account_id: 'fac-previous-wallet-01' } };
  assert.throws(() => validateWalletTopupCheckoutSession(payment, badWallet, session), ManualReviewError);
});
test('accepts only known Monime lifecycle states', () => {
  for (const status of ['pending', 'processing', 'cancelled', 'expired', 'completed']) {
    assert.equal(validateWalletTopupCheckoutSession(payment, wallet, { ...session, status }).status, status);
  }
  assert.throws(() => validateWalletTopupCheckoutSession(payment, wallet, { ...session, status: 'unknown' }), ManualReviewError);
});
