

import {
  protectedWallet,
  monime,
  HttpError
} from '../server/wallet-security.js';

import { topupQuote } from '../server/topup-fees.js';

import {
  publicPaymentCode, topupSettlement, encodeTopupQuote
} from '../server/payment-code.js';

async function sendPaymentCode(res,code,context,provider) {
  const result=publicPaymentCode(code,context);
  let settlement=null;
  if(result.confirmed){try{settlement=await topupSettlement(code,provider);}catch{/* Status remains completed; wallet refresh uses the live provider balance. */}}
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
const quote = protectedWallet('load',quotePaymentCodeHandler);

const create = protectedWallet(
  'load',
  createPaymentCodeHandler
);

const status = protectedWallet(
  'read',
  getPaymentCodeHandler
);

export default async function handler(req, res) {
  if (req.body?.operation === 'quote')return quote(req,res);
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
    error: 'Choose quote, create or status.'
  });
}
