import {
  protectedWallet,
  monime,
  HttpError
} from '../server/wallet-security.js';

export default protectedWallet('payout', async (req, res) => {
  const {
    minor,
    accountId,
    idempotencyKey,
    account
  } = req.matmove;

  const available = account?.balance?.available;

  if (
    available?.currency !== 'SLE' ||
    !Number.isSafeInteger(available.value) ||
    available.value < 0
  ) {
    throw new HttpError(
      503,
      'Your available balance could not be verified. Try again shortly.'
    );
  }

  if (minor > available.value) {
    throw new HttpError(
      400,
      'The withdrawal amount exceeds your available SLE balance.'
    );
  }

  if (
    !['orange', 'afrimoney'].includes(
      req.body.networkProvider
    )
  ) {
    throw new HttpError(
      400,
      'Choose a supported mobile money provider.'
    );
  }

  let phone = String(
    req.body.destinationPhone || ''
  ).replace(/[\s()-]/g, '');

  if (/^0\d{8}$/.test(phone)) {
    phone = `+232${phone.slice(1)}`;
  }

  if (/^232\d{8}$/.test(phone)) {
    phone = `+${phone}`;
  }

  if (!/^\+232\d{8}$/.test(phone)) {
    throw new HttpError(
      400,
      'Enter a valid Sierra Leone mobile money number.'
    );
  }

  const result = await monime('payouts', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      amount: {
        currency: 'SLE',
        value: minor
      },
      source: {
        financialAccountId: accountId
      },
      destination: {
        type: 'momo',
        providerId:
          req.body.networkProvider === 'orange'
            ? 'm17'
            : 'm18',
        phoneNumber: phone
      }
    })
  });

  if (result.status === 'failed') {
    throw new HttpError(
      400,
      'The payout failed. Check your transaction history before starting another payout.'
    );
  }

  return res.status(200).json({
    success: true,
    data: result
  });
});