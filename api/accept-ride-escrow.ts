import { protectedWallet, monime, HttpError } from '../server/wallet-security.js';

export async function acceptRideEscrowHandler(req: any, res: any) {
  const { db } = req.matmove;
  const { bookingId, riderId, driverId, amount } = req.body;

  if (!bookingId || !riderId || !driverId || !amount) {
    throw new HttpError(400, 'Missing required booking details.');
  }

  // 1. Get the Rider's Wallet ID
  const { data: riderWallet, error: riderError } = await db
    .from('wallets')
    .select('monime_account_id')
    .eq('user_id', riderId)
    .eq('currency', 'SLE')
    .single();

  if (riderError || !riderWallet?.monime_account_id) {
    throw new HttpError(404, 'Rider financial account could not be found.');
  }

  // 2. Get the Platform Escrow ID
  const escrowAccountId = process.env.MONIME_ESCROW_ACCOUNT_ID;
  if (!escrowAccountId) {
    throw new HttpError(503, 'Platform escrow account is not configured.');
  }

  // 3. Move Funds: Rider -> Escrow
  const fareMinorUnits = Math.round(Number(amount) * 100);

  const transfer = await monime('internal-transfers', {
    method: 'POST',
    headers: {
      'Idempotency-Key': `escrow-hold-${bookingId}`
    },
    body: JSON.stringify({
      amount: {
        currency: 'SLE',
        value: fareMinorUnits
      },
      sourceFinancialAccount: {
        id: riderWallet.monime_account_id
      },
      destinationFinancialAccount: {
        id: escrowAccountId
      },
      description: `Escrow Hold for Ride ${bookingId.slice(0, 8)}`,
      metadata: { bookingId, riderId, driverId }
    })
  });

  // 4. Update Booking Status to Accepted
  await db.from('bookings').update({ 
    status: 'accepted', 
    driver_id: driverId 
  }).eq('id', bookingId);

  return res.status(200).json({ success: true, transfer });
}

export default protectedWallet('read', acceptRideEscrowHandler);