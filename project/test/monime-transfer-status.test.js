import test from 'node:test';
import assert from 'node:assert/strict';
import { transferHandler } from '../api/create-monime-transfer.js';
import { checkTransferHandler } from '../api/check-monime-transfer.js';

const senderId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const senderWalletId = '33333333-3333-4333-8333-333333333333';
const recipientWalletId = '44444444-4444-4444-8444-444444444444';
const sourceAccountId = 'fac-sender-wallet';
const destinationAccountId = 'fac-recipient-wallet';
const transferId = 'itr-test-transfer-001';

const senderWallet = {
  id: senderWalletId, user_id: senderId, currency: 'SLE',
  monime_account_id: sourceAccountId, metadata: {},
};
const recipientWallet = {
  id: recipientWalletId, user_id: recipientId, currency: 'SLE',
  monime_account_id: destinationAccountId, metadata: {},
};
const profile = { id: recipientId, role: 'rider', kyc_status: 'approved', is_wallet_frozen: false };

function makeTransfer(status = 'completed', overrides = {}) {
  return {
    id: transferId,
    status,
    amount: { currency: 'SLE', value: 12550 },
    sourceFinancialAccount: { id: sourceAccountId },
    destinationFinancialAccount: { id: destinationAccountId },
    metadata: { userId: senderId, recipientUserId: recipientId },
    failureDetail: null,
    ...overrides,
  };
}

function makeDb(destination = recipientWallet) {
  const calls = [];
  const db = {
    from(table) {
      calls.push({ table });
      let filters = [];
      const query = {
        select() { return this; },
        or(value) { filters.push(['or', value]); return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        single() {
          if (table === 'profiles') return Promise.resolve({ data: profile, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve, reject) {
          let data = table === 'wallets' ? [destination] : [];
          for (const [key, value] of filters) {
            if (key === 'user_id') data = data.filter(row => row.user_id === value);
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { db, calls };
}

function makeResponse() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function transferRequest(status = 'completed', overrides = {}) {
  const calls = [];
  const { db, calls: dbCalls } = makeDb();
  const verifyAccount = async (_db, wallet) => ({
    id: wallet.monime_account_id,
    currency: wallet.currency,
  });
  const provider = async (path, options) => {
    calls.push({ path, options });
    return makeTransfer(status, overrides);
  };
  const req = {
    body: { recipientAccountId: destinationAccountId },
    matmove: {
      db,
      user: { id: senderId },
      accountId: sourceAccountId,
      currency: 'SLE',
      minor: 12550,
      idempotencyKey: 'same-request-key',
    },
  };
  return { req, calls, dbCalls, verifyAccount, provider };
}

function statusRequest(status = 'completed', overrides = {}, {
  destination = recipientWallet,
  ownWallets = [senderWallet],
  amount = '125.50',
  currency = 'SLE',
} = {}) {
  const calls = [];
  const { db, calls: dbCalls } = makeDb(destination);
  const verifyAccount = async (_db, wallet) => ({
    id: wallet.monime_account_id,
    currency: wallet.currency,
  });
  const provider = async path => {
    calls.push(path);
    return makeTransfer(status, overrides);
  };
  const req = {
    body: {
      transferId,
      recipientAccountId: destinationAccountId,
      amount,
      currency,
    },
    matmove: { db, user: { id: senderId }, wallets: ownWallets },
  };
  return { req, calls, dbCalls, verifyAccount, provider };
}

test('only provider-confirmed completed transfer returns completed', async () => {
  const f = transferRequest('completed');
  const res = makeResponse();
  await transferHandler(f.req, res, {
    provider: f.provider,
    verifyAccount: f.verifyAccount,
    assertRecipientAllowed: () => {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'completed');
  assert.equal(res.body.transferId, transferId);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'], 'same-request-key');
});

test('pending and processing transfers remain pending and are never reported completed', async () => {
  for (const status of ['pending', 'processing']) {
    const f = transferRequest(status);
    const res = makeResponse();
    await transferHandler(f.req, res, {
      provider: f.provider,
      verifyAccount: f.verifyAccount,
      assertRecipientAllowed: () => {},
    });

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.success, false);
    assert.equal(res.body.pending, true);
    assert.equal(res.body.status, status);
    assert.equal(res.body.transferId, transferId);
    assert.match(res.body.message, /not completed yet/i);
  }
});

test('confirmed failure is terminal and keeps a separate success=false result', async () => {
  const f = transferRequest('failed', {
    failureDetail: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds.' },
  });
  const res = makeResponse();
  await transferHandler(f.req, res, {
    provider: f.provider,
    verifyAccount: f.verifyAccount,
    assertRecipientAllowed: () => {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, false);
  assert.equal(res.body.status, 'failed');
  assert.equal(res.body.error, 'Insufficient funds.');
});

test('provider response with unknown status or mismatched accounts/amount is not treated as completed', async () => {
  const cases = [
    { status: 'queued' },
    { amount: { currency: 'SLE', value: 12500 } },
    { sourceFinancialAccount: { id: 'fac-other' } },
    { destinationFinancialAccount: { id: 'fac-other' } },
    { amount: { currency: 'USD', value: 12550 } },
    { id: '' },
  ];
  for (const override of cases) {
    const f = transferRequest('completed', override);
    const res = makeResponse();
    await transferHandler(f.req, res, {
      provider: f.provider,
      verifyAccount: f.verifyAccount,
      assertRecipientAllowed: () => {},
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.status, 'review_required');
    assert.equal(res.body.pending, true);
  }
});

test('currency mismatch is rejected before a provider transfer is submitted', async () => {
  const { req, calls, verifyAccount } = transferRequest();
  req.matmove.currency = 'USD';
  req.matmove.minor = 12550;
  const res = makeResponse();
  await assert.rejects(
    () => transferHandler(req, res, {
      provider: async (...args) => { calls.push(args); return makeTransfer(); },
      verifyAccount,
      assertRecipientAllowed: () => {},
    }),
    error => error.status === 409 && error.code === 'CURRENCY_MISMATCH'
  );
  assert.equal(calls.length, 0);
});

test('completed transfer status is checked against the authenticated sender, recipient, amount and currency', async () => {
  const f = statusRequest('completed');
  const res = makeResponse();
  await checkTransferHandler(f.req, res, {
    provider: f.provider,
    verifyAccount: f.verifyAccount,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status, 'completed');
  assert.deepEqual(f.calls, ['internal-transfers/' + transferId]);
  assert.equal(f.dbCalls.length, 1);
});

test('pending and processing status checks keep the transfer pending', async () => {
  for (const status of ['pending', 'processing']) {
    const f = statusRequest(status);
    const res = makeResponse();
    await checkTransferHandler(f.req, res, {
      provider: f.provider,
      verifyAccount: f.verifyAccount,
    });

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.pending, true);
    assert.equal(res.body.status, status);
  }
});

test('status check rejects transfer metadata belonging to another user', async () => {
  const f = statusRequest('completed', {
    metadata: { userId: '99999999-9999-4999-8999-999999999999', recipientUserId: recipientId },
  });
  const res = makeResponse();
  await assert.rejects(
    () => checkTransferHandler(f.req, res, {
      provider: f.provider,
      verifyAccount: f.verifyAccount,
    }),
    error => error.status === 409
  );
});

test('status check rejects amount, currency, source or destination mismatch', async () => {
  const cases = [
    { amount: { currency: 'SLE', value: 100 } },
    { amount: { currency: 'USD', value: 12550 } },
    { sourceFinancialAccount: { id: 'fac-other' } },
    { destinationFinancialAccount: { id: 'fac-other' } },
  ];
  for (const override of cases) {
    const f = statusRequest('completed', override);
    const res = makeResponse();
    await assert.rejects(
      () => checkTransferHandler(f.req, res, {
        provider: f.provider,
        verifyAccount: f.verifyAccount,
      }),
      error => error.status === 409
    );
  }
});

test('status check rejects a destination wallet with the wrong currency before reading Monime', async () => {
  const wrongWallet = { ...recipientWallet, currency: 'USD' };
  const f = statusRequest('completed', {}, { destination: wrongWallet });
  const res = makeResponse();
  await assert.rejects(
    () => checkTransferHandler(f.req, res, {
      provider: f.provider,
      verifyAccount: f.verifyAccount,
    }),
    error => error.status === 409
  );
  assert.equal(f.calls.length, 0);
});
