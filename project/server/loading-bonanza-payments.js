import { HttpError, dbClient, monime } from './wallet-security.js';
import { topupSettlement } from './payment-code.js';

const accountId = value => typeof value === 'string' && /^fac-[A-Za-z0-9_-]+$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function loadingBonanzaSource(env = process.env) {
  const id = env.MONIME_REFERRAL_ACCOUNT_ID;
  if (!accountId(id) || [env.MONIME_SPIN_ACCOUNT_ID, env.MONIME_ESCROW_ACCOUNT_ID, env.MONIME_PLATFORM_FEE_ACCOUNT_ID, env.MONIME_MAIN_ACCOUNT_ID].filter(Boolean).includes(id)) {
    throw new HttpError(503, 'Configure a separate SLE referral treasury for Loading Bonanza.');
  }
  return id;
}

export function loadingBonanzaBalance(account, id) {
  const value = account?.balance?.available;
  if (account?.id !== id || account.currency !== 'SLE' || value?.currency !== 'SLE' || !Number.isSafeInteger(value.value) || value.value < 0) {
    throw new HttpError(503, 'The referral treasury balance could not be verified.');
  }
  return value.value;
}

export function loadingBonanzaTransfer(reward) {
  if (!reward || ![reward.id, reward.topup_id, reward.request_key].every(uuid) ||
      typeof reward.provider_payment_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(reward.provider_payment_id) ||
      !accountId(reward.source_account) || !accountId(reward.destination_account) ||
      reward.source_account === reward.destination_account ||
      !Number.isSafeInteger(Number(reward.cashback_minor)) || Number(reward.cashback_minor) <= 0 ||
      reward.currency !== 'SLE') {
    throw new HttpError(503, 'Loading Bonanza transfer reservation is invalid.');
  }
  return {
    method: 'POST',
    headers: { 'Idempotency-Key': `matmove-loading-bonanza:${reward.request_key}` },
    body: JSON.stringify({
      amount: { currency: 'SLE', value: Number(reward.cashback_minor) },
      sourceFinancialAccount: { id: reward.source_account },
      destinationFinancialAccount: { id: reward.destination_account },
      description: 'MatMove Loading Bonanza cashback',
      metadata: {
        matmoveLoadingBonanzaRewardId: reward.id,
        matmoveLoadingBonanzaTopupId: reward.topup_id,
        matmoveMonimePaymentId: reward.provider_payment_id,
        matmoveRequestKey: reward.request_key
      }
    })
  };
}

export function matchesLoadingBonanzaReceipt(receipt, reward) {
  return typeof receipt?.id === 'string' && /^trn-[A-Za-z0-9_-]+$/.test(receipt.id) &&
    (!reward.provider_id || reward.provider_id === receipt.id) &&
    receipt.amount?.currency === 'SLE' &&
    receipt.amount?.value === Number(reward.cashback_minor) &&
    receipt.sourceFinancialAccount?.id === reward.source_account &&
    receipt.destinationFinancialAccount?.id === reward.destination_account &&
    receipt.metadata?.matmoveLoadingBonanzaRewardId === reward.id &&
    receipt.metadata?.matmoveLoadingBonanzaTopupId === reward.topup_id &&
    receipt.metadata?.matmoveMonimePaymentId === reward.provider_payment_id &&
    receipt.metadata?.matmoveRequestKey === reward.request_key &&
    ['pending', 'processing', 'completed', 'failed'].includes(receipt.status);
}

async function rpc(db, name, args) {
  const result = await db.rpc(name, args);
  if (result.error) {
    const message = String(result.error.message || '');
    const prefix = /^(FORBIDDEN|INVALID|CONFLICT|CAPACITY|PAUSED|NOT_FOUND):/;
    if (prefix.test(message)) throw new HttpError(409, message, message.split(':', 1)[0]);
    throw new HttpError(503, 'Loading Bonanza settlement storage is unavailable.');
  }
  return result.data;
}

export async function reconcileLoadingBonanzaReward(db, rewardId, provider = monime, env = process.env) {
  if (!uuid(rewardId)) throw new HttpError(400, 'A valid cashback reward ID is required.');
  const existing = await db.from('matmove_loading_bonanza_rewards').select('*').eq('id', rewardId).single();
  if (existing.error || !existing.data) throw new HttpError(503, 'Loading Bonanza reward could not be read.');
  let reward = existing.data;
  if (['completed', 'failed', 'budget_exhausted', 'review_required'].includes(reward.state)) return reward;

  if (reward.provider_id) {
    const receipt = await provider(`internal-transfers/${encodeURIComponent(reward.provider_id)}`);
    const matches = matchesLoadingBonanzaReceipt(receipt, reward);
    return rpc(db, 'matmove_loading_bonanza_record', { p_reward: reward.id, p_receipt: matches ? receipt : null });
  }

  const source = loadingBonanzaSource(env);
  if (reward.source_account !== source) throw new HttpError(503, 'The saved cashback source account does not match the configured referral treasury.');
  const account = await provider(`financial-accounts/${encodeURIComponent(source)}?withBalance=true`);
  const observed = new Date().toISOString();
  const balance = loadingBonanzaBalance(account, source);
  const claim = await rpc(db, 'matmove_loading_bonanza_claim', {
    p_reward: reward.id, p_balance: balance, p_observed: observed
  });
  if (!claim || claim.id !== reward.id) throw new HttpError(503, 'Cashback transfer authorization was not confirmed.');
  if (claim.provider_id) {
    const receipt = await provider(`internal-transfers/${encodeURIComponent(claim.provider_id)}`);
    return rpc(db, 'matmove_loading_bonanza_record', {
      p_reward: reward.id,
      p_receipt: matchesLoadingBonanzaReceipt(receipt, claim) ? receipt : null
    });
  }
  if (!claim.can_create) return claim;

  let receipt;
  try {
    receipt = await provider('internal-transfers', loadingBonanzaTransfer(claim));
  } catch (error) {
    // The provider may have accepted the POST even when the response was lost.
    // Persist review-required state; never create a second transfer blindly.
    await rpc(db, 'matmove_loading_bonanza_record', { p_reward: reward.id, p_receipt: null }).catch(() => {});
    throw error;
  }
  return rpc(db, 'matmove_loading_bonanza_record', {
    p_reward: reward.id,
    p_receipt: matchesLoadingBonanzaReceipt(receipt, claim) ? receipt : null
  });
}

export async function reconcileLoadingBonanzaPendingCodes(db = dbClient(), { provider = monime, limit = 3 } = {}) {
  const result = await db.from('matmove_loading_bonanza_pending_codes')
    .select('*').eq('state', 'pending').order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 3)));
  if (result.error || !Array.isArray(result.data)) throw new HttpError(503, 'Pending Monime Payment Code queue is unavailable.');
  let checked = 0, failed = 0;
  for (const row of result.data) {
    try {
      const code = await provider(`payment-codes/${encodeURIComponent(row.payment_code_id)}`);
      const validCode = code?.id === row.payment_code_id && code.status === 'completed' &&
        code.financialAccountId === row.destination_account && code.amount?.currency === 'SLE' &&
        code.amount?.value === Number(row.gross_minor) &&
        code.metadata?.matmoveUserId === row.user_id && code.metadata?.purpose === 'wallet_topup' &&
        (!row.reference || code.reference === row.reference);
      if (!validCode) {
        await db.from('matmove_loading_bonanza_pending_codes').update({
          state: 'review_required', attempts: Number(row.attempts || 0) + 1,
          last_checked_at: new Date().toISOString(),
          error: 'Monime Payment Code no longer matches its original completed MatMove request.',
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('state', 'pending');
        failed++;
        continue;
      }
      const settlement = await topupSettlement(code, provider);
      if (!settlement) {
        await db.from('matmove_loading_bonanza_pending_codes').update({
          attempts: Number(row.attempts || 0) + 1,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('state', 'pending');
        checked++;
        continue;
      }
      const topup = await rpc(db, 'matmove_loading_bonanza_record_topup', {
        p_user: row.user_id, p_wallet: row.wallet_id, p_payment_code: row.payment_code_id,
        p_provider_payment: settlement.paymentId, p_gross: code.amount.value,
        p_fee: settlement.feeMinor, p_credit: settlement.creditMinor, p_destination: code.financialAccountId
      });
      if (topup?.user_id !== row.user_id || topup?.wallet_id !== row.wallet_id ||
          topup?.payment_code_id !== row.payment_code_id || topup?.provider_payment_id !== settlement.paymentId ||
          Number(topup?.credit_minor) !== settlement.creditMinor || topup?.state !== 'completed') {
        throw new HttpError(503, 'Verified top-up receipt could not be linked to the pending Payment Code.');
      }
      const { error: updateError } = await db.from('matmove_loading_bonanza_pending_codes').update({
        state: 'recorded', topup_id: topup.id, attempts: Number(row.attempts || 0) + 1,
        last_checked_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString()
      }).eq('id', row.id).eq('state', 'pending');
      if (updateError) throw new HttpError(503, 'Pending Payment Code receipt could not be finalized.');
      checked++;
    } catch (error) {
      if (error?.code === 'CONFLICT' || error?.code === 'INVALID') {
        await db.from('matmove_loading_bonanza_pending_codes').update({
          state: 'review_required', attempts: Number(row.attempts || 0) + 1,
          last_checked_at: new Date().toISOString(),
          error: 'Verified Monime Payment Code receipt needs manual review.',
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('state', 'pending');
      } else {
        await db.from('matmove_loading_bonanza_pending_codes').update({
          attempts: Number(row.attempts || 0) + 1,
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', row.id).eq('state', 'pending');
      }
      failed++;
    }
  }
  return { checked, failed };
}

export async function reconcileLoadingBonanzaBatch(db = dbClient(), { provider = monime, env = process.env, limit = 3 } = {}) {
  const pendingCodes = await reconcileLoadingBonanzaPendingCodes(db, { provider, limit });
  const result = await db.from('matmove_loading_bonanza_rewards')
    .select('id')
    .in('state', ['pending', 'processing'])
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 3)));
  if (result.error || !Array.isArray(result.data)) throw new HttpError(503, 'Loading Bonanza reconciliation queue is unavailable.');
  let checked = pendingCodes.checked, failed = pendingCodes.failed;
  for (const row of result.data) {
    try {
      await reconcileLoadingBonanzaReward(db, row.id, provider, env);
      checked++;
    } catch (error) {
      const waiting = ['CAPACITY', 'PAUSED'].includes(error.code);
      if (waiting) checked++;
      else failed++;
    }
  }
  return { checked, failed };
}
