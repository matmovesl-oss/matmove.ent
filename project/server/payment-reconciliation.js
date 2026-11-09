import { timingSafeEqual } from 'node:crypto';

import { reconcileRidePayments } from './ride-api.js';
import { reconcileWithdrawals } from './payout-payments.js';
import { processMonimeWebhookBatch } from './monime-webhook-worker.js';

function validCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(String(req.headers?.authorization || ''), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function invokeHandler(handler, authorization) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await handler({ headers: { authorization } }, response);
  return response;
}

export async function reconcileMatMovePayments(
  req,
  res,
  {
    rides = reconcileRidePayments,
    payouts = reconcileWithdrawals,
    monime = processMonimeWebhookBatch
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
    monime({ limit: 10 })
  ]);

  const names = ['ridePayments', 'withdrawals', 'monimePurchaseEvents'];
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

    if (index < 2) {
      const response = item.value;
      result[names[index]] = response.body ?? {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        unavailable = true;
      }
    } else {
      // Permanently quarantined events are durably recorded for manual review;
      // that is a completed queue operation, not a worker transport failure.
      result[names[index]] = item.value;
    }
  }

  return res.status(unavailable ? 503 : 200).json({
    success: !unavailable,
    ...result
  });
}
