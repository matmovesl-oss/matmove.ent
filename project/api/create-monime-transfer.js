import { merchantPaymentAction, reconcileMerchantPayments } from '../server/merchant-payments.js';
import {
  protectedWallet,
  verifiedAccount,
  assertAllowed,
  monime,
  HttpError,
} from '../server/wallet-security.js';

export async function transferHandler(req, res) {
  const {
    db,
    user,
    accountId,
    currency,
    minor,
    idempotencyKey,
  } = req.matmove;

  const target = String(req.body.target || '').trim().toLowerCase();
  const travelAccountId = process.env.MONIME_TRAVEL_ACCOUNT_ID || process.env.VITE_MONIME_TRAVEL_ACCOUNT_ID;
  const eventAccountId = process.env.MONIME_EVENT_ACCOUNT_ID || process.env.VITE_MONIME_EVENT_ACCOUNT_ID;

  let recipientId = String(req.body.recipientAccountId || '').trim();
  let isPlatformTarget = false;
  let targetDescription = 'MatMove account transfer';

  if (target === 'travel' || (travelAccountId && recipientId === travelAccountId)) {
    if (!travelAccountId) throw new HttpError(503, 'Travel bus account is not configured.');
    recipientId = travelAccountId;
    isPlatformTarget = true;
    targetDescription = req.body.description || 'MatMove Travel Booking: Freetown - Accra Direct';
  } else if (target === 'event' || (eventAccountId && recipientId === eventAccountId)) {
    if (!eventAccountId) throw new HttpError(503, 'Event account is not configured.');
    recipientId = eventAccountId;
    isPlatformTarget = true;
    targetDescription = req.body.description || 'MatMove Event Ticket Purchase';
  }

  if (!/^fac-[A-Za-z0-9_-]+$/.test(recipientId)) {
    throw new HttpError(400, 'Enter a valid recipient account ID.');
  }

  if (recipientId === accountId) {
    throw new HttpError(400, 'Choose a different recipient account.');
  }

  // Handle direct platform payments
  if (isPlatformTarget) {
    const result = await monime('internal-transfers', {
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
        description: targetDescription,
        metadata: {
          userId: user.id,
          target,
        },
      }),
    });

    if (result.status === 'failed') {
      return res.status(400).json({
        error: 'The payment failed. Check your wallet balance before trying again.',
        data: result,
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  }

  // Standard Peer-to-Peer Wallet Transfer
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

  assertAllowed(profileResult.data, walletsResult.data || [], 'transfer');
  await verifiedAccount(db, recipient);

  const result = await monime('internal-transfers', {
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

  if (result.status === 'failed') {
    return res.status(400).json({
      error: 'The transfer failed.',
      data: result,
    });
  }

  return res.status(200).json({
    success: true,
    data: result,
  });
}

const transfers = protectedWallet('transfer', transferHandler);
const merchantPayments = protectedWallet('read', merchantPaymentAction);
export default function handler(req, res) {
  if (req.query?.action === 'merchant_reconcile') return reconcileMerchantPayments(req, res);
  return String(req.body?.action || '').startsWith('merchant_')
    ? merchantPayments(req, res)
    : transfers(req, res);
}