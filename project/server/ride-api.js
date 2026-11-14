import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import {
  dbClient,
  protectedWallet
} from './wallet-security.js';

import {
  rideAction,
  reconcileRide
} from './ride-payments.js';
import { cashRideAction, reconcileCashRide } from './cash-ride-payments.js';

const actions = Object.fromEntries(
  ['accept', 'start', 'complete', 'cancel', 'status']
    .map(action => [
      action,
      protectedWallet('read', (req, res) => rideAction(req, res, action))
    ])
);

for (const action of ['cash_reserve', 'cash_confirm', 'cash_status', 'cash_config']) {
  actions[action] = protectedWallet(
    'read',
    (req, res) => cashRideAction(req, res, action)
  );
}

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
    secret.length < 32 ||
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

    // Cash-leg recovery shares this authenticated scheduler endpoint and
    // the existing API route count. Missing cash migrations are expected
    // before rollout; any other cash queue error fails the worker closed.
    const cashQueue = await db
      .from('matmove_cash_ride_legs')
      .select('booking_id')
      .or('status.in.(pending,processing),and(leg_kind.eq.refund,status.eq.ready)')
      .order('updated_at')
      .limit(5);

    const missingCashSchema = cashQueue.error && (
      cashQueue.error.code === '42P01' ||
      cashQueue.error.code === 'PGRST204' ||
      cashQueue.error.code === 'PGRST205'
    );
    if (cashQueue.error && !missingCashSchema) throw cashQueue.error;

    const cashBookingIds = missingCashSchema
      ? []
      : [...new Set((cashQueue.data || []).map(row => row.booking_id))];

    const cashResults = await Promise.allSettled(
      cashBookingIds.map(bookingId => reconcileCashRide(db, bookingId))
    );

    // The same protected worker opens durable investigation tickets for stale
    // unfinished requests and auto-cancels only unassigned, unpaid requests.
    const staleSweep = await db.rpc('matmove_ride_stale_request_sweep');
    if (staleSweep.error) throw staleSweep.error;

    const failed = results.filter(
      result => result.status === 'rejected'
    ).length;
    const cashFailed = cashResults.filter(
      result => result.status === 'rejected'
    ).length;

    return res.status(failed || cashFailed ? 503 : 200).json({
      checked: data.length,
      failed,
      cashChecked: cashBookingIds.length,
      cashFailed,
      cashAvailable: !missingCashSchema,
      staleRequests: staleSweep.data
    });
  } catch {
    return res.status(503).json({
      error: 'Ride reconciliation is unavailable.'
    });
  }
}

async function adminReconcileBooking(req,res){
  const allowedOrigin='https://matmove-admin.vercel.app';
  const origin=String(req.headers.origin||'');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  if(origin!==allowedOrigin)return res.status(403).json({error:'Dispatch origin is not allowed.'});
  res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
  if(req.method==='OPTIONS')return res.status(204).end();

  const token=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  const bookingId=req.body?.bookingId;
  if(!token||typeof bookingId!=='string'||!uuid.test(bookingId)){
    return res.status(400).json({error:'A valid Dispatch session and booking reference are required.'});
  }
  try{
    const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL;
    const anon=process.env.VITE_SUPABASE_ANON_KEY;
    if(!url||!anon)throw new Error('Supabase auth is not configured.');
    const authClient=createClient(url,anon,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:`Bearer ${token}`}}
    });
    const {data:actor,error:authError}=await authClient.rpc('matmove_dispatch_actor');
    if(authError||!actor)return res.status(403).json({error:'Active Dispatch permission is required.'});

    const db=dbClient();
    const {data:booking,error:bookingError}=await db.from('bookings')
      .select('id,payment_method,status')
      .eq('id',bookingId).maybeSingle();
    if(bookingError||!booking)return res.status(404).json({error:'Booking not found.'});

    if(booking.payment_method==='cash')await reconcileCashRide(db,bookingId);
    else await reconcileRide(db,bookingId);

    const [cash,digital,latest]=await Promise.all([
      db.from('matmove_cash_ride_payments').select('status').eq('booking_id',bookingId).maybeSingle(),
      db.from('ride_payments').select('state').eq('booking_id',bookingId).maybeSingle(),
      db.from('bookings').select('status').eq('id',bookingId).maybeSingle()
    ]);
    if(cash.error||digital.error||latest.error)throw new Error('Unable to verify the final payment state.');
    const paymentStatus=cash.data?.status||digital.data?.state||'not_required';
    return res.status(200).json({
      success:true,
      bookingId,
      bookingStatus:latest.data?.status||booking.status,
      paymentStatus,
      refundVerified:paymentStatus==='refunded'
    });
  }catch(error){
    console.error('MatMove Admin refund reconciliation failed',{
      code:typeof error?.code==='string'?error.code:null,
      status:Number.isInteger(error?.status)?error.status:null
    });
    return res.status(503).json({error:'Refund remains pending provider verification. The scheduled reconciliation worker will retry.'});
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
        'cash_reserve',
        'cash_confirm',
        'cash_status',
        'cash_config',
        'admin_reconcile',
        'reconcile'
      ].includes(action)
    ) {
      return res.status(400).json({
        error: 'Choose a valid ride action.'
      });
    }

    if(action==='admin_reconcile')return adminReconcileBooking(req,res);

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