import {
  protectedWallet,
  monime,
  HttpError,
} from '../server/wallet-security.js';
import { createReceiveCheckout, receiveCheckoutReturn } from '../server/receive-money.js';

const createWalletTopup = protectedWallet(
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query?.action === 'receive_checkout_return') return receiveCheckoutReturn(req, res);
  if (req.query?.action === 'receive_checkout') {
    try {
      return await createReceiveCheckout(req, res);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 503;
      if (status >= 500) console.error('MatMove receive checkout failed', { reason: error?.message || 'checkout_error' });
      return res.status(status).json({
        error: status >= 500 && !error?.status
          ? 'MatMove could not start this payment. Check the same payment request before retrying.'
          : String(error?.message || 'Payment could not be started.')
      });
    }
  }
  return createWalletTopup(req, res);
}
