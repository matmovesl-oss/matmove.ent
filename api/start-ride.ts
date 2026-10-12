import { protectedWallet, HttpError } from '../server/wallet-security.js';

export async function startRideHandler(req: any, res: any) {
  const { db } = req.matmove;
  const { bookingId } = req.body;

  if (!bookingId) {
    throw new HttpError(400, 'Missing required booking ID.');
  }

  // Update the booking status to 'in_progress' so the Rider can pay
  const { error } = await db
    .from('bookings')
    .update({ status: 'in_progress' })
    .eq('id', bookingId);

  if (error) {
    throw new HttpError(500, 'Failed to start the ride.');
  }

  return res.status(200).json({ success: true, message: 'Ride started successfully.' });
}

export default protectedWallet('read', startRideHandler);