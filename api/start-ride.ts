import { protectedWallet } from '../server/wallet-security.js';
import { rideAction } from '../server/ride-payments.js';

export const startRideHandler = (req: any, res: any) => rideAction(req, res, 'start');
export default protectedWallet('read', startRideHandler);