import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePurchasePayments } from '../server/travel-event-payments.js';

const payment = {
  id: 'purchase-1',
  state: 'processing',
  provider_status: 'processing',
  provider_transfer_id: 'transfer-existing-1',
  amount_minor: 100,
  source_account_id: 'fac-customer',
  destination_account_id: 'fac-events',
  fulfilled_at: null,
};

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

function fakeDb(row, { fulfilledAt = '2026-11-12T00:00:00.000Z', rpcError = null, updateError = null } = {}) {
  const updates = [];
  const rpcCalls = [];
  const db = {
    from(table) {
      assert.equal(table, 'matmove_purchase_payments');
      return {
        select() { return this; },
        in() { return this; },
        not() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: [row], error: null }); },
        update(patch) {
          updates.push(patch);
          return { eq: async () => ({ error: updateError }) };
        },
        eq() {
          return { single: async () => ({ data: { fulfilled_at: fulfilledAt }, error: null }) };
        },
      };
    },
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      return { data: { success: true }, error: rpcError };
    },
  };
  return { db, updates, rpcCalls };
}

test('completed existing transfer is verified, recorded and fulfilled exactly once', async () => {
  const state = fakeDb(payment);
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    return { result: receipt() };
  };

  const result = await reconcilePurchasePayments({ db: state.db, provider, limit: 5 });

  assert.deepEqual(calls, [['internal-transfers/transfer-existing-1']]);
  assert.deepEqual(result, { checked: 1, processed: 1, retrying: 0, failed: 0 });
  assert.equal(state.updates[0].state, 'completed');
  assert.equal(state.updates[0].provider_status, 'completed');
  assert.deepEqual(state.rpcCalls, [
    ['matmove_fulfill_purchase_payment', { p_payment_id: payment.id }]
  ]);
});

test('pending provider transfer stays processing and is never POSTed', async () => {
  const state = fakeDb(payment);
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    return receipt({ status: 'processing' });
  };

  const result = await reconcilePurchasePayments({ db: state.db, provider });

  assert.deepEqual(calls, [['internal-transfers/transfer-existing-1']]);
  assert.deepEqual(result, { checked: 1, processed: 0, retrying: 1, failed: 0 });
  assert.equal(state.updates[0].state, 'processing');
  assert.equal(state.updates[0].provider_status, 'processing');
  assert.equal(state.rpcCalls.length, 0);
});

test('provider GET failure preserves the existing payment state and never creates a replacement transfer', async () => {
  const state = fakeDb(payment);
  const calls = [];
  const provider = async (...args) => {
    calls.push(args);
    throw new Error('Provider unavailable');
  };

  const result = await reconcilePurchasePayments({ db: state.db, provider });

  assert.deepEqual(calls, [['internal-transfers/transfer-existing-1']]);
  assert.deepEqual(result, { checked: 1, processed: 0, retrying: 1, failed: 0 });
  assert.equal(state.updates.length, 0);
  assert.equal(state.rpcCalls.length, 0);
});

test('mismatched provider receipt is quarantined and cannot fulfil a purchase', async () => {
  const state = fakeDb(payment);
  const provider = async () => receipt({ amount: { currency: 'SLE', value: 99 } });

  const result = await reconcilePurchasePayments({ db: state.db, provider });

  assert.deepEqual(result, { checked: 1, processed: 0, retrying: 0, failed: 1 });
  assert.equal(state.updates[0].state, 'review_required');
  assert.equal(state.updates[0].provider_status, 'review_required');
  assert.equal(state.rpcCalls.length, 0);
});

test('provider-confirmed failure is recorded as failed without a new transfer', async () => {
  const state = fakeDb(payment);
  const provider = async () => receipt({ status: 'failed' });

  const result = await reconcilePurchasePayments({ db: state.db, provider });

  assert.deepEqual(result, { checked: 1, processed: 0, retrying: 0, failed: 1 });
  assert.equal(state.updates[0].state, 'failed');
  assert.equal(state.updates[0].provider_status, 'failed');
  assert.equal(state.rpcCalls.length, 0);
});

test('a payment without a stored provider transfer ID is skipped rather than charged by the worker', async () => {
  const state = fakeDb({ ...payment, provider_transfer_id: null });
  const calls = [];
  const provider = async (...args) => { calls.push(args); return receipt(); };

  const result = await reconcilePurchasePayments({ db: state.db, provider });

  assert.deepEqual(result, { checked: 0, processed: 0, retrying: 0, failed: 0 });
  assert.deepEqual(calls, []);
  assert.equal(state.rpcCalls.length, 0);
});
