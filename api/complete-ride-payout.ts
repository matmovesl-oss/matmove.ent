import { protectedWallet, monime, HttpError } from '../server/wallet-security.js';

export async function completeRidePayoutHandler(req: any, res: any) {
  const { db, user } = req.matmove;
  const { bookingId, driverId, amount } = req.body;

  if (!bookingId || !driverId || !amount) {
    throw new HttpError(400, 'Missing required booking details.');
  }

  const { data: booking } = await db.from('bookings').select('*').eq('id', bookingId).single();
  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (booking.status === 'completed') return res.status(200).json({ success: true, message: 'Already completed' });

  const { data: driverWallet, error: driverError } = await db
    .from('wallets')
    .select('monime_account_id')
    .eq('user_id', driverId)
    .eq('currency', 'SLE')
    .single();

  if (driverError || !driverWallet?.monime_account_id) {
    throw new HttpError(404, 'Driver financial account could not be found.');
  }

  const escrowAccountId = process.env.MONIME_ESCROW_ACCOUNT_ID;
  if (!escrowAccountId) {
    throw new HttpError(503, 'Platform escrow account is not configured.');
  }

  const fareMinorUnits = Math.round(Number(amount) * 100);
  const driverEarningsMinor = Math.round(fareMinorUnits * 0.85);

  const transfer = await monime('internal-transfers', {
    method: 'POST',
    headers: {
      'Idempotency-Key': `payout-release-${bookingId}-${Date.now()}`
    },
    body: JSON.stringify({
      amount: { currency: 'SLE', value: driverEarningsMinor },
      sourceFinancialAccount: { id: escrowAccountId },
      destinationFinancialAccount: { id: driverWallet.monime_account_id },
      description: `Trip Earnings Payout for Ride ${bookingId.slice(0, 8)}`,
      metadata: { bookingId, driverId, riderId: user.id }
    })
  });

  await db.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

  return res.status(200).json({ success: true, transfer });
}

export default protectedWallet('read', completeRidePayoutHandler);