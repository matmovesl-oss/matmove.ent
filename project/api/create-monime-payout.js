import {protectedWallet} from '../server/wallet-security.js';
import {
  payoutAction,
  reconcileWithdrawals
} from '../server/payout-payments.js';
import {reconcileMonimeWebhookEvents} from '../server/monime-webhook-worker.js';

const customer=protectedWallet('read',payoutAction);

export default async function handler(req,res){
  if(req.query?.action==='reconcile'){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
    return reconcileWithdrawals(req,res);
  }

  // Reuse this existing API file to preserve the current Vercel API route count.
  if(req.query?.action==='monime_webhooks'){
    return reconcileMonimeWebhookEvents(req,res);
  }

  return customer(req,res);
}
