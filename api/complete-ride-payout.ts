import { protectedWallet, monime, HttpError } from '../server/wallet-security.js';

export async function completeRidePayoutHandler(req: any, res: any) {
  const { db, user } = req.matmove;
  const { bookingId, driverId, amount } = req.body;

  if (!bookingId || !driverId || !amount) {
    throw new HttpError(400, 'Missing required booking details.');
  }

  // 1. Verify booking
  const { data: booking } = await db
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (booking.status === 'completed') {
    return res.status(200).json({ success: true, message: 'Already completed' });
  }

  // 2. Get the Driver's Wallet ID
  const { data: driverWallet, error: driverError } = await db
    .from('wallets')
    .select('monime_account_id')
    .eq('user_id', driverId)
    .eq('currency', 'SLE')
    .single();

  if (driverError || !driverWallet?.monime_account_id) {
    throw new HttpError(404, 'Driver financial account could not be found.');
  }

  // 3. Get the Platform Escrow ID
  const escrowAccountId = process.env.MONIME_ESCROW_ACCOUNT_ID;
  if (!escrowAccountId) {
    throw new HttpError(503, 'Platform escrow account is not configured.');
  }

  // 4. Calculate 85% Driver Cut
  const fareMinorUnits = Math.round(Number(amount) * 100);
  const driverEarningsMinor = Math.round(fareMinorUnits * 0.85);

  // 5. Move Funds: Escrow -> Driver
  const transfer = await monime('internal-transfers', {
    method: 'POST',
    headers: {
      'Idempotency-Key': `payout-release-${bookingId}`
    },
    body: JSON.stringify({
      amount: {
        currency: 'SLE',
        value: driverEarningsMinor
      },
      sourceFinancialAccount: {
        id: escrowAccountId
      },
      destinationFinancialAccount: {
        id: driverWallet.monime_account_id
      },
      description: `Trip Earnings Payout for Ride ${bookingId.slice(0, 8)}`,
      metadata: { bookingId, driverId, riderId: user.id }
    })
  });

  // 6. Finalize Booking
  await db.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

  return res.status(200).json({ success: true, transfer });
}

export default protectedWallet('read', completeRidePayoutHandler);