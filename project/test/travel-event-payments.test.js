import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestPurchaseTransfer,
  matchesPurchaseTransfer,
} from '../server/travel-event-payments.js';

const payment = {
  id: 'purchase-1',
  request_key: 'stable-request-key',
  provider_transfer_id: 'transfer-existing-1',
  amount_minor: 100,
  source_account_id: 'fac-customer',
  destination_account_id: 'fac-events',
};

const details = {
  target: 'event',
  bookingId: null,
  eventId: 'event-1',
  description: 'MatMove event tickets',
};

const user = { id: 'user-1' };

function receipt(overrides = {}) {
  return {
    id: 'transfer-existing-1',
    status: 'completed',
    amount: { currency: 'SLE', value: 100 },
    sourceFinancialAccount: { id: 'fac-customer' },
    destinationFinancialAccount: { id: 'fac-events' },
    ...overrides,
  };
}

test('a recorded provider transfer ID is reconciled with GET and never creates a second transfer', async () => {
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    return receipt();
  };

  const result = await requestPurchaseTransfer(payment, details, user, provider);

  assert.deepEqual(calls, [['internal-transfers/transfer-existing-1']]);
  assert.equal(result.id, 'transfer-existing-1');
});

test('a purchase without a provider ID creates exactly one idempotent transfer request', async () => {
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    return receipt();
  };

  await requestPurchaseTransfer(
    { ...payment, provider_transfer_id: null },
    details,
    user,
    provider
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'internal-transfers');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['Idempotency-Key'], payment.request_key);
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.amount.currency, 'SLE');
  assert.equal(body.amount.value, payment.amount_minor);
  assert.equal(body.sourceFinancialAccount.id, payment.source_account_id);
  assert.equal(body.destinationFinancialAccount.id, payment.destination_account_id);
  assert.equal(body.metadata.matmovePurchasePaymentId, payment.id);
});

test('purchase receipt matching requires the exact existing provider ID, amount, currency and accounts', () => {
  assert.equal(matchesPurchaseTransfer(payment, receipt()), true);
  assert.equal(matchesPurchaseTransfer(payment, receipt({ id: 'another-transfer' })), false);
  assert.equal(matchesPurchaseTransfer(payment, receipt({ amount: { currency: 'SLE', value: 99 } })), false);
  assert.equal(matchesPurchaseTransfer(payment, receipt({ amount: { currency: 'USD', value: 100 } })), false);
  assert.equal(matchesPurchaseTransfer(payment, receipt({ sourceFinancialAccount: { id: 'fac-other' } })), false);
  assert.equal(matchesPurchaseTransfer(payment, receipt({ destinationFinancialAccount: { id: 'fac-other' } })), false);
});

test('a failed GET for an existing provider transfer is propagated without a replacement POST', async () => {
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    throw new Error('Provider temporarily unavailable');
  };

  await assert.rejects(
    () => requestPurchaseTransfer(payment, details, user, provider),
    /Provider temporarily unavailable/
  );
  assert.deepEqual(calls, [['internal-transfers/transfer-existing-1']]);
});

test('a malformed non-null provider transfer ID fails closed without creating a transfer', async () => {
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    return receipt();
  };

  await assert.rejects(
    () => requestPurchaseTransfer({ ...payment, provider_transfer_id: 'bad/id' }, details, user, provider),
    /stored provider transfer ID is invalid/i
  );
  assert.deepEqual(calls, []);
});
