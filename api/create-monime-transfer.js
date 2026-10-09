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

  const recipientId = String(
    req.body.recipientAccountId || ''
  ).trim();

  if (
    !/^fac-[A-Za-z0-9_-]+$/.test(recipientId)
  ) {
    throw new HttpError(
      400,
      'Enter a valid recipient account ID.'
    );
  }

  if (recipientId === accountId) {
    throw new HttpError(
      400,
      'Choose a different recipient account.'
    );
  }

  const match = await db
    .from('wallets')
    .select('*')
    .or(
      `monime_account_id.eq.${recipientId},metadata->>monime_account_id.eq.${recipientId}`
    );

  if (match.error) {
    throw new HttpError(
      503,
      'Unable to verify the recipient.'
    );
  }

  if (match.data?.length !== 1) {
    throw new HttpError(
      400,
      'Recipient MatMove wallet was not found or has conflicting account links.'
    );
  }

  const recipient = match.data[0];

  if (recipient.currency !== currency) {
    throw new HttpError(
      409,
      'Transfers must use matching currencies: USD to USD or SLE to SLE.',
      'CURRENCY_MISMATCH'
    );
  }

  const [profileResult, walletsResult] =
    await Promise.all([
      db
        .from('profiles')
        .select('*')
        .eq('id', recipient.user_id)
        .single(),

      db
        .from('wallets')
        .select('*')
        .eq('user_id', recipient.user_id),
    ]);

  if (
    profileResult.error ||
    walletsResult.error
  ) {
    throw new HttpError(
      503,
      'Unable to verify recipient permissions.'
    );
  }

  assertAllowed(
    profileResult.data,
    walletsResult.data || [],
    'transfer'
  );

  await verifiedAccount(db, recipient);

  const result = await monime(
    'internal-transfers',
    {
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
    }
  );

  if (result.status === 'failed') {
    return res.status(400).json({
      error:
        'The transfer failed. Check your transaction history before starting a new payment.',
      data: result,
    });
  }

  return res.status(200).json({
    success: true,
    data: result,
  });
}

export default protectedWallet(
  'transfer',
  transferHandler
);