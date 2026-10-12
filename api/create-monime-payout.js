import { protectedWallet, monime, HttpError } from '../server/wallet-security.js';

export async function completeRidePayoutHandler(req: any, res: any) {
  const { db, user } = req.matmove;
  const { bookingId, driverId, amount } = req.body;

  if (!bookingId || !driverId || !amount) {
    throw new HttpError(400, 'Missing required booking details.');
  }

  // 1. Verify the booking
  const { data: booking } = await db.from('bookings').select('*').eq('id', bookingId).single();
  if (!booking) throw new HttpError(404, 'Booking not found.');
  if (booking.status === 'completed') {
    return res.status(200).json({ success: true, message: 'Already completed' });
  }

  // 2. Fetch Rider/Merchant Wallet
  const { data: riderWallet } = await db.from('wallets').select('*').eq('user_id', user.id).eq('currency', 'SLE').single();
  if (!riderWallet?.monime_account_id) throw new HttpError(404, 'Your financial account could not be found.');

  // 3. Fetch Driver Wallet
  const { data: driverWallet } = await db.from('wallets').select('*').eq('user_id', driverId).eq('currency', 'SLE').single();
  const driverAccountId = driverWallet?.monime_account_id || driverWallet?.metadata?.monime_account_id;
  if (!driverAccountId) throw new HttpError(400, 'Driver has no valid Monime account to receive funds.');

  // 4. Fetch Platform Escrow ID
  const escrowAccountId = process.env.MONIME_ESCROW_ACCOUNT_ID;
  if (!escrowAccountId) throw new HttpError(503, 'Platform escrow account is not configured.');

  // 5. Calculate Split
  const totalMinorUnits = Math.round(Number(amount) * 100);
  const driverMinorUnits = Math.round(totalMinorUnits * 0.85);

  // 6. Transfer 1: Rider -> Platform Escrow (100%)
  await monime('internal-transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': `ride-in-${bookingId}-${Date.now()}` },
    body: JSON.stringify({
      amount: { currency: 'SLE', value: totalMinorUnits },
      sourceFinancialAccount: { id: riderWallet.monime_account_id },
      destinationFinancialAccount: { id: escrowAccountId },
      description: `Ride Payment from Customer for Booking ${bookingId.slice(0, 8)}`,
      metadata: { bookingId, riderId: user.id }
    })
  });

  // 7. Transfer 2: Platform Escrow -> Driver (85%)
  await monime('internal-transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': `ride-out-${bookingId}-${Date.now()}` },
    body: JSON.stringify({
      amount: { currency: 'SLE', value: driverMinorUnits },
      sourceFinancialAccount: { id: escrowAccountId },
      destinationFinancialAccount: { id: driverAccountId },
      description: `Driver Earnings Payout for Booking ${bookingId.slice(0, 8)}`,
      metadata: { bookingId, driverId }
    })
  });

  // 8. Complete the Ride
  await db.from('bookings').update({ status: 'completed' }).eq('id', bookingId);

  return res.status(200).json({ success: true, message: 'Transfers completed successfully.' });
}

export default protectedWallet('read', completeRidePayoutHandler);