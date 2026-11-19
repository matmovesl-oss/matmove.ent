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
  topup_id: '22222222-2222-4222-8222-222222222222',
  provider_payment_id: 'pay-123456',
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
  assert.match(migration, /after insert on public.matmove_loading_bonanza_topups/);
  assert.match(migration, /matmove_loading_bonanza_record_topup/);
  assert.match(migration, /new.credit_minor/);
  assert.match(migration, /new.provider_payment_id/);
  assert.match(migration, /on conflict\(topup_id\) do nothing/);
  assert.doesNotMatch(migration, /on public\.payment_transactions/);
  assert.match(migration, /payment_code_id text not null unique/);
  assert.match(migration, /provider_payment_id text not null unique/);
  assert.match(migration, /matmove_loading_bonanza_claim/);
  assert.match(migration, /matmove_loading_bonanza_record/);
  assert.match(migration, /matmove_loading_bonanza_funding_claim/);
  assert.match(migration, /matmove_loading_bonanza_funding_record/);
  assert.match(migration, /matmove_loading_bonanza_fundings/);
  assert.match(migration, /p_enabled and p_budget=0/);
});

test('only a completed Monime SLE top-up can create a cashback reward', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261119201500_matmove_loading_bonanza_cashback_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /p_provider_payment text/);
  assert.match(migration, /p_destination is null or p_destination !~ '\^fac-/);
  assert.match(migration, /upper\(currency\)='SLE'/);
  assert.match(migration, /v_cashback_minor:=floor\(\(new\.credit_minor::numeric\*c\.cashback_bps\)\/10000\)/);
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
  assert.equal(body.metadata.matmoveLoadingBonanzaTopupId, reward.topup_id);
  assert.equal(body.metadata.matmoveMonimePaymentId, reward.provider_payment_id);
  assert.equal(matchesLoadingBonanzaReceipt({
    id: 'trn-cashback',
    amount: { currency: 'SLE', value: 100 },
    sourceFinancialAccount: { id: reward.source_account },
    destinationFinancialAccount: { id: reward.destination_account },
    metadata: {
      matmoveLoadingBonanzaRewardId: reward.id,
      matmoveLoadingBonanzaTopupId: reward.topup_id,
      matmoveMonimePaymentId: reward.provider_payment_id,
      matmoveRequestKey: reward.request_key
    },
    status: 'completed'
  }, reward), true);
  assert.equal(matchesLoadingBonanzaReceipt({ status: 'completed' }, reward), false);
});

test('scheduled payment reconciliation includes Loading Bonanza with bounded counters', async () => {
  const source = await readFile(new URL('../server/payment-reconciliation.js', import.meta.url), 'utf8');
  assert.match(source, /reconcileLoadingBonanzaBatch/);
  assert.match(source, /'loadingBonanza'/);
  assert.match(source, /index === 4/);
  assert.match(source, /validCounts\(item\.value, \['checked', 'failed'\]\)/);
});

test('only the verified completed Payment Code receipt is recorded for cashback', async () => {
  const api = await readFile(new URL('../api/create-wallet-payment-code.js', import.meta.url), 'utf8');
  assert.match(api, /if\(result\.confirmed\)/);
  assert.match(api, /topupSettlement\(code,provider\)/);
  assert.match(api, /matmove_loading_bonanza_record_topup/);
  assert.match(api, /settlement\.paymentId/);
  assert.match(api, /settlement\.creditMinor/);
  assert.match(api, /code\.financialAccountId/);
  assert.match(api, /do not create another load/);
  assert.match(api, /reconcileLoadingBonanzaBatch\(context\.db/);
});
