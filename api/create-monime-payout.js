import { protectedWallet } from '../server/wallet-security.js';

import {
  payoutAction,
  reconcileWithdrawals
} from '../server/payout-payments.js';

const customer = protectedWallet('read', payoutAction);

export default async function handler(req, res) {
  if (req.query?.action === 'reconcile') {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
      return res.status(405).json({
        error: 'Method not allowed.'
      });
    }

    return reconcileWithdrawals(req, res);
  }

  return customer(req, res);
}