import { timingSafeEqual } from 'node:crypto';

import {
  dbClient,
  protectedWallet
} from './wallet-security.js';

import {
  rideAction,
  reconcileRide
} from './ride-payments.js';

const actions = Object.fromEntries(
  ['accept', 'start', 'complete', 'cancel', 'status']
    .map(action => [
      action,

      protectedWallet(
        'read',
        (req, res) => rideAction(req, res, action)
      )
    ])
);

// Scheduled recovery requires CRON_SECRET.
// A customer's Supabase token cannot authorize this job.
export async function reconcileRidePayments(req, res) {
  const secret = process.env.CRON_SECRET;

  const expected = Buffer.from(
    `Bearer ${secret || ''}`
  );

  const received = Buffer.from(
    String(req.headers.authorization || '')
  );

  if (
    !secret ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return res.status(401).json({
      error: 'Unauthorized.'
    });
  }

  try {
    const db = dbClient();

    const { data, error } = await db
      .from('ride_payments')
      .select('booking_id')
      .in(
        'state',
        ['funding', 'releasing', 'refunding']
      )
      .order('updated_at')
      .limit(5);

    if (error) throw error;

    const results = await Promise.allSettled(
      data.map(row =>
        reconcileRide(db, row.booking_id)
      )
    );

    // Rotate unresolved rows so older cases do not
    // prevent newer payments from being checked.
    for (const row of data) {
      const update = await db
        .from('ride_payments')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('booking_id', row.booking_id)
        .in(
          'state',
          ['funding', 'releasing', 'refunding']
        );

      if (update.error) throw update.error;
    }

    const failed = results.filter(
      result => result.status === 'rejected'
    ).length;

    return res.status(failed ? 503 : 200).json({
      checked: data.length,
      failed
    });
  } catch {
    return res.status(503).json({
      error: 'Ride reconciliation is unavailable.'
    });
  }
}

export function createRidePaymentsHandler({
  rideHandlers = actions,
  reconciliation = reconcileRidePayments,
  defaultAction = 'accept'
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const action =
      req.query?.action === undefined
        ? defaultAction
        : req.query.action;

    if (
      typeof action !== 'string' ||
      ![
        'accept',
        'start',
        'complete',
        'cancel',
        'status',
        'reconcile'
      ].includes(action)
    ) {
      return res.status(400).json({
        error: 'Choose a valid ride action.'
      });
    }

    const method =
      action === 'reconcile' ? 'GET' : 'POST';

    if (req.method !== method) {
      res.setHeader('Allow', method);

      return res.status(405).json({
        error: 'Method not allowed.'
      });
    }

    if (action === 'reconcile') {
      return reconciliation(req, res);
    }

    return rideHandlers[action](req, res);
  };
}

export default createRidePaymentsHandler();