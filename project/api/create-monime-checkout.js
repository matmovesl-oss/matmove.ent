import {
  protectedWallet,
  monime,
  HttpError,
} from '../server/wallet-security.js';

export default protectedWallet(
  'load',
  async (req, res) => {
    const {
      user,
      profile,
      accountId,
      minor,
      idempotencyKey,
    } = req.matmove;

    let origin;

    try {
      const url = new URL(
        process.env.MATMOVE_PUBLIC_URL
      );

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password
      ) {
        throw new Error();
      }

      origin = url.origin;
    } catch {
      throw new HttpError(
        503,
        'The checkout return URL is not configured.'
      );
    }

    const callback =
      `${origin}/api/monime-return?role=${
        encodeURIComponent(profile.role)
      }`;

    const session = await monime(
      'checkout-sessions',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          name: 'MatMove Wallet Top-up',
          financialAccountId: accountId,

          successUrl:
            `${callback}&status=success`,

          cancelUrl:
            `${callback}&status=cancelled`,

          lineItems: [
            {
              type: 'custom',
              name: 'Wallet Load',
              price: {
                currency: 'SLE',
                value: minor,
              },
              quantity: 1,
            },
          ],

          metadata: {
            userId: user.id,
            role: profile.role,
          },
        }),
      }
    );

    const link =
      session.redirectUrl ||
      session.url;

    try {
      if (
        new URL(link).protocol !== 'https:'
      ) {
        throw new Error();
      }
    } catch {
      throw new HttpError(
        502,
        'The payment provider did not return a safe checkout URL.'
      );
    }

    return res.status(200).json({ link });
  }
);