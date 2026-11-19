import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadingBonanzaSource,
  loadingBonanzaBalance,
  loadingBonanzaTransfer,
  matchesLoadingBonanzaReceipt
} from '../server/loading-bonanza-payments.js';

const reward = {
  id: '11111111-1111-4111-8111-111111111111',
  payment_transaction_id: '22222222-2222-4222-8222-222222222222',
  request_key: '33333333-3333-4333-8333-333333333333',
  source_account: 'fac-referral',
  destination_account: 'fac-customer',
  cashback_minor: 100,
  currency: 'SLE'
};

test('Loading Bonanza is fixed at one percent and requires a separate referral treasury', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261119201500_matmove_loading_bonanza_cashback_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /cashback_bps integer not null default 100 check \(cashback_bps = 100\)/);
  assert.match(migration, /minimum_topup_minor bigint/);
  assert.match(migration, /after update of status on public.payment_transactions/);
  assert.match(migration, /lt.status = 'posted'/);
  assert.match(migration, /on conflict\(payment_transaction_id\) do nothing/);
  assert.match(migration, /matmove_loading_bonanza_claim/);
  assert.match(migration, /matmove_loading_bonanza_record/);
});

test('only a completed Monime SLE top-up can create a cashback reward', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261119201500_matmove_loading_bonanza_cashback_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /new.status <> 'completed'/);
  assert.match(migration, /lower\(new.provider\) <> 'monime'/);
  assert.match(migration, /upper\(new.currency\) <> 'SLE'/);
  assert.match(migration, /v_cashback_minor := floor\(\(v_topup_minor::numeric \* c.cashback_bps\) \/ 10000\)/);
});

test('treasury and balance must be verified before cashback transfer', () => {
  assert.equal(loadingBonanzaSource({ MONIME_REFERRAL_ACCOUNT_ID: 'fac-referral' }), 'fac-referral');
  assert.throws(() => loadingBonanzaSource({ MONIME_REFERRAL_ACCOUNT_ID: 'fac-main', MONIME_MAIN_ACCOUNT_ID: 'fac-main' }));
  assert.equal(loadingBonanzaBalance({ id: 'fac-referral', currency: 'SLE', balance: { available: { currency: 'SLE', value: 1000 } } }, 'fac-referral'), 1000);
  assert.throws(() => loadingBonanzaBalance({ id: 'fac-referral', currency: 'USD', balance: { available: { currency: 'USD', value: 1000 } } }, 'fac-referral'));
});

test('cashback Monime transfer is exact, linked and idempotent', () => {
  const request = loadingBonanzaTransfer(reward);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['Idempotency-Key'], `matmove-loading-bonanza:${reward.request_key}`);
  const body = JSON.parse(request.body);
  assert.deepEqual(body.amount, { currency: 'SLE', value: 100 });
  assert.equal(body.sourceFinancialAccount.id, reward.source_account);
  assert.equal(body.destinationFinancialAccount.id, reward.destination_account);
  assert.equal(body.metadata.matmovePaymentTransactionId, reward.payment_transaction_id);
  assert.equal(matchesLoadingBonanzaReceipt({
    id: 'trn-cashback',
    amount: { currency: 'SLE', value: 100 },
    sourceFinancialAccount: { id: reward.source_account },
    destinationFinancialAccount: { id: reward.destination_account },
    metadata: {
      matmoveLoadingBonanzaRewardId: reward.id,
      matmovePaymentTransactionId: reward.payment_transaction_id,
      matmoveRequestKey: reward.request_key
    },
    status: 'completed'
  }, reward), true);
  assert.equal(matchesLoadingBonanzaReceipt({ status: 'completed' }, reward), false);
});
