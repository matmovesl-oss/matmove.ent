
import {referralStatus,reconcileReferrals} from '../server/referral-api.js';
export const config = {maxDuration:60};

import { protectedWallet, dbClient } from '../server/wallet-security.js';
import { liveWallet } from '../server/live-wallet.js';
import { syncMonimeWalletLabels } from '../server/create-wallet.js';
import { activityAnalyticsAction } from '../server/activity-analytics.js';
import { reconcileMatMovePayments } from '../server/payment-reconciliation.js';
import { spinAction, reconcileSpins } from '../server/spin-payments.js';
import { arcadeAction, publicArcadeConfig, reconcileArcades } from '../server/arcade-payments.js';
import { manageReceiveLink, getPublicReceiveLink, handleReceiveUssdExchange } from '../server/receive-money.js';

const spinActions = new Set(['spin_config','spin_enter','spin_status','spin_draw','spin_cancel_entry']);
const arcadeActions = new Set(['arcade_config','arcade_quote','arcade_enter','arcade_cancel','arcade_status','arcade_draw']);
const customer = protectedWallet('read', async (req, res) => {
  const action = req.body.action;
  if (action === 'sync_account_labels') return res.status(200).json(await syncMonimeWalletLabels(req.matmove));
  if (action === 'receive_link_manage') return res.status(200).json(await manageReceiveLink(req.matmove, req.body || {}));
  if (action === 'activity_analytics') return activityAnalyticsAction(req, res);
  if (spinActions.has(action)) return spinAction(req, res);
  if (arcadeActions.has(action)) return arcadeAction(req, res);
  if (action !== undefined && action !== null && action !== '') return res.status(400).json({error:'Unknown wallet action.'});
  const walletData = await liveWallet(req.matmove);
  // Reconcile provider-side financial-account labels during normal wallet refreshes.
  // This repairs older/unlabelled accounts without blocking wallet access or payments.
  const accountLabelSync = await syncMonimeWalletLabels(req.matmove);
  return res.status(200).json({ ...walletData, accountLabelSync });
});
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = req.query?.action;
  if (action === 'receive_ussd_exchange') return handleReceiveUssdExchange(req, res);
  if (action === 'receive_link_public') {
    if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed.'});
    try {
      const link = await getPublicReceiveLink(dbClient(), req.query?.slug);
      if (!link) return res.status(404).json({error:'This MatMove payment link is unavailable.'});
      return res.status(200).json(link);
    } catch (error) {
      return res.status(error.status || 503).json({error:'Payment link lookup is temporarily unavailable.'});
    }
  }
  if (action === 'referral_reconcile') return reconcileReferrals(req, res);
  if (action === undefined && req.body?.action === 'referral_status') return referralStatus(req, res);
  if (action === 'spin_reconcile') return reconcileSpins(req, res);
  if (action === 'arcade_reconcile') return reconcileArcades(req, res);
  if (action === 'payment_reconcile') {
    if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed.'});
    return reconcileMatMovePayments(req, res);
  }
  if (action === 'arcade_public') {
    if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed.'});
    try { return res.status(200).json(await publicArcadeConfig(dbClient())); }
    catch (error) { return res.status(error.status || 503).json({error:'Published demo settings are temporarily unavailable.'}); }
  }
  if (action !== undefined) return res.status(400).json({error:'Unknown wallet route.'});
  return customer(req, res);
}
