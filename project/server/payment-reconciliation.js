import { timingSafeEqual } from 'node:crypto';

import { reconcileRidePayments } from './ride-api.js';
import { reconcileWithdrawals } from './payout-payments.js';
import { processMonimeWebhookBatch } from './monime-webhook-worker.js';
import { reconcilePurchasePayments } from './travel-event-payments.js';
import { reconcileMerchantPayments } from './merchant-payments.js';
import { reconcileSpins } from './spin-payments.js';
import { reconcileArcades } from './arcade-payments.js';
import { reconcileReferrals } from './referral-api.js';
import { reconcileLoadingBonanzaBatch } from './loading-bonanza-payments.js';

function validCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(String(req.headers?.authorization || ''), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validCounts(value, keys) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    keys.every(key =>
      Number.isSafeInteger(value[key]) && value[key] >= 0
    )
  );
}

async function invokeHandler(handler, authorization, query = {}) {
  const response = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await handler({ method: 'GET', headers: { authorization }, query }, response);
  return response;
}

export async function reconcileMatMovePayments(
  req,
  res,
  {
    rides = reconcileRidePayments,
    payouts = reconcileWithdrawals,
    monime = processMonimeWebhookBatch,
    purchases = reconcilePurchasePayments,
    merchants = reconcileMerchantPayments,
    referrals = reconcileReferrals,
    spins = reconcileSpins,
    arcades = reconcileArcades
  } = {}
) {
  res.setHeader?.('Cache-Control', 'no-store');

  if (!validCronAuthorization(req)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const authorization = String(req.headers.authorization);
  const work = await Promise.allSettled([
    invokeHandler(rides, authorization),
    invokeHandler(payouts, authorization),
    invokeHandler(merchants, authorization),
    invokeHandler(referrals, authorization, { action: 'referral_reconcile' }),
    reconcileLoadingBonanzaBatch(undefined, { limit: 3 }),
    invokeHandler(spins, authorization),
    invokeHandler(arcades, authorization),
    monime({ limit: 3 }),
    purchases({ limit: 5 })
  ]);

  const names = ['ridePayments', 'withdrawals', 'merchantPayments', 'referrals', 'loadingBonanza', 'spinPayments', 'arcadePayments', 'monimeEvents', 'purchasePayments'];
  const result = {};
  let unavailable = false;

  for (let index = 0; index < work.length; index++) {
    const item = work[index];
    if (item.status === 'rejected') {
      unavailable = true;
      result[names[index]] = { unavailable: true };
      console.error('MatMove scheduled reconciliation failed', {
        worker: names[index],
        message: item.reason?.message || 'Unknown error'
      });
      continue;
    }

    if (index < 4 || index === 5 || index === 6) {
      const response = item.value;
      const countKeys = ['checked', 'failed'];
      if (
        !response ||
        !Number.isInteger(response.statusCode) ||
        response.statusCode < 200 ||
        response.statusCode >= 300 ||
        !validCounts(response.body, countKeys)
      ) {
        unavailable = true;
        result[names[index]] = { unavailable: true };
        continue;
      }
      result[names[index]] = response.body;
    } else if (index === 4) {
      if (!validCounts(item.value, ['checked', 'failed'])) {
        unavailable = true;
        result[names[index]] = { unavailable: true };
      } else result[names[index]] = item.value;
    } else {
      const counts = ['checked', 'processed', 'retrying', 'failed'];
      if (!validCounts(item.value, counts)) {
        unavailable = true;
        result[names[index]] = { unavailable: true };
        continue;
      }
      // Failed/quarantined webhook and purchase events are durably retained for review.
      result[names[index]] = item.value;
    }
  }

  return res.status(unavailable ? 503 : 200).json({
    success: !unavailable,
    ...result
  });
}
