import { HttpError } from './wallet-security.js';

export function publicPaymentCode(code, context) {
  const ownsSettlementWallet = context.wallets.some(
    wallet =>
      wallet.currency === 'SLE' &&
      (
        wallet.monime_account_id ||
        wallet.metadata?.monime_account_id
      ) === code.financialAccountId
  );

  if (
    code.metadata?.matmoveUserId !== context.user.id ||
    code.metadata?.purpose !== 'wallet_topup' ||
    !ownsSettlementWallet
  ) {
    throw new HttpError(
      403,
      'This payment code does not belong to your wallet.'
    );
  }

  if (
    code.mode !== 'one_time' ||
    code.amount?.currency !== 'SLE' ||
    !Number.isSafeInteger(code.amount?.value) ||
    code.amount.value <= 0 ||
    typeof code.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(code.id) ||
    typeof code.ussdCode !== 'string' ||
    !/^\*[0-9*]+#$/.test(code.ussdCode) ||
    !Number.isFinite(Date.parse(code.expireTime)) ||
    ![
      'pending',
      'processing',
      'expired',
      'cancelled',
      'completed'
    ].includes(code.status)
  ) {
    throw new HttpError(
      502,
      'The provider returned an invalid payment code.'
    );
  }

  const paid = code.processedPaymentData;

  const confirmed =
    code.status === 'completed' &&
    !!paid?.paymentId &&
    paid.amount?.currency === 'SLE' &&
    paid.amount.value === code.amount.value;

  return {
    id: code.id,
    ussdCode: code.ussdCode,
    amount: code.amount,
    expireTime: code.expireTime,
    status: code.status,
    confirmed
  };
}