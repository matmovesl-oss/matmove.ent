
import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError, assertAllowed, keyFor, verifiedAccount, monime, dbClient } from './wallet-security.js';
import { validateSpinSectors, spinOdds, SPIN_ENTRY_MINOR, SPIN_COUNT } from '../shared/spin-rules.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = new Set(['completed', 'failed', 'review_required']);

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const known = /^(INVALID|FORBIDDEN|CONFLICT|NOT_FOUND):/;
    console.error('MatMove spin RPC failed', { function: name, code: error.code });
    throw new HttpError(known.test(error.message) ? 409 : 503,
      known.test(error.message) ? error.message.replace(/^[A-Z_]+:\s*/, '') : 'Game storage unavailable. Apply SPIN_GAME_SETUP.sql.');
  }
  return data;
}

async function readRound(db, id, userId) {
  let query = db.from('matmove_spin_rounds').select('*').eq('id', id);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new HttpError(503, 'Game receipt unavailable.');
  if (!data) throw new HttpError(404, 'Game not found for your account.');
  return data;
}

async function legsFor(db, id) {
  const { data, error } = await db.from('matmove_spin_legs').select('*').eq('round_id', id).order('spin_index');
  if (error) throw new HttpError(503, 'Game payment receipts unavailable.');
  return data;
}

function balance(account) {
  const value = account?.balance?.available;
  if (account?.currency !== 'SLE' || value?.currency !== 'SLE' || !Number.isSafeInteger(value?.value) || value.value < 0) {
    throw new HttpError(503, 'Available SLE balance could not be verified.');
  }
  return value.value;
}

export function matchesSpinReceipt(result, leg) {
  return typeof result?.id === 'string' && /^trn-[A-Za-z0-9_-]+$/.test(result.id) &&
    (!leg.provider_id || result.id === leg.provider_id) &&
    result.amount?.currency === 'SLE' && result.amount?.value === Number(leg.amount_minor) &&
    result.sourceFinancialAccount?.id === leg.source_account &&
    result.destinationFinancialAccount?.id === leg.destination_account &&
    result.metadata?.matmoveSpinRoundId === leg.round_id &&
    String(result.metadata?.spinIndex) === String(leg.spin_index) &&
    ['pending', 'processing', 'completed', 'failed'].includes(result.status);
}

export async function runSpinLeg(db, roundId, index, provider = monime) {
  const leg = await rpc(db, 'matmove_spin_claim', { p_id: roundId, p_index: index });
  if (!leg || terminal.has(leg.status) || (!leg.can_create && !leg.provider_id)) return;
  let result;
  try {
    result = leg.provider_id
      ? await provider(`internal-transfers/${encodeURIComponent(leg.provider_id)}`)
      : await provider('internal-transfers', {
          method: 'POST', headers: { 'Idempotency-Key': leg.request_key },
          body: JSON.stringify({
            amount: { currency: 'SLE', value: Number(leg.amount_minor) },
            sourceFinancialAccount: { id: leg.source_account },
            destinationFinancialAccount: { id: leg.destination_account },
            description: index === 0 ? 'MatMove Spin — entry for 3 spins' : `MatMove Spin — prize ${index}`,
            metadata: { matmoveSpinRoundId: roundId, spinIndex: String(index) },
          }),
        });
  } catch (error) {
    if (leg.can_create) {
      await rpc(db, 'matmove_spin_record', {
        p_id: roundId, p_index: index, p_provider: null, p_status: 'review_required',
        p_error: 'Payment response uncertain. Support must verify the original Monime request key before taking any action.',
      });
    }
    throw error;
  }
  const matches = matchesSpinReceipt(result, leg);
  await rpc(db, 'matmove_spin_record', {
    p_id: roundId, p_index: index,
    p_provider: matches ? result.id : (leg.provider_id || null),
    p_status: matches ? result.status : 'review_required',
    p_error: matches ? (result.failureDetail?.message || null) : 'Provider receipt does not match this game payment.',
  });
}

export async function reconcileSpinRound(db, id, provider = monime) {
  const round = await readRound(db, id);
  if (terminal.has(round.state) || round.state === 'active') return round;
  const legs = await legsFor(db, id);
  const pending = legs.find(leg => leg.status !== 'completed');
  if (pending) await runSpinLeg(db, id, pending.spin_index, provider);
  return readRound(db, id);
}

export async function spinSnapshot(db, round) {
  const legs = await legsFor(db, round.id);
  return {
    id: round.id, state: round.state, configId: round.config_id,
    sectors: round.sectors, odds: spinOdds(round.sectors), luckyDigit: round.lucky_digit,
    entryMinor: SPIN_ENTRY_MINOR, spinCount: SPIN_COUNT,
    spinsUsed: legs.filter(leg => leg.kind === 'win').length,
    paidMinor: legs.filter(leg => leg.kind === 'win' && leg.status === 'completed').reduce((sum, leg) => sum + Number(leg.amount_minor), 0),
    error: round.error, createdAt: round.created_at,
    receipts: legs.map(leg => ({
      index: leg.spin_index, sectorIndex: leg.sector_index, digit: leg.digit,
      amountMinor: Number(leg.amount_minor), providerId: leg.provider_id,
      status: leg.status, error: leg.error,
    })),
  };
}

async function respond(db, res, round) {
  return res.status(['entry_pending','win_pending'].includes(round.state) ? 202 : 200)
    .json({ round: await spinSnapshot(db, round) });
}

export async function spinAction(req, res, { provider = monime, verifyAccount = verifiedAccount, draw = randomInt } = {}) {
  const { db, user, profile, wallets } = req.matmove;
  const action = req.body.action;
  if (action === 'spin_cancel_entry') {
    const canceled = await rpc(db, 'matmove_spin_cancel_entry', {p_key:keyFor(user.id,'spin-entry',req.body.requestKey),p_user:user.id});
    if (canceled.canceled) return res.status(200).json({canceled:true});
    return respond(db,res,await reconcileSpinRound(db,canceled.roundId,provider));
  }
  if (action === 'spin_config') {
    const [config, access, rounds] = await Promise.all([
      db.from('matmove_spin_configs').select('*').order('id', { ascending: false }).limit(1),
      db.from('matmove_spin_access').select('*').eq('user_id', user.id).maybeSingle(),
      db.from('matmove_spin_rounds').select('*').eq('user_id', user.id).in('state', ['entry_pending','active','win_pending','review_required']).maybeSingle(),
    ]);
    if (config.error || access.error || rounds.error || !config.data?.[0]) throw new HttpError(503, 'Game setup unavailable.');
    const c = config.data[0];
    const sectors = validateSpinSectors(c.sectors);
    return res.status(200).json({
      config: { id: c.id, enabled: c.enabled && process.env.MATMOVE_SPIN_ENABLED === 'true', sectors, odds: spinOdds(sectors), entryMinor: SPIN_ENTRY_MINOR, spinCount: SPIN_COUNT },
      access: { approved: !!(access.data?.approved && access.data?.verified_adult), dailyLimitMinor: Number(access.data?.daily_limit_minor || 0) },
      round: rounds.data ? await spinSnapshot(db, rounds.data) : null,
    });
  }
  if (['spin_status', 'spin_draw'].includes(action)) {
    const id = req.body.roundId;
    if (!uuid.test(String(id || ''))) throw new HttpError(400, 'Valid game ID required.');
    let round = await readRound(db, id, user.id);
    if (action === 'spin_draw') {
      const index = req.body.spinIndex;
      if (!Number.isInteger(index) || index < 1 || index > SPIN_COUNT) throw new HttpError(400, 'Invalid spin number.');
      const sectors = validateSpinSectors(round.sectors);
      // CSPRNG samples each equal-sized sector; client choice never sets the outcome.
      const sector = draw(sectors.length);
      await rpc(db, 'matmove_spin_draw', { p_id: id, p_user: user.id, p_index: index, p_sector: sector });
    }
    round = await reconcileSpinRound(db, id, provider);
    return respond(db, res, round);
  }
  if (action !== 'spin_enter') throw new HttpError(400, 'Invalid game action.');
  const key = keyFor(user.id, 'spin-entry', req.body.requestKey);
  const existing = await db.from('matmove_spin_rounds').select('*').eq('request_key', key).maybeSingle();
  if (existing.error) throw new HttpError(503, 'Game storage unavailable.');
  if (existing.data) {
    if (existing.data.user_id !== user.id || existing.data.config_id !== req.body.configId || existing.data.lucky_digit !== req.body.luckyDigit) {
      throw new HttpError(409, 'Game entry request changed.');
    }
    return respond(db, res, await reconcileSpinRound(db, existing.data.id, provider));
  }
  if (process.env.MATMOVE_SPIN_ENABLED !== 'true') throw new HttpError(409, 'New game entries are paused.');
  if (req.body.acceptRules !== true || req.body.acceptedEntryMinor !== SPIN_ENTRY_MINOR || !Number.isSafeInteger(req.body.configId)) {
    throw new HttpError(409, 'Review and accept the current entry fee and prize chances.');
  }
  assertAllowed(profile, wallets, 'payout');
  const candidates = wallets.filter(wallet => wallet.currency === 'SLE');
  if (candidates.length !== 1) throw new HttpError(409, 'One verified SLE wallet is required.');
  const account = await verifyAccount(db, candidates[0]);
  if (balance(account) < SPIN_ENTRY_MINOR) throw new HttpError(409, 'You need SLE 5 available to enter.');
  const spinId = process.env.MONIME_SPIN_ACCOUNT_ID;
  if (!/^fac-[A-Za-z0-9_-]+$/.test(spinId || '') || [account.id, process.env.MONIME_ESCROW_ACCOUNT_ID, process.env.MONIME_PLATFORM_FEE_ACCOUNT_ID].includes(spinId)) {
    throw new HttpError(503, 'Configure a separate SLE Spin Account.');
  }
  const linked = await db.from('wallets').select('id').or(`monime_account_id.eq.${spinId},metadata->>monime_account_id.eq.${spinId}`);
  if (linked.error || linked.data.length !== 0) throw new HttpError(503, 'The Spin Account must not be linked to a customer wallet.');
  const observed = new Date().toISOString();
  const treasury = await provider(`financial-accounts/${encodeURIComponent(spinId)}?withBalance=true`);
  if (treasury.id !== spinId) throw new HttpError(503, 'Spin Account could not be verified.');
  const round = await rpc(db, 'matmove_spin_prepare', {
    p_key: key, p_user: user.id, p_wallet: candidates[0].id, p_config: req.body.configId,
    p_digit: req.body.luckyDigit, p_source: account.id, p_spin: spinId,
    p_balance: balance(treasury), p_observed: observed,
  });
  return respond(db, res, await reconcileSpinRound(db, round.id, provider));
}

export async function reconcileSpins(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(String(req.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  try {
    const db = dbClient();
    const { data, error } = await db.from('matmove_spin_rounds').select('id').in('state', ['entry_pending','win_pending']).order('updated_at').limit(5);
    if (error) throw error;
    const results = await Promise.allSettled(data.map(row => reconcileSpinRound(db, row.id)));
    const failed = results.filter(result => result.status === 'rejected').length;
    return res.status(failed ? 503 : 200).json({ checked: data.length, failed });
  } catch { return res.status(503).json({ error: 'Game receipt reconciliation unavailable.' }); }
}
