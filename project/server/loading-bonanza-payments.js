import { HttpError, dbClient, monime } from './wallet-security.js';

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

async function runReward(db, rewardId, provider = monime, env = process.env) {
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

export async function reconcileLoadingBonanzaBatch(db = dbClient(), { provider = monime, env = process.env, limit = 3 } = {}) {
  const result = await db.from('matmove_loading_bonanza_rewards')
    .select('id')
    .in('state', ['pending', 'processing'])
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 3)));
  if (result.error || !Array.isArray(result.data)) throw new HttpError(503, 'Loading Bonanza reconciliation queue is unavailable.');
  let checked = 0, failed = 0;
  for (const row of result.data) {
    try {
      await runReward(db, row.id, provider, env);
      checked++;
    } catch (error) {
      const waiting = ['CAPACITY', 'PAUSED'].includes(error.code);
      if (waiting) checked++;
      else failed++;
    }
  }
  return { checked, failed };
}
