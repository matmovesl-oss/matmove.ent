import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const MONIME_API_URL =
  'https://api.monime.io/v1/checkout-sessions';

const MONIME_API_VERSION =
  'caph.2025-08-23';

const ALLOWED_ROLES = new Set([
  'rider',
  'driver',
  'merchant',
  'vendor',
]);

const ALLOWED_CURRENCIES = new Set([
  'SLE',
  'USD',
]);

function getBearerToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    '';

  if (
    typeof authorization !== 'string' ||
    !authorization.startsWith(
      'Bearer '
    )
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  return token || null;
}

function getAppUrl(req) {
  const configuredUrl =
    process.env.APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    '';

  if (configuredUrl) {
    return configuredUrl.startsWith(
      'http://'
    ) ||
      configuredUrl.startsWith(
        'https://'
      )
      ? configuredUrl.replace(
          /\/$/,
          ''
        )
      : `https://${configuredUrl.replace(
          /\/$/,
          ''
        )}`;
  }

  const forwardedHost =
    req.headers[
      'x-forwarded-host'
    ];

  const host =
    forwardedHost ||
    req.headers.host;

  const forwardedProto =
    req.headers[
      'x-forwarded-proto'
    ];

  const protocol =
    forwardedProto ||
    (host?.includes('localhost')
      ? 'http'
      : 'https');

  if (host) {
    return `${protocol}://${host}`;
  }

  return null;
}

function normalizeRole(role) {
  const value = String(
    role || ''
  )
    .trim()
    .toLowerCase();

  if (value === 'vendor') {
    return 'merchant';
  }

  return value;
}

function parseAmount(value) {
  const amount =
    typeof value === 'number'
      ? value
      : Number(
          String(
            value ?? ''
          ).trim()
        );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  /*
   * MatMove wallet balances use major
   * currency units.
   */
  const rounded =
    Math.round(
      (amount +
        Number.EPSILON) *
        100
    ) / 100;

  if (
    !Number.isFinite(rounded) ||
    rounded <= 0
  ) {
    return null;
  }

  return rounded;
}

function toMinorUnits(
  amount
) {
  return Math.round(
    (amount +
      Number.EPSILON) *
      100
  );
}

function extractSupabaseError(
  error
) {
  if (!error) {
    return 'Unknown Supabase error.';
  }

  return (
    error.message ||
    error.details ||
    error.hint ||
    'Supabase request failed.'
  );
}

async function readJsonResponse(
  response
) {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text,
    };
  }
}

function getCheckoutData(
  response
) {
  if (
    response &&
    typeof response ===
      'object'
  ) {
    if (
      response.result &&
      typeof response.result ===
        'object'
    ) {
      return response.result;
    }

    if (
      response.data &&
      typeof response.data ===
        'object'
    ) {
      return response.data;
    }
  }

  return response || {};
}

export default async function handler(
  req,
  res
) {
  if (req.method !== 'POST') {
    res.setHeader(
      'Allow',
      'POST'
    );

    return res.status(405).json({
      error:
        'Method not allowed',
    });
  }

  let paymentTransactionId =
    null;

  let providerRequestStarted =
    false;

  try {
    /*
     * =========================================================
     * 1. Server configuration
     * =========================================================
     */

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    const monimeApiKey =
      process.env.MONIME_API_KEY;

    const monimeSpaceId =
      process.env.MONIME_SPACE_ID;

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !monimeApiKey ||
      !monimeSpaceId
    ) {
      console.error(
        'Missing required payment environment variables.'
      );

      return res.status(500).json({
        error:
          'Payment service is not configured.',
      });
    }

    /*
     * =========================================================
     * 2. Authenticate customer
     * =========================================================
     */

    const accessToken =
      getBearerToken(req);

    if (!accessToken) {
      return res.status(401).json({
        error:
          'Authentication required.',
      });
    }

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken:
              false,
            persistSession:
              false,
          },
        }
      );

    const {
      data: authData,
      error: authError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      authError ||
      !authData?.user
    ) {
      return res.status(401).json({
        error:
          'Invalid or expired session.',
      });
    }

    const userId =
      authData.user.id;

    /*
     * =========================================================
     * 3. Validate request
     * =========================================================
     */

    const body =
      req.body &&
      typeof req.body ===
        'object'
        ? req.body
        : {};

    const amount =
      parseAmount(
        body.amount
      );

    const currency =
      String(
        body.currency ||
          'SLE'
      )
        .trim()
        .toUpperCase();

    const requestedIdempotencyKey =
      String(
        body.idempotencyKey ||
          body.idempotency_key ||
          ''
      ).trim();

    if (!amount) {
      return res.status(400).json({
        error:
          'A valid top-up amount is required.',
      });
    }

    if (
      !ALLOWED_CURRENCIES.has(
        currency
      )
    ) {
      return res.status(400).json({
        error:
          'Only SLE and USD wallets are supported.',
      });
    }

    /*
     * Never trust a client-generated key
     * beyond the provider's length limit.
     */
    const idempotencyKey =
      requestedIdempotencyKey
        ? requestedIdempotencyKey.slice(
            0,
            64
          )
        : randomUUID();

    /*
     * =========================================================
     * 4. Authoritative customer profile
     * =========================================================
     */

    const {
      data: profile,
      error: profileError,
    } =
      await supabaseAdmin
        .from('profiles')
        .select(
          'id,first_name,last_name,phone,role,kyc_status'
        )
        .eq(
          'id',
          userId
        )
        .maybeSingle();

    if (profileError) {
      console.error(
        'Profile lookup failed:',
        profileError
      );

      return res.status(500).json({
        error:
          'Unable to verify customer profile.',
      });
    }

    if (!profile) {
      return res.status(404).json({
        error:
          'Customer profile not found.',
      });
    }

    const role =
      normalizeRole(
        profile.role
      );

    if (
      !ALLOWED_ROLES.has(role)
    ) {
      return res.status(403).json({
        error:
          'This account is not permitted to use a MatMove customer wallet.',
      });
    }

    /*
     * =========================================================
     * 5. Customer wallet
     * =========================================================
     */

    const {
      data: wallet,
      error: walletError,
    } =
      await supabaseAdmin
        .from('wallets')
        .select(
          'id,user_id,currency,balance,reserved_balance,is_frozen'
        )
        .eq(
          'user_id',
          userId
        )
        .eq(
          'currency',
          currency
        )
        .maybeSingle();

    if (walletError) {
      console.error(
        'Wallet lookup failed:',
        walletError
      );

      return res.status(500).json({
        error:
          'Unable to load customer wallet.',
      });
    }

    if (!wallet) {
      return res.status(404).json({
        error:
          `Your ${currency} wallet could not be found.`,
      });
    }

    if (
      wallet.is_frozen
    ) {
      return res.status(403).json({
        error:
          'This wallet is currently frozen.',
      });
    }

    /*
     * =========================================================
     * 6. Idempotency
     * =========================================================
     */

    const {
      data: existingPayment,
      error:
        existingPaymentError,
    } =
      await supabaseAdmin
        .from('payment_transactions')
        .select(
          'id,user_id,wallet_id,transaction_type,provider,provider_reference,idempotency_key,amount,currency,status,metadata,created_at'
        )
        .eq(
          'idempotency_key',
          idempotencyKey
        )
        .maybeSingle();

    if (
      existingPaymentError
    ) {
      console.error(
        'Existing payment lookup failed:',
        existingPaymentError
      );

      return res.status(500).json({
        error:
          'Unable to verify payment request.',
      });
    }

    if (existingPayment) {
      if (
        existingPayment.user_id !==
        userId
      ) {
        return res.status(409).json({
          error:
            'This payment request belongs to another account.',
        });
      }

      if (
        existingPayment.wallet_id !==
        wallet.id
      ) {
        return res.status(409).json({
          error:
            'This payment request does not match the selected wallet.',
        });
      }

      if (
        Number(
          existingPayment.amount
        ) !== amount ||
        existingPayment.currency !==
          currency
      ) {
        return res.status(409).json({
          error:
            'This idempotency key was already used for a different payment.',
        });
      }

      const existingMetadata =
        existingPayment.metadata &&
        typeof existingPayment.metadata ===
          'object'
          ? existingPayment.metadata
          : {};

      const storedRedirectUrl =
        existingMetadata.redirect_url;

      const storedCheckoutId =
        existingPayment.provider_reference ||
        existingMetadata.checkout_session_id;

      if (
        existingPayment.provider ===
          'monime' &&
        storedCheckoutId &&
        typeof storedRedirectUrl ===
          'string' &&
        storedRedirectUrl
      ) {
        return res.status(200).json({
          status:
            existingPayment.status ||
            'pending',
          paymentTransactionId:
            existingPayment.id,
          checkoutSessionId:
            storedCheckoutId,
          redirectUrl:
            storedRedirectUrl,
          currency,
          amount,
          idempotent:
            true,
        });
      }

      if (
        existingPayment.status ===
        'completed'
      ) {
        return res.status(409).json({
          error:
            'This payment request has already been completed.',
          paymentTransactionId:
            existingPayment.id,
        });
      }

      if (
        existingPayment.status ===
          'pending' &&
        !storedCheckoutId
      ) {
        /*
         * A pending transaction without a
         * provider reference is an unresolved
         * server-side state. Do not create a
         * second provider checkout using the
         * same idempotency key.
         */
        return res.status(409).json({
          error:
            'This payment request is already being processed. Please wait before retrying.',
          paymentTransactionId:
            existingPayment.id,
        });
      }
    }

    /*
     * =========================================================
     * 7. Create MatMove pending payment
     * =========================================================
     */

    const metadata = {
      provider:
        'monime',
      payment_method:
        'checkout',
      purpose:
        'wallet_topup',
      matmove_user_id:
        userId,
      wallet_id:
        wallet.id,
      currency,
      amount,
      idempotency_key:
        idempotencyKey,
      status:
        'pending',
    };

    const {
      data:
        paymentTransaction,
      error:
        paymentInsertError,
    } =
      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .insert({
          user_id:
            userId,
          wallet_id:
            wallet.id,
          transaction_type:
            'wallet_topup',
          provider:
            'monime',
          idempotency_key:
            idempotencyKey,
          amount,
          currency,
          status:
            'pending',
          customer_phone:
            profile.phone ||
            null,
          metadata,
        })
        .select(
          'id,user_id,wallet_id,transaction_type,provider,idempotency_key,amount,currency,status,metadata'
        )
        .single();

    if (
      paymentInsertError
    ) {
      /*
       * A duplicate-key race on the database
       * should be resolved by re-reading the
       * authoritative payment transaction.
       */
      if (
        paymentInsertError.code ===
        '23505'
      ) {
        const {
          data:
            concurrentPayment,
        } =
          await supabaseAdmin
            .from(
              'payment_transactions'
            )
            .select(
              'id,wallet_id,provider_reference,status,amount,currency,metadata'
            )
            .eq(
              'idempotency_key',
              idempotencyKey
            )
            .maybeSingle();

        if (
          concurrentPayment &&
          concurrentPayment.wallet_id ===
            wallet.id &&
          Number(
            concurrentPayment.amount
          ) === amount &&
          concurrentPayment.currency ===
            currency
        ) {
          const concurrentMetadata =
            concurrentPayment.metadata &&
            typeof concurrentPayment.metadata ===
              'object'
              ? concurrentPayment.metadata
              : {};

          if (
            concurrentPayment.provider_reference &&
            typeof concurrentMetadata.redirect_url ===
              'string'
          ) {
            return res.status(200).json({
              status:
                concurrentPayment.status ||
                'pending',
              paymentTransactionId:
                concurrentPayment.id,
              checkoutSessionId:
                concurrentPayment.provider_reference,
              redirectUrl:
                concurrentMetadata.redirect_url,
              currency,
              amount,
              idempotent:
                true,
            });
          }

          return res.status(409).json({
            error:
              'This payment request is already being processed.',
            paymentTransactionId:
              concurrentPayment.id,
          });
        }
      }

      console.error(
        'Payment transaction creation failed:',
        paymentInsertError
      );

      return res.status(500).json({
        error:
          'Unable to create the payment transaction.',
        details:
          extractSupabaseError(
            paymentInsertError
          ),
      });
    }

    paymentTransactionId =
      paymentTransaction.id;

    /*
     * =========================================================
     * 8. Build checkout URLs
     * =========================================================
     */

    const appUrl =
      getAppUrl(req);

    if (!appUrl) {
      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          status:
            'failed',
          failure_code:
            'missing_app_url',
          failure_message:
            'MatMove application URL is not configured.',
          failed_at:
            new Date().toISOString(),
          metadata: {
            ...metadata,
            status:
              'failed',
          },
        })
        .eq(
          'id',
          paymentTransactionId
        );

      return res.status(500).json({
        error:
          'Payment return URL is not configured.',
      });
    }

    const checkoutReference =
      `MM-TOPUP-${paymentTransactionId}`;

    const successUrl =
      `${appUrl}/wallet?payment=success&provider=monime&paymentId=${encodeURIComponent(
        paymentTransactionId
      )}`;

    const cancelUrl =
      `${appUrl}/wallet?payment=cancelled&provider=monime&paymentId=${encodeURIComponent(
        paymentTransactionId
      )}`;

    /*
     * =========================================================
     * 9. Monime checkout request
     * =========================================================
     *
     * Wallet credit is NOT performed here.
     *
     * The provider webhook must subsequently
     * identify this payment and call the secure
     * MatMove settlement RPC.
     *
     * The checkout payload structure follows the
     * current MatMove/Monime integration contract
     * already established for this project.
     */

    const checkoutPayload = {
      name:
        `MatMove ${currency} Wallet Top-up`,
      reference:
        checkoutReference,
      description:
        `Top up MatMove ${currency} wallet`,
      lineItems: [
        {
          name:
            `MatMove ${currency} Wallet`,
          type:
            'custom',
          price: {
            currency,
            value:
              toMinorUnits(
                amount
              ),
          },
          quantity:
            1,
          reference:
            paymentTransactionId,
          description:
            `Wallet top-up of ${amount.toFixed(
              2
            )} ${currency}`,
        },
      ],
      successUrl,
      cancelUrl,
      callbackState:
        paymentTransactionId,
      metadata: {
        matmove_user_id:
          userId,
        wallet_id:
          wallet.id,
        payment_transaction_id:
          paymentTransactionId,
        idempotency_key:
          idempotencyKey,
        currency,
        amount:
          String(amount),
        purpose:
          'wallet_topup',
      },
    };

    providerRequestStarted =
      true;

    const monimeResponse =
      await fetch(
        MONIME_API_URL,
        {
          method:
            'POST',
          headers: {
            Authorization:
              `Bearer ${monimeApiKey}`,
            'Content-Type':
              'application/json',
            'Idempotency-Key':
              idempotencyKey,
            'Monime-Space-Id':
              monimeSpaceId,
            'Monime-Version':
              MONIME_API_VERSION,
          },
          body:
            JSON.stringify(
              checkoutPayload
            ),
        }
      );

    const monimeData =
      await readJsonResponse(
        monimeResponse
      );

    if (
      !monimeResponse.ok
    ) {
      console.error(
        'Monime checkout creation failed:',
        {
          status:
            monimeResponse.status,
          response:
            monimeData,
          paymentTransactionId,
        }
      );

      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          status:
            'failed',
          failure_code:
            `monime_http_${monimeResponse.status}`,
          failure_message:
            typeof monimeData?.message ===
            'string'
              ? monimeData.message
              : 'Monime checkout creation failed.',
          provider_response:
            monimeData,
          failed_at:
            new Date().toISOString(),
          metadata: {
            ...metadata,
            status:
              'failed',
            provider_response:
              monimeData,
          },
        })
        .eq(
          'id',
          paymentTransactionId
        );

      return res.status(502).json({
        error:
          typeof monimeData?.message ===
          'string'
            ? monimeData.message
            : 'Unable to create Monime checkout.',
        paymentTransactionId,
      });
    }

    /*
     * =========================================================
     * 10. Extract checkout response
     * =========================================================
     */

    const checkout =
      getCheckoutData(
        monimeData
      );

    const redirectUrl =
      checkout?.redirectUrl ||
      checkout?.redirect_url ||
      checkout?.url;

    const checkoutSessionId =
      checkout?.id ||
      checkout?.sessionId ||
      checkout?.session_id;

    if (
      typeof redirectUrl !==
        'string' ||
      !redirectUrl ||
      typeof checkoutSessionId !==
        'string' ||
      !checkoutSessionId
    ) {
      console.error(
        'Monime returned an unexpected checkout response:',
        monimeData
      );

      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          status:
            'failed',
          failure_code:
            'invalid_monime_response',
          failure_message:
            'Monime did not return a valid checkout session.',
          provider_response:
            monimeData,
          failed_at:
            new Date().toISOString(),
          metadata: {
            ...metadata,
            status:
              'failed',
          },
        })
        .eq(
          'id',
          paymentTransactionId
        );

      return res.status(502).json({
        error:
          'Monime returned an invalid checkout response.',
        paymentTransactionId,
      });
    }

    /*
     * =========================================================
     * 11. Store provider state
     * =========================================================
     */

    const finalMetadata = {
      ...metadata,
      status:
        'pending',
      checkout_session_id:
        checkoutSessionId,
      redirect_url:
        redirectUrl,
      checkout_reference:
        checkoutReference,
      provider_response:
        monimeData,
    };

    const {
      error:
        updatePaymentError,
    } =
      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          provider_reference:
            checkoutSessionId,
          provider_response:
            monimeData,
          metadata:
            finalMetadata,
          status:
            'pending',
        })
        .eq(
          'id',
          paymentTransactionId
        );

    if (
      updatePaymentError
    ) {
      console.error(
        'Failed to store Monime checkout reference:',
        updatePaymentError
      );

      /*
       * The provider checkout already exists.
       * Do NOT mark the payment failed here.
       *
       * The record is retained so that the
       * transaction can be reconciled rather
       * than accidentally creating another
       * checkout.
       */

      return res.status(500).json({
        error:
          'Checkout was created but could not be synchronized with MatMove. Please do not retry immediately.',
        paymentTransactionId,
        checkoutSessionId,
      });
    }

    /*
     * =========================================================
     * 12. Return hosted checkout
     * =========================================================
     */

    return res.status(200).json({
      status:
        'pending',
      paymentTransactionId,
      checkoutSessionId,
      redirectUrl,
      currency,
      amount,
    });
  } catch (error) {
    console.error(
      'Monime checkout API exception:',
      error
    );

    /*
     * IMPORTANT:
     *
     * If the provider request was started but the
     * network response is unknown, we must NOT
     * blindly mark the payment failed.
     *
     * Monime may have created the checkout even
     * though MatMove did not receive the response.
     *
     * The transaction therefore remains pending
     * and can be reconciled using the provider
     * reference/idempotency key.
     */

    if (
      paymentTransactionId &&
      !providerRequestStarted
    ) {
      try {
        const supabaseUrl =
          process.env.SUPABASE_URL ||
          process.env.VITE_SUPABASE_URL;

        const serviceRoleKey =
          process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (
          supabaseUrl &&
          serviceRoleKey
        ) {
          const supabaseAdmin =
            createClient(
              supabaseUrl,
              serviceRoleKey,
              {
                auth: {
                  autoRefreshToken:
                    false,
                  persistSession:
                    false,
                },
              }
            );

          await supabaseAdmin
            .from(
              'payment_transactions'
            )
            .update({
              status:
                'failed',
              failure_code:
                'checkout_preparation_exception',
              failure_message:
                error?.message ||
                'Checkout preparation failed.',
              failed_at:
                new Date().toISOString(),
            })
            .eq(
              'id',
              paymentTransactionId
            )
            .eq(
              'status',
              'pending'
            );
        }
      } catch (
        cleanupError
      ) {
        console.error(
          'Payment failure cleanup error:',
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error:
        'Unable to start the wallet top-up.',
      paymentTransactionId:
        paymentTransactionId ||
        undefined,
    });
  }
}