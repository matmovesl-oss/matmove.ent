import { merchantPaymentAction, reconcileMerchantPayments } from '../server/merchant-payments.js';
import { purchaseTransfer } from '../server/travel-event-payments.js';
import {
  protectedWallet,
  verifiedAccount,
  assertAllowed,
  monime,
  HttpError,
  toMinorUnits,
} from '../server/wallet-security.js';

const TRANSFER_STATES = new Set(['pending', 'processing', 'completed', 'failed']);

export function transferResponseMatches(transfer, { currency, minor, sourceId, destinationId }) {
  return Boolean(
    transfer &&
    typeof transfer.id === 'string' &&
    transfer.id.trim() !== '' &&
    transfer.amount?.currency === currency &&
    Number.isSafeInteger(transfer.amount?.value) &&
    transfer.amount.value === minor &&
    transfer.sourceFinancialAccount?.id === sourceId &&
    transfer.destinationFinancialAccount?.id === destinationId &&
    TRANSFER_STATES.has(String(transfer.status || '').toLowerCase())
  );
}

export async function transferHandler(req, res, {
  provider = monime,
  verifyAccount = verifiedAccount,
  assertRecipientAllowed = assertAllowed,
} = {}) {
  const {
    db,
    user,
    accountId,
    currency,
    minor,
    idempotencyKey,
  } = req.matmove;

  const target = String(req.body.target || '').trim().toLowerCase();

  if (target === 'travel' || target === 'event') {
    return purchaseTransfer(req, res);
  }

  const recipientId = String(req.body.recipientAccountId || '').trim();

  if (!/^fac-[A-Za-z0-9_-]+$/.test(recipientId)) {
    throw new HttpError(400, 'Enter a valid recipient account ID.');
  }

  if (recipientId === accountId) {
    throw new HttpError(400, 'Choose a different recipient account.');
  }

  const match = await db
    .from('wallets')
    .select('*')
    .or(`monime_account_id.eq.${recipientId},metadata->>monime_account_id.eq.${recipientId}`);

  if (match.error) throw new HttpError(503, 'Unable to verify recipient.');
  if (match.data?.length !== 1) {
    throw new HttpError(400, 'Recipient MatMove wallet was not found.');
  }

  const recipient = match.data[0];
  if (recipient.currency !== currency) {
    throw new HttpError(409, 'Transfers must use matching currencies: USD to USD or SLE to SLE.', 'CURRENCY_MISMATCH');
  }

  const [profileResult, walletsResult] = await Promise.all([
    db.from('profiles').select('*').eq('id', recipient.user_id).single(),
    db.from('wallets').select('*').eq('user_id', recipient.user_id),
  ]);

  if (profileResult.error || walletsResult.error) {
    throw new HttpError(503, 'Unable to verify recipient permissions.');
  }

  assertRecipientAllowed(profileResult.data, walletsResult.data || [], 'transfer');
  await verifyAccount(db, recipient);

  const rawResponse = await provider('internal-transfers', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      amount: {
        currency,
        value: minor,
      },
      sourceFinancialAccount: {
        id: accountId,
      },
      destinationFinancialAccount: {
        id: recipientId,
      },
      description: 'MatMove account transfer',
      metadata: {
        userId: user.id,
        recipientUserId: recipient.user_id,
      },
    }),
  });

  const transfer = rawResponse?.result || rawResponse;
  if (!transferResponseMatches(transfer, {
    currency,
    minor,
    sourceId: accountId,
    destinationId: recipientId,
  })) {
    return res.status(502).json({
      success: false,
      status: 'review_required',
      pending: true,
      error: 'The provider response could not be matched to this transfer. Do not submit a new transfer; refresh the transaction history and contact support if it remains unresolved.',
    });
  }

  const status = String(transfer.status).toLowerCase();
  if (status === 'failed') {
    // This is a confirmed terminal provider result. Return JSON 200 so the client
    // can release this idempotency key and allow a new, distinct attempt.
    return res.status(200).json({
      success: false,
      status: 'failed',
      transferId: transfer.id,
      error: transfer.failureDetail?.message || 'The provider confirmed that this transfer failed.',
      data: transfer,
    });
  }

  if (status === 'pending' || status === 'processing') {
    return res.status(202).json({
      success: false,
      pending: true,
      status,
      transferId: transfer.id,
      message: `Transfer is ${status}. It is not completed yet. Do not submit another transfer until its status is confirmed.`,
      data: transfer,
    });
  }

  return res.status(200).json({
    success: true,
    status: 'completed',
    transferId: transfer.id,
    data: transfer,
  });
}


export function transferStatusMatches(transfer, {
  transferId,
  userId,
  recipientUserId,
  currency,
  amountMinor,
  sourceId,
  destinationId,
}) {
  return Boolean(
    transfer &&
    transfer.id === transferId &&
    transfer.metadata?.userId === userId &&
    transfer.metadata?.recipientUserId === recipientUserId &&
    transfer.amount?.currency === currency &&
    Number.isSafeInteger(transfer.amount?.value) &&
    transfer.amount.value === amountMinor &&
    transfer.sourceFinancialAccount?.id === sourceId &&
    transfer.destinationFinancialAccount?.id === destinationId &&
    TRANSFER_STATES.has(String(transfer.status || '').toLowerCase())
  );
}

export async function checkTransferHandler(req, res, {
  provider = monime,
  verifyAccount = verifiedAccount,
} = {}) {
  const { db, user, wallets } = req.matmove;
  const transferId = String(req.body.transferId || '').trim();
  const currency = String(req.body.currency || '').toUpperCase();
  const recipientId = String(req.body.recipientAccountId || '').trim();

  if (!/^[A-Za-z0-9_-]{1,120}$/.test(transferId)) {
    throw new HttpError(400, 'A valid transfer reference is required.');
  }
  if (!['SLE', 'USD'].includes(currency)) {
    throw new HttpError(400, 'Choose SLE or USD.');
  }
  if (!/^fac-[A-Za-z0-9_-]+$/.test(recipientId)) {
    throw new HttpError(400, 'A valid recipient account ID is required.');
  }

  const amountMinor = toMinorUnits(req.body.amount);
  const sourceWallets = (wallets || []).filter(wallet => wallet.currency === currency);
  if (sourceWallets.length !== 1) {
    throw new HttpError(409, 'Your sending wallet could not be uniquely verified.');
  }
  const source = await verifyAccount(db, sourceWallets[0]);

  const recipientResult = await db.from('wallets')
    .select('*')
    .or(`monime_account_id.eq.${recipientId},metadata->>monime_account_id.eq.${recipientId}`);
  if (recipientResult.error) throw new HttpError(503, 'Unable to verify the transfer recipient.');
  if (recipientResult.data?.length !== 1) {
    throw new HttpError(409, 'The transfer recipient could not be uniquely verified.');
  }

  const recipient = recipientResult.data[0];
  if (recipient.currency !== currency) {
    throw new HttpError(409, 'Transfers must use matching currencies: USD to USD or SLE to SLE.', 'CURRENCY_MISMATCH');
  }
  if (recipient.user_id === user.id) {
    throw new HttpError(409, 'Choose a different recipient account.');
  }
  const destination = await verifyAccount(db, recipient);

  const rawResponse = await provider(
    `internal-transfers/${encodeURIComponent(transferId)}`
  );
  const transfer = rawResponse?.result || rawResponse;
  if (!transferStatusMatches(transfer, {
    transferId,
    userId: user.id,
    recipientUserId: recipient.user_id,
    currency,
    amountMinor,
    sourceId: source.id,
    destinationId: destination.id,
  })) {
    throw new HttpError(409, 'This transfer reference does not match your account, recipient, amount and currency.');
  }

  const status = String(transfer.status).toLowerCase();
  if (status === 'failed') {
    return res.status(200).json({
      success: false,
      status: 'failed',
      transferId,
      error: transfer.failureDetail?.message || 'The provider confirmed that this transfer failed.',
    });
  }
  if (status === 'pending' || status === 'processing') {
    return res.status(202).json({
      success: false,
      pending: true,
      status,
      transferId,
      message: `Transfer is ${status}. It is not completed yet.`,
    });
  }
  return res.status(200).json({
    success: true,
    status: 'completed',
    transferId,
  });
}

const transfers = protectedWallet('transfer', transferHandler);
const transferStatus = protectedWallet('read', checkTransferHandler);
const merchantPayments = protectedWallet('read', merchantPaymentAction);

export default function handler(req, res) {
  if (req.query?.action === 'merchant_reconcile') return reconcileMerchantPayments(req, res);
  const action = String(req.body?.action || '');
  if (action === 'status') return transferStatus(req, res);
  return action.startsWith('merchant_')
    ? merchantPayments(req, res)
    : transfers(req, res);
}
