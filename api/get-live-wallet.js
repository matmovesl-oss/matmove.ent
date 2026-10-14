
import { protectedWallet } from '../server/wallet-security.js';
import { liveWallet } from '../server/live-wallet.js';
import { activityAnalyticsAction } from '../server/activity-analytics.js';
import { spinAction, reconcileSpins } from '../server/spin-payments.js';
const customer = protectedWallet('read', async (req, res) => {
  if (req.body.action === 'activity_analytics') return activityAnalyticsAction(req, res);
  if (['spin_config','spin_enter','spin_status','spin_draw','spin_cancel_entry'].includes(req.body.action)) return spinAction(req, res);
  return res.status(200).json(await liveWallet(req.matmove));
});
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query?.action === 'spin_reconcile') return reconcileSpins(req, res);
  return customer(req, res);
}
