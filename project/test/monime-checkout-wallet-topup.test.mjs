import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualReviewError, reconcileWalletTopupCheckoutSession, validateWalletTopupCheckoutSession } from '../server/monime-checkout-wallet-topup.js';

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

function mockDb({ paymentRows = [payment], walletRow = wallet, ledgerRows = [], settledPayment = null, settlementResult = null } = {}) {
  const calls = { updates: [], rpc: [] };
  const db = {
    calls,
    from(table) {
      const query = { table, patch: null, filters: [] };
      query.select = () => query;
      query.eq = (column, value) => { query.filters.push([column, value]); return query; };
      query.limit = async () => {
        if (table === 'payment_transactions' && !query.patch) return { data: paymentRows, error: null };
        if (table === 'ledger_transactions') return { data: ledgerRows, error: null };
        return { data: [], error: null };
      };
      query.maybeSingle = async () => {
        if (table === 'wallets') return { data: walletRow, error: null };
        if (table === 'payment_transactions' && query.patch) {
          calls.updates.push(query.patch);
          return { data: { id: payment.id, status: query.patch.status }, error: null };
        }
        if (table === 'payment_transactions') return { data: settledPayment || { status: 'completed', wallet_id: payment.wallet_id }, error: null };
        return { data: null, error: null };
      };
      query.update = patch => { query.patch = patch; return query; };
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return { data: settlementResult || {
        success: true, payment_transaction_id: payment.id,
        wallet_id: wallet.id, ledger_transaction_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      }, error: null };
    }
  };
  return db;
}

test('a completed verified session calls the protected settlement RPC exactly once', async () => {
  const db = mockDb();
  const result = await reconcileWalletTopupCheckoutSession(
    db, session, { verifyAccount: async (_db, w) => ({ id: w.monime_account_id, currency: w.currency }) }
  );
  assert.equal(result, 'processed');
  assert.equal(db.calls.rpc.length, 1);
  assert.equal(db.calls.rpc[0].name, 'settle_wallet_topup');
  assert.equal(db.calls.rpc[0].args.p_payment_transaction_id, payment.id);
  assert.equal(db.calls.rpc[0].args.p_provider_transaction_id, session.id);
});

test('a non-final verified session stays pending and never credits the wallet', async () => {
  const db = mockDb();
  const result = await reconcileWalletTopupCheckoutSession(
    db, { ...session, status: 'pending' },
    { verifyAccount: async (_db, w) => ({ id: w.monime_account_id, currency: w.currency }) }
  );
  assert.equal(result, 'pending');
  assert.equal(db.calls.rpc.length, 0);
  assert.equal(db.calls.updates.length, 0);
});

test('an expired verified session marks the old request failed without crediting it', async () => {
  const db = mockDb();
  const result = await reconcileWalletTopupCheckoutSession(
    db, { ...session, status: 'expired' },
    { verifyAccount: async (_db, w) => ({ id: w.monime_account_id, currency: w.currency }), now: () => '2026-11-23T00:00:00.000Z' }
  );
  assert.equal(result, 'processed');
  assert.equal(db.calls.rpc.length, 0);
  assert.equal(db.calls.updates[0].status, 'failed');
  assert.equal(db.calls.updates[0].failure_code, 'MONIME_CHECKOUT_EXPIRED');
});

test('a completed checkout with a mismatched ledger result is rejected', async () => {
  const db = mockDb({ settlementResult: {
    success: true, payment_transaction_id: payment.id,
    wallet_id: wallet.id, ledger_transaction_id: null
  }});
  await assert.rejects(
    async () => reconcileWalletTopupCheckoutSession(
      db, session, { verifyAccount: async (_db, w) => ({ id: w.monime_account_id, currency: w.currency }) }
    ),
    ManualReviewError
  );
});
