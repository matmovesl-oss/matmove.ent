import {
  protectedWallet,
  monime,
  HttpError
} from '../server/wallet-security.js';
import {
  publicPaymentCode
} from '../server/payment-code.js';

export async function createPaymentCodeHandler(req, res) {
  const context = req.matmove;

  const {
    user,
    accountId,
    minor,
    idempotencyKey
  } = context;

  const code = await monime('payment-codes', {
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
        value: minor
      },
      duration: '10m',
      financialAccountId: accountId,
      authorizedProviders: ['m17', 'm18'],
      reference: idempotencyKey.slice(0, 64),
      metadata: {
        matmoveUserId: user.id,
        purpose: 'wallet_topup'
      }
    })
  });

  if (
    code.financialAccountId !== accountId ||
    code.amount?.value !== minor
  ) {
    throw new HttpError(
      502,
      'The payment code does not match your top-up request.'
    );
  }

  return res.status(200).json({
    paymentCode: publicPaymentCode(code, context)
  });
}

export async function getPaymentCodeHandler(req, res) {
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

  const code = await monime(
    `payment-codes/${encodeURIComponent(id)}`
  );

  if (code.id !== id) {
    throw new HttpError(
      502,
      'Payment status could not be verified.'
    );
  }

  return res.status(200).json({
    paymentCode: publicPaymentCode(code, req.matmove)
  });
}

const create = protectedWallet(
  'load',
  createPaymentCodeHandler
);

const status = protectedWallet(
  'read',
  getPaymentCodeHandler
);

export default async function handler(req, res) {
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
    error: 'Choose create or status.'
  });
}