import { protectedWallet } from '../server/wallet-security.js';
import { rideAction } from '../server/ride-payments.js';

export const completeRidePayoutHandler = (req: any, res: any) =>
  rideAction(req, res, 'complete');

export default protectedWallet('read', completeRidePayoutHandler);