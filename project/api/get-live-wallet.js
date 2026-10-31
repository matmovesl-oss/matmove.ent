
import {referralStatus,reconcileReferrals} from '../server/referral-api.js';
export const config = {maxDuration:60};

import { protectedWallet, dbClient } from '../server/wallet-security.js';
import { liveWallet } from '../server/live-wallet.js';
import { activityAnalyticsAction } from '../server/activity-analytics.js';
import { spinAction, reconcileSpins } from '../server/spin-payments.js';
import { arcadeAction, publicArcadeConfig, reconcileArcades } from '../server/arcade-payments.js';

const spinActions = new Set(['spin_config','spin_enter','spin_status','spin_draw','spin_cancel_entry']);
const arcadeActions = new Set(['arcade_config','arcade_quote','arcade_enter','arcade_cancel','arcade_status','arcade_draw']);
const customer = protectedWallet('read', async (req, res) => {
  const action = req.body.action;
  if (action === 'activity_analytics') return activityAnalyticsAction(req, res);
  if (spinActions.has(action)) return spinAction(req, res);
  if (arcadeActions.has(action)) return arcadeAction(req, res);
  if (action !== undefined && action !== null && action !== '') return res.status(400).json({error:'Unknown wallet action.'});
  return res.status(200).json(await liveWallet(req.matmove));
});
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query?.action;
  if (action === 'referral_reconcile') return reconcileReferrals(req, res);
  if (action === undefined && req.body?.action === 'referral_status') return referralStatus(req, res);
  if (action === 'spin_reconcile') return reconcileSpins(req, res);
  if (action === 'arcade_reconcile') return reconcileArcades(req, res);
  if (action === 'arcade_public') {
    if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed.'});
    try { return res.status(200).json(await publicArcadeConfig(dbClient())); }
    catch (error) { return res.status(error.status || 503).json({error:'Published demo settings are temporarily unavailable.'}); }
  }
  if (action !== undefined) return res.status(400).json({error:'Unknown wallet route.'});
  return customer(req, res);
}
