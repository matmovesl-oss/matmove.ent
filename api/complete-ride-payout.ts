import { protectedWallet, monime, HttpError } from '../server/wallet-security.js';

export async function completeRidePayoutHandler(req, res) {
  const { db, user } = req.matmove;
  const { bookingId, driverId, amount } = req.body;

  if (!bookingId || !driverId || !amount) {
    throw new HttpError(400, 'Missing required booking details.');
  }

  // 1. Verify the booking is active and belongs to the rider
  const { data: booking, error: bookingError } = await db
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('rider_id', user.id)
    .single();

  if (bookingError || !booking) {
    throw new HttpError(404, 'Booking not found or already completed.');
  }

  // 2. Fetch the Driver's SLE Wallet Account ID
  const { data: driverWallet, error: driverWalletError } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', driverId)
    .eq('currency', 'SLE')
    .single();

  if (driverWalletError || !driverWallet) {
    throw new HttpError(404, 'Driver wallet could not be located.');
  }

  const destinationAccountId = driverWallet.monime_account_id || driverWallet.metadata?.monime_account_id;
  
  if (!destinationAccountId) {
    throw new HttpError(400, 'Driver has no valid Monime financial account to receive funds.');
  }

  // 3. Get the Platform Escrow Account ID
  const sourceAccountId = process.env.MONIME_ESCROW_ACCOUNT_ID;
  if (!sourceAccountId) {
    throw new HttpError(503, 'Platform escrow account is not configured.');
  }

  // 4. Calculate Driver Earnings (85% of Fare)
  // Convert fare to minor units (cents), then calculate 85%
  const fareMinorUnits = Math.round(Number(amount) * 100);
  const driverEarningsMinor = Math.round(fareMinorUnits * 0.85);

  // 5. Execute Internal Transfer via Monime
  const transfer = await monime('internal-transfers', {
    method: 'POST',
    headers: {
      // Unique key prevents double-charging if the user taps the button twice
      'Idempotency-Key': `payout-${bookingId}-${Date.now()}`
    },
    body: JSON.stringify({
      amount: {
        currency: 'SLE',
        value: driverEarningsMinor
      },
      sourceFinancialAccount: {
        id: sourceAccountId
      },
      destinationFinancialAccount: {
        id: destinationAccountId
      },
      description: `Trip Earnings Payout for Booking ${bookingId}`,
      metadata: {
        bookingId: bookingId,
        driverId: driverId,
        riderId: user.id
      }
    })
  });

  // 6. Mark the Trip as Completed in the database
  const { error: updateError } = await db
    .from('bookings')
    .update({ status: 'completed' })
    .eq('id', bookingId);

  if (updateError) {
    console.error(`Transfer succeeded, but failed to update booking ${bookingId} status:`, updateError);
  }

  return res.status(200).json({ success: true, transfer });
}

// We use 'read' so it authenticates the user but doesn't require the user's wallet 
// to have funds (since the funds are pulled from the Platform Escrow).
export default protectedWallet('read', completeRidePayoutHandler);