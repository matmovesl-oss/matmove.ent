


import {
  protectedWallet,
  monime,
  HttpError
} from '../server/wallet-security.js';

import { topupQuote } from '../server/topup-fees.js';
import { reconcileLoadingBonanzaBatch } from '../server/loading-bonanza-payments.js';

import {
  publicPaymentCode, topupSettlement, encodeTopupQuote
} from '../server/payment-code.js';

async function recordVerifiedTopup(context, code, settlement) {
  if (!settlement || !Number.isSafeInteger(settlement.creditMinor) || settlement.creditMinor <= 0) return;
  const wallet = context.wallets.find(item =>
    item.currency === 'SLE' &&
    (item.monime_account_id || item.metadata?.monime_account_id) === code.financialAccountId
  );
  if (!wallet || !context.db || !context.user?.id) {
    throw new HttpError(503, 'Payment completed, but MatMove could not link its verified wallet receipt. Check this same payment status again; do not create another load.');
  }
  const { data, error } = await context.db.rpc('matmove_loading_bonanza_record_topup', {
    p_user: context.user.id,
    p_wallet: wallet.id,
    p_payment_code: code.id,
    p_provider_payment: settlement.paymentId,
    p_gross: code.amount.value,
    p_fee: settlement.feeMinor,
    p_credit: settlement.creditMinor,
    p_destination: code.financialAccountId
  });
  if (error || data?.user_id !== context.user.id || data?.wallet_id !== wallet.id ||
      data?.payment_code_id !== code.id || data?.provider_payment_id !== settlement.paymentId ||
      Number(data?.credit_minor) !== settlement.creditMinor || data?.state !== 'completed') {
    throw new HttpError(503, 'Payment completed, but MatMove is still recording its verified top-up receipt. Check this same payment status again; do not create another load.');
  }
  // Kick the cashback queue immediately after its verified top-up record is committed.
  // A queue/treasury issue never reverses or misreports the customer's completed top-up.
  try {
    const outcome = await reconcileLoadingBonanzaBatch(context.db, { limit: 1 });
    if (outcome.failed > 0) console.error('Loading Bonanza immediate settlement needs review.');
  } catch {
    console.error('Loading Bonanza immediate settlement deferred to scheduled reconciliation.');
  }
}

async function queueCompletedCode(context, code) {
  const wallet = context.wallets.find(item =>
    item.currency === 'SLE' &&
    (item.monime_account_id || item.metadata?.monime_account_id) === code.financialAccountId
  );
  if (!wallet || !context.db || !context.user?.id) {
    throw new HttpError(503, 'Payment completed, but MatMove could not queue its verified Payment Code for settlement. Check this same payment status again; do not create another load.');
  }
  const { data, error } = await context.db.rpc('matmove_loading_bonanza_queue_completed_code', {
    p_user: context.user.id, p_wallet: wallet.id, p_payment_code: code.id,
    p_gross: code.amount.value, p_destination: code.financialAccountId,
    p_reference: typeof code.reference === 'string' && code.reference.length > 0 ? code.reference : null
  });
  if (error || data?.user_id !== context.user.id || data?.wallet_id !== wallet.id ||
      data?.payment_code_id !== code.id || Number(data?.gross_minor) !== code.amount.value ||
      !['pending','recorded','review_required'].includes(data?.state)) {
    throw new HttpError(503, 'Payment completed, but MatMove could not safely queue its verified Payment Code. Check this same payment status again; do not create another load.');
  }
}

async function sendPaymentCode(res,code,context,provider) {
  const result=publicPaymentCode(code,context);
  let settlement=null;
  if(result.confirmed){
    try { settlement=await topupSettlement(code,provider); } catch { /* Keep the exact completed code queued for later provider settlement. */ }
    if (settlement) await recordVerifiedTopup(context, code, settlement);
    else await queueCompletedCode(context, code);
    // Records the exact provider payment when available, then starts the cashback
    // worker. A delayed Monime payment-list entry remains durably queued for retry.
    try {
      const outcome = await reconcileLoadingBonanzaBatch(context.db, { limit: 1 });
      if (outcome.failed > 0) console.error('Loading Bonanza settlement needs reconciliation.');
    } catch {
      console.error('Loading Bonanza settlement deferred to scheduled reconciliation.');
    }
  }
  return res.status(200).json({paymentCode:{...result,settlement}});
}

export async function createPaymentCodeHandler(req, res, {provider=monime}={}) {
  const context = req.matmove;

  const {
    user,
    accountId,
    minor,
    idempotencyKey
  } = context;

  const quote=topupQuote(minor);
  if(quote.netMode && (req.body.acceptedTotalMinor!==quote.totalMinor||req.body.quoteVersion!==quote.version))throw new HttpError(409,'Review the current top-up amount and processing fee before paying.');
  const code = await provider('payment-codes', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey.slice(0, 64)
    },
    body: JSON.stringify({
      name: 'MatMove Wallet Top-up',
      mode: 'one_time',
      enable: true,
      amount: {
        currency: 'SLE',
        value: quote.totalMinor
      },
      duration: '10m',
      financialAccountId: accountId,
      authorizedProviders: ['m17', 'm18'],
      reference: idempotencyKey.slice(0, 64),
      metadata: {
        matmoveUserId: user.id,
        purpose: 'wallet_topup',
        ...(quote.netMode?{matmoveTopupQuote:encodeTopupQuote(quote)}:{})
      }
    })
  });

  if (
    code.financialAccountId !== accountId ||
    code.amount?.value !== quote.totalMinor
  ) {
    throw new HttpError(
      502,
      'The payment code does not match your top-up request.'
    );
  }

  return sendPaymentCode(res,code,context,provider);
}

export async function getPaymentCodeHandler(req, res, {provider=monime}={}) {
  const id = req.body.paymentCodeId;

  if (
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(id)
  ) {
    throw new HttpError(
      400,
      'A valid payment code ID is required.'
    );
  }

  const code = await provider(
    `payment-codes/${encodeURIComponent(id)}`
  );

  if (code.id !== id) {
    throw new HttpError(
      502,
      'Payment status could not be verified.'
    );
  }

  return sendPaymentCode(res,code,req.matmove,provider);
}

export async function quotePaymentCodeHandler(req,res) {return res.status(200).json({quote:topupQuote(req.matmove.minor)});}

// Close retires an unused code at Monime; it never deletes payment receipts or
// changes a wallet balance. A processing payment must still be reconciled.
export async function closePaymentCodeHandler(req, res, {provider=monime}={}) {
  const id=req.body.paymentCodeId;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new HttpError(400,'A valid payment code ID is required.');
  const path=`payment-codes/${encodeURIComponent(id)}`;
  const original=await provider(path);
  const checked=publicPaymentCode(original,req.matmove);
  if(original.id!==id)throw new HttpError(502,'Payment status could not be verified.');
  if(checked.closed || original.status==='processing')return sendPaymentCode(res,original,req.matmove,provider);
  let updated;
  try {
    updated=await provider(path,{method:'PATCH',body:JSON.stringify({enable:false})});
  } catch {
    // A lost PATCH response is resolved by reading, never by creating a code.
    updated=await provider(path);
  }
  const result=publicPaymentCode(updated,req.matmove);
  if(updated.id!==id || updated.amount.value!==original.amount.value || updated.financialAccountId!==original.financialAccountId)throw new HttpError(502,'The closure receipt does not match the original load.');
  if(!result.closed && updated.status!=='processing')throw new HttpError(409,'Closing this code was not confirmed. Check its status before starting another load.');
  return sendPaymentCode(res,updated,req.matmove,provider);
}
const quote = protectedWallet('load',quotePaymentCodeHandler);

const create = protectedWallet(
  'load',
  createPaymentCodeHandler
);

const status = protectedWallet(
  'read',
  getPaymentCodeHandler
);
const close = protectedWallet('read',closePaymentCodeHandler);

export default async function handler(req, res) {
  if (req.body?.operation === 'quote')return quote(req,res);
  if (req.body?.operation === 'close')return close(req,res);
  if (req.body?.operation === 'status') {
    return status(req, res);
  }

  if (
    !req.body?.operation ||
    req.body.operation === 'create'
  ) {
    return create(req, res);
  }

  res.setHeader('Cache-Control', 'no-store');

  return res.status(400).json({
    error: 'Choose quote, create, status or close.'
  });
}
