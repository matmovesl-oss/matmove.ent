import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutFees, runWithdrawalLeg } from '../server/payout-payments.js';

const withdrawal = {
  id: 'withdrawal-test-1',
  source_account: 'fac-customer',
  platform_account: 'fac-escrow',
  amount_minor: 10000,
  monime_fee_minor: 100,
  platform_fee_minor: 58,
  provider: 'm18',
  phone: '+23299123456'
};

function makeDb(leg) {
  const calls = [];
  const db = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'matmove_claim_withdrawal_leg') {
        return { data: leg, error: null };
      }
      if (name === 'matmove_record_withdrawal_leg') {
        return { data: { success: true }, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  return { db, calls };
}

function account(balance = 20000) {
  return {
    id: withdrawal.source_account,
    currency: 'SLE',
    balance: { available: { currency: 'SLE', value: balance } }
  };
}

function payout(overrides = {}) {
  return {
    id: 'pay-test-1',
    status: 'completed',
    amount: { currency: 'SLE', value: withdrawal.amount_minor },
    source: { financialAccountId: withdrawal.source_account },
    destination: {
      type: 'momo',
      providerId: withdrawal.provider,
      phoneNumber: withdrawal.phone
    },
    fees: [{ amount: { currency: 'SLE', value: 100 } }],
    ...overrides
  };
}

function newLeg(overrides = {}) {
  return {
    status: 'pending',
    can_create: true,
    provider_id: null,
    request_key: 'matmove-withdrawal-idempotency-key',
    amount_minor: withdrawal.amount_minor,
    ...overrides
  };
}

test('SLE payout fee arithmetic remains exact in minor units', () => {
  assert.deepEqual(payoutFees(10000), {
    amountMinor: 10000,
    monimeFeeMinor: 100,
    platformFeeMinor: 58,
    totalMinor: 10158,
    monimeRatePercent: 1,
    platformRatePercent: 0.58,
    currency: 'SLE'
  });
  assert.equal(payoutFees(1).totalMinor, 1);
  assert.throws(() => payoutFees(0), /Invalid payout amount/);
  assert.throws(() => payoutFees(1.5), /Invalid payout amount/);
});

test('new payout requires verified available source balance before a single provider payout request', async () => {
  const { db, calls } = makeDb(newLeg());
  const providerCalls = [];
  const provider = async (path, options) => {
    providerCalls.push({ path, options });
    if (path.startsWith('financial-accounts/')) return account();
    assert.equal(path, 'payouts');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Idempotency-Key'], 'matmove-withdrawal-idempotency-key');
    return payout();
  };

  await runWithdrawalLeg(db, withdrawal, 'payout', provider);

  assert.equal(providerCalls.length, 2);
  assert.equal(providerCalls[0].path, 'financial-accounts/fac-customer?withBalance=true');
  assert.equal(providerCalls[1].path, 'payouts');
  assert.deepEqual(calls.at(-1), {
    name: 'matmove_record_withdrawal_leg',
    args: {
      p_id: withdrawal.id,
      p_kind: 'payout',
      p_provider_id: 'pay-test-1',
      p_status: 'completed',
      p_error: null,
      p_actual_fee: 100
    }
  });
});

test('insufficient verified provider balance records a failed leg and never creates a payout', async () => {
  const { db, calls } = makeDb(newLeg());
  const providerCalls = [];
  const provider = async path => {
    providerCalls.push(path);
    return account(10000);
  };

  await runWithdrawalLeg(db, withdrawal, 'payout', provider);

  assert.deepEqual(providerCalls, ['financial-accounts/fac-customer?withBalance=true']);
  assert.deepEqual(calls.at(-1).args, {
    p_id: withdrawal.id,
    p_kind: 'payout',
    p_provider_id: null,
    p_status: 'failed',
    p_error: 'Insufficient available balance for payout plus Monime fee.',
    p_actual_fee: 0
  });
});

test('provider payout with a mismatched amount, source or destination is quarantined for review', async () => {
  const cases = [
    payout({ amount: { currency: 'SLE', value: 9999 } }),
    payout({ amount: { currency: 'USD', value: withdrawal.amount_minor } }),
    payout({ source: { financialAccountId: 'fac-other' } }),
    payout({ destination: { type: 'momo', providerId: 'm17', phoneNumber: withdrawal.phone } }),
    payout({ destination: { type: 'momo', providerId: withdrawal.provider, phoneNumber: '+23276111111' } }),
    payout({ status: 'cancelled' })
  ];

  for (const result of cases) {
    const { db, calls } = makeDb(newLeg());
    const providerCalls = [];
    const provider = async path => {
      providerCalls.push(path);
      return path.startsWith('financial-accounts/') ? account() : result;
    };

    await assert.rejects(
      () => runWithdrawalLeg(db, withdrawal, 'payout', provider),
      /receipt needs support review/i
    );
    assert.equal(providerCalls.filter(path => path === 'payouts').length, 1);
    assert.equal(calls.at(-1).args.p_status, 'review_required');
    assert.equal(calls.at(-1).args.p_provider_id, null);
  }
});

test('a previously recorded Monime payout ID is fetched and validated instead of creating another payout', async () => {
  const { db, calls } = makeDb(newLeg({
    can_create: false,
    provider_id: 'pay-existing-1'
  }));
  const providerCalls = [];
  const provider = async (path, options) => {
    providerCalls.push({ path, options });
    return payout({ id: 'pay-existing-1' });
  };

  await runWithdrawalLeg(db, withdrawal, 'payout', provider);

  assert.deepEqual(providerCalls, [{
    path: 'payouts/pay-existing-1',
    options: undefined
  }]);
  assert.equal(calls.at(-1).args.p_provider_id, 'pay-existing-1');
  assert.equal(calls.at(-1).args.p_status, 'completed');
  assert.equal(calls.at(-1).args.p_actual_fee, 100);
});

test('a provider fee receipt that is missing, malformed or in the wrong currency cannot finalize a payout leg', async () => {
  for (const fees of [
    undefined,
    [{ amount: { currency: 'USD', value: 100 } }],
    [{ amount: { currency: 'SLE', value: -1 } }],
    [{ amount: { currency: 'SLE', value: 1.5 } }]
  ]) {
    const { db, calls } = makeDb(newLeg());
    const provider = async path => path.startsWith('financial-accounts/')
      ? account()
      : payout({ fees });

    await runWithdrawalLeg(db, withdrawal, 'payout', provider);

    assert.equal(calls.at(-1).args.p_status, 'review_required');
    assert.match(calls.at(-1).args.p_error, /fee amounts/i);
    assert.equal(calls.at(-1).args.p_actual_fee, null);
  }
});

test('an already completed, failed or review-required leg is read-only and does not call Monime', async () => {
  for (const status of ['completed', 'failed', 'review_required']) {
    const { db, calls } = makeDb(newLeg({ status }));
    let providerCalls = 0;
    await runWithdrawalLeg(db, withdrawal, 'payout', async () => {
      providerCalls++;
      throw new Error('Provider must not be called for a terminal leg.');
    });
    assert.equal(providerCalls, 0);
    assert.deepEqual(calls, [{
      name: 'matmove_claim_withdrawal_leg',
      args: { p_id: withdrawal.id, p_kind: 'payout' }
    }]);
  }
});
