import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const VULT_API_URL =
  'https://wallet.vultme.io/api/merchants/private/v1/payment-links';

const ALLOWED_ROLES = new Set([
  'rider',
  'driver',
  'merchant',
  'vendor',
]);

const ALLOWED_CURRENCIES = new Set([
  'USD',
]);

const ALLOWED_TYPES = new Set([
  'card',
  'in-app',
]);

function getBearerToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    '';

  if (
    typeof authorization !== 'string' ||
    !authorization.startsWith('Bearer ')
  ) {
    return null;
  }

  return (
    authorization
      .slice(7)
      .trim() || null
  );
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

async function resolveCustomerRole(
  supabaseAdmin,
  userId,
  profileRole
) {
  /*
   * profiles.role is preferred when it contains
   * a valid MatMove customer role.
   *
   * user_roles is used as a secure fallback
   * if profiles.role is missing or stale.
   *
   * Admin is never accepted as a customer role.
   */

  const normalizedProfileRole =
    normalizeRole(profileRole);

  if (
    ALLOWED_ROLES.has(
      normalizedProfileRole
    )
  ) {
    return normalizedProfileRole;
  }

  const {
    data: roleRows,
    error: rolesError,
  } =
    await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq(
        'profile_id',
        userId
      );

  if (rolesError) {
    console.error(
      'Customer role lookup failed:',
      rolesError
    );

    return null;
  }

  const normalizedRoles =
    Array.isArray(roleRows)
      ? roleRows
          .map((row) =>
            normalizeRole(
              row?.role
            )
          )
          .filter((role) =>
            ALLOWED_ROLES.has(
              role
            )
          )
      : [];

  /*
   * Prefer the strongest applicable customer
   * role if more than one historical role exists.
   */
  const preferredOrder = [
    'merchant',
    'driver',
    'rider',
  ];

  for (
    const preferredRole of preferredOrder
  ) {
    if (
      normalizedRoles.includes(
        preferredRole
      )
    ) {
      return preferredRole;
    }
  }

  return null;
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

function getAppUrl(req) {
  const configuredUrl =
    process.env.APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    '';

  if (
    typeof configuredUrl ===
      'string' &&
    configuredUrl.trim()
  ) {
    const value =
      configuredUrl
        .trim()
        .replace(
          /\/$/,
          ''
        );

    return value.startsWith(
      'http://'
    ) ||
      value.startsWith(
        'https://'
      )
      ? value
      : `https://${value}`;
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
    (host?.includes(
      'localhost'
    )
      ? 'http'
      : 'https');

  if (host) {
    return `${protocol}://${host}`;
  }

  return null;
}

function loadVultPrivateKey() {
  const rawKey =
    process.env.VULT_PRIVATE_KEY;

  if (
    typeof rawKey !==
      'string' ||
    !rawKey.trim()
  ) {
    throw new Error(
      'VULT_PRIVATE_KEY is not configured.'
    );
  }

  return rawKey
    .replace(
      /\\n/g,
      '\n'
    )
    .trim();
}

function signRequestBody(
  requestBody,
  privateKey
) {
  const signer =
    crypto.createSign(
      'RSA-SHA512'
    );

  /*
   * The exact serialized JSON is signed and
   * the exact same serialization is sent to Vult.
   */
  const serializedBody =
    JSON.stringify(
      requestBody
    );

  signer.update(
    serializedBody,
    'utf8'
  );

  signer.end();

  return signer.sign(
    {
      key: privateKey,

      padding:
        crypto.constants
          .RSA_PKCS1_PSS_PADDING,

      saltLength:
        crypto.constants
          .RSA_PSS_SALTLEN_DIGEST,
    },
    'base64'
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
    return JSON.parse(
      text
    );
  } catch {
    return {
      raw: text,
    };
  }
}

function getProviderResult(
  response
) {
  if (
    response?.result &&
    typeof response.result ===
      'object'
  ) {
    return response.result;
  }

  if (
    response?.data &&
    typeof response.data ===
      'object'
  ) {
    return (
      response.data.result ||
      response.data
    );
  }

  return response || {};
}

function extractPaymentLink(
  response
) {
  const result =
    getProviderResult(
      response
    );

  const candidates = [
    result?.redirectUrl,
    result?.redirect_url,
    result?.paymentLink,
    result?.payment_link,
    result?.link,
    result?.url,

    response?.redirectUrl,
    response?.redirect_url,
    response?.paymentLink,
    response?.payment_link,
    response?.link,
    response?.url,
  ];

  for (
    const value of candidates
  ) {
    if (
      typeof value ===
        'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function extractProviderReference(
  response
) {
  const result =
    getProviderResult(
      response
    );

  const candidates = [
    result?.id,
    result?.paymentLinkId,
    result?.payment_link_id,
    result?.vultRequestId,
    result?.vult_request_id,

    response?.id,
    response?.paymentLinkId,
    response?.payment_link_id,
    response?.vultRequestId,
    response?.vult_request_id,
  ];

  for (
    const value of candidates
  ) {
    if (
      typeof value ===
        'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function extractPaymentCode(
  response
) {
  const result =
    getProviderResult(
      response
    );

  const candidates = [
    result?.code,
    result?.paymentCode,
    result?.payment_code,

    response?.code,
    response?.paymentCode,
    response?.payment_code,
  ];

  for (
    const value of candidates
  ) {
    if (
      typeof value ===
        'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function extractProviderStatus(
  response
) {
  const result =
    getProviderResult(
      response
    );

  return String(
    result?.status ||
      response?.status ||
      ''
  )
    .trim()
    .toLowerCase();
}

function sanitizeIdempotencyKey(
  value
) {
  if (
    typeof value !==
    'string'
  ) {
    return '';
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      64
  ) {
    return '';
  }

  return normalized;
}

function isDefinitiveClientRejection(
  status
) {
  return (
    status >= 400 &&
    status < 500
  );
}

function buildProviderErrorMessage(
  providerResponse,
  status
) {
  const message =
    providerResponse?.message ||
    providerResponse?.error?.message ||
    providerResponse?.error ||
    providerResponse?.detail;

  if (
    typeof message ===
      'string' &&
    message.trim()
  ) {
    return message
      .trim()
      .slice(0, 500);
  }

  return `Vult rejected the payment-link request (HTTP ${status}).`;
}

function getErrorMessage(
  error,
  fallback
) {
  if (
    error &&
    typeof error.message ===
      'string' &&
    error.message.trim()
  ) {
    return error.message
      .trim()
      .slice(0, 500);
  }

  return fallback;
}

async function markPaymentFailed(
  supabaseAdmin,
  paymentTransactionId,
  failureCode,
  failureMessage,
  providerResponse,
  extraMetadata = {}
) {
  if (
    !paymentTransactionId
  ) {
    return;
  }

  const {
    error,
  } =
    await supabaseAdmin
      .from(
        'payment_transactions'
      )
      .update({
        status:
          'failed',

        failure_code:
          failureCode,

        failure_message:
          failureMessage,

        provider_response:
          providerResponse,

        failed_at:
          new Date().toISOString(),

        metadata:
          extraMetadata,
      })
      .eq(
        'id',
        paymentTransactionId
      )
      .eq(
        'status',
        'pending'
      );

  if (error) {
    console.error(
      'Failed to mark Vult payment as failed:',
      error
    );
  }
}

export default async function handler(
  req,
  res
) {
  if (
    req.method !==
    'POST'
  ) {
    res.setHeader(
      'Allow',
      'POST'
    );

    return res.status(
      405
    ).json({
      error:
        'Method not allowed.',
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

    const vultMerchantId =
      process.env.VULT_MERCHANT_ID;

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !vultMerchantId ||
      !process.env.VULT_PRIVATE_KEY
    ) {
      console.error(
        'Missing required Vult payment environment variables.'
      );

      return res.status(
        500
      ).json({
        error:
          'Vult payment service is not configured.',
      });
    }

    /*
     * =========================================================
     * 2. Authenticate customer
     * =========================================================
     */

    const accessToken =
      getBearerToken(
        req
      );

    if (!accessToken) {
      return res.status(
        401
      ).json({
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
      error:
        authError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      authError ||
      !authData?.user
    ) {
      return res.status(
        401
      ).json({
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
          'USD'
      )
        .trim()
        .toUpperCase();

    const type =
      String(
        body.type ||
          'card'
      )
        .trim()
        .toLowerCase();

    const requestedIdempotencyKey =
      sanitizeIdempotencyKey(
        body.idempotencyKey ||
          body.idempotency_key
      );

    if (!amount) {
      return res.status(
        400
      ).json({
        error:
          'A valid top-up amount is required.',
      });
    }

    if (
      !ALLOWED_CURRENCIES.has(
        currency
      )
    ) {
      return res.status(
        400
      ).json({
        error:
          'Vult checkout is currently available for USD wallet funding only.',
      });
    }

    if (
      !ALLOWED_TYPES.has(
        type
      )
    ) {
      return res.status(
        400
      ).json({
        error:
          'Invalid Vult payment type.',
      });
    }

    const idempotencyKey =
      requestedIdempotencyKey ||
      crypto.randomUUID();

    /*
     * =========================================================
     * 4. Authoritative customer profile
     * =========================================================
     */

    const {
      data: profile,
      error:
        profileError,
    } =
      await supabaseAdmin
        .from(
          'profiles'
        )
        .select(
          'id,first_name,last_name,phone,role,kyc_status'
        )
        .eq(
          'id',
          userId
        )
        .maybeSingle();

    if (
      profileError
    ) {
      console.error(
        'Profile lookup failed:',
        profileError
      );

      return res.status(
        500
      ).json({
        error:
          'Unable to verify customer profile.',
      });
    }

    if (!profile) {
      return res.status(
        404
      ).json({
        error:
          'Customer profile not found.',
      });
    }

    /*
     * =========================================================
     * 5. Resolve customer role
     * =========================================================
     *
     * IMPORTANT:
     *
     * KYC is intentionally NOT checked here.
     *
     * A Rider, Driver, or Merchant can fund the
     * customer wallet immediately after registration.
     *
     * Withdrawal remains the operation that requires
     * KYC approval.
     */

    const role =
      await resolveCustomerRole(
        supabaseAdmin,
        userId,
        profile.role
      );

    if (!role) {
      console.warn(
        'Customer wallet role could not be resolved:',
        {
          userId,
          profileRole:
            profile.role,
        }
      );

      return res.status(
        403
      ).json({
        error:
          'This account is not registered as a MatMove customer account.',
      });
    }

    /*
     * =========================================================
     * 6. Customer USD wallet
     * =========================================================
     */

    let {
      data: wallet,
      error:
        walletError,
    } =
      await supabaseAdmin
        .from(
          'wallets'
        )
        .select(
          'id,user_id,currency,balance,reserved_balance,is_frozen'
        )
        .eq(
          'user_id',
          userId
        )
        .eq(
          'currency',
          'USD'
        )
        .maybeSingle();

    if (
      walletError
    ) {
      console.error(
        'Wallet lookup failed:',
        walletError
      );

      return res.status(
        500
      ).json({
        error:
          'Unable to load customer wallet.',
      });
    }

    /*
     * Newly-created eligible customers should have
     * their SLE/USD wallets created by the secure
     * backend wallet function.
     *
     * If the wallet has not materialized yet,
     * safely ensure it exists before proceeding.
     *
     * This does NOT add money to the wallet.
     */

    if (!wallet) {
      const {
        error:
          ensureWalletError,
      } =
        await supabaseAdmin.rpc(
          'ensure_matmove_wallets',
          {
            p_profile_id:
              userId,
          }
        );

      if (
        ensureWalletError
      ) {
        console.error(
          'Unable to ensure customer wallets:',
          ensureWalletError
        );

        return res.status(
          404
        ).json({
          error:
            'Your USD wallet could not be found.',
        });
      }

      const walletRetry =
        await supabaseAdmin
          .from(
            'wallets'
          )
          .select(
            'id,user_id,currency,balance,reserved_balance,is_frozen'
          )
          .eq(
            'user_id',
            userId
          )
          .eq(
            'currency',
            'USD'
          )
          .maybeSingle();

      wallet =
        walletRetry.data;

      walletError =
        walletRetry.error;

      if (
        walletError
      ) {
        console.error(
          'Wallet retry lookup failed:',
          walletError
        );

        return res.status(
          500
        ).json({
          error:
            'Unable to load customer wallet.',
        });
      }
    }

    if (!wallet) {
      return res.status(
        404
      ).json({
        error:
          'Your USD wallet could not be found.',
      });
    }

    if (
      wallet.user_id !==
      userId
    ) {
      console.error(
        'Wallet ownership mismatch:',
        {
          userId,
          walletUserId:
            wallet.user_id,
          walletId:
            wallet.id,
        }
      );

      return res.status(
        403
      ).json({
        error:
          'This wallet does not belong to the authenticated account.',
      });
    }

    if (
      wallet.is_frozen
    ) {
      return res.status(
        403
      ).json({
        error:
          'This wallet is currently frozen.',
      });
    }

    /*
     * =========================================================
     * 7. Idempotency lookup
     * =========================================================
     */

    const {
      data: existingPayment,
      error:
        existingPaymentError,
    } =
      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .select(
          [
            'id',
            'user_id',
            'wallet_id',
            'transaction_type',
            'provider',
            'provider_reference',
            'idempotency_key',
            'amount',
            'currency',
            'status',
            'metadata',
            'provider_response',
            'created_at',
          ].join(', ')
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

      return res.status(
        500
      ).json({
        error:
          'Unable to verify payment request.',
      });
    }

    if (
      existingPayment
    ) {
      if (
        existingPayment.user_id !==
        userId
      ) {
        return res.status(
          409
        ).json({
          error:
            'This payment request belongs to another account.',
        });
      }

      if (
        existingPayment.wallet_id !==
        wallet.id
      ) {
        return res.status(
          409
        ).json({
          error:
            'This payment request does not match the selected wallet.',
        });
      }

      if (
        existingPayment.provider !==
          'vult' ||
        ![
          'wallet_topup',
          'topup',
        ].includes(
          String(
            existingPayment.transaction_type ||
              ''
          ).toLowerCase()
        )
      ) {
        return res.status(
          409
        ).json({
          error:
            'This idempotency key is already associated with another transaction.',
        });
      }

      if (
        Number(
          existingPayment.amount
        ) !== amount ||
        existingPayment.currency !==
          currency
      ) {
        return res.status(
          409
        ).json({
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

      const existingPaymentLink =
        existingMetadata.payment_link ||
        extractPaymentLink(
          existingPayment.provider_response
        );

      /*
       * Existing pending checkout with a usable
       * payment link can safely be resumed.
       */
      if (
        existingPayment.status ===
          'pending' &&
        existingPaymentLink
      ) {
        return res.status(
          200
        ).json({
          status:
            'pending',

          paymentTransactionId:
            existingPayment.id,

          orderId:
            existingMetadata.order_id ||
            existingPayment.id,

          redirectUrl:
            existingPaymentLink,

          paymentCode:
            existingMetadata.payment_code ||
            extractPaymentCode(
              existingPayment.provider_response
            ),

          paymentType:
            existingMetadata.payment_type ||
            type,

          currency:
            existingPayment.currency,

          amount:
            existingPayment.amount,

          providerReference:
            existingPayment.provider_reference ||
            extractProviderReference(
              existingPayment.provider_response
            ),

          idempotent:
            true,
        });
      }

      if (
        existingPayment.status ===
        'completed'
      ) {
        return res.status(
          409
        ).json({
          error:
            'This payment request has already been completed.',

          paymentTransactionId:
            existingPayment.id,
        });
      }

      /*
       * A pending transaction without a known
       * provider checkout must not create another
       * provider order using the same idempotency key.
       */
      if (
        existingPayment.status ===
        'pending'
      ) {
        return res.status(
          202
        ).json({
          status:
            'pending',

          paymentTransactionId:
            existingPayment.id,

          message:
            'This payment request is already pending provider reconciliation. Please do not retry immediately.',
        });
      }

      return res.status(
        409
      ).json({
        error:
          'This payment request has already reached a final state.',

        paymentTransactionId:
          existingPayment.id,

        status:
          existingPayment.status,
      });
    }

    /*
     * =========================================================
     * 8. Create MatMove pending payment
     * =========================================================
     *
     * This is an accounting intent.
     *
     * No wallet balance is changed here.
     */

    const orderId =
      `MM-VULT-${crypto.randomUUID()}`;

    const paymentMetadata = {
      provider:
        'vult',

      payment_method:
        type === 'card'
          ? 'card'
          : 'vult_in_app',

      purpose:
        'wallet_topup',

      matmove_user_id:
        userId,

      wallet_id:
        wallet.id,

      customer_role:
        role,

      payment_type:
        type,

      currency,

      amount,

      order_id:
        orderId,

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
            'vult',

          idempotency_key:
            idempotencyKey,

          amount,

          currency,

          status:
            'pending',

          customer_phone:
            profile.phone ||
            authData.user.phone ||
            null,

          metadata:
            paymentMetadata,
        })
        .select(
          [
            'id',
            'user_id',
            'wallet_id',
            'transaction_type',
            'provider',
            'idempotency_key',
            'amount',
            'currency',
            'status',
            'metadata',
          ].join(', ')
        )
        .single();

    if (
      paymentInsertError
    ) {
      /*
       * Handle an idempotency race by re-reading
       * the existing transaction.
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
              [
                'id',
                'user_id',
                'wallet_id',
                'provider_reference',
                'status',
                'amount',
                'currency',
                'metadata',
                'provider_response',
              ].join(', ')
            )
            .eq(
              'idempotency_key',
              idempotencyKey
            )
            .maybeSingle();

        if (
          concurrentPayment &&
          concurrentPayment.user_id ===
            userId &&
          concurrentPayment.wallet_id ===
            wallet.id &&
          concurrentPayment.provider ===
            'vult' &&
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

          const concurrentPaymentLink =
            concurrentMetadata.payment_link ||
            extractPaymentLink(
              concurrentPayment.provider_response
            );

          if (
            concurrentPayment.status ===
              'pending' &&
            concurrentPaymentLink
          ) {
            return res.status(
              200
            ).json({
              status:
                'pending',

              paymentTransactionId:
                concurrentPayment.id,

              orderId:
                concurrentMetadata.order_id ||
                concurrentPayment.id,

              redirectUrl:
                concurrentPaymentLink,

              paymentCode:
                concurrentMetadata.payment_code ||
                extractPaymentCode(
                  concurrentPayment.provider_response
                ),

              paymentType:
                concurrentMetadata.payment_type ||
                type,

              currency:
                concurrentPayment.currency,

              amount:
                concurrentPayment.amount,

              providerReference:
                concurrentPayment.provider_reference ||
                extractProviderReference(
                  concurrentPayment.provider_response
                ),

              idempotent:
                true,
            });
          }

          return res.status(
            202
          ).json({
            status:
              concurrentPayment.status ||
              'pending',

            paymentTransactionId:
              concurrentPayment.id,

            message:
              'This payment request is already being processed.',
          });
        }
      }

      console.error(
        'Payment transaction creation failed:',
        paymentInsertError
      );

      return res.status(
        500
      ).json({
        error:
          'Unable to create the payment transaction.',
      });
    }

    paymentTransactionId =
      paymentTransaction.id;

    /*
     * =========================================================
     * 9. Build Vult request
     * =========================================================
     */

    const requestBody = {
      merchantId:
        vultMerchantId,

      type,

      payload: {
        orderId,

        currency,

        amount:
          amount.toFixed(2),
      },
    };

    const privateKey =
      loadVultPrivateKey();

    const signature =
      signRequestBody(
        requestBody,
        privateKey
      );

    /*
     * =========================================================
     * 10. Submit Vult payment-link request
     * =========================================================
     */

    providerRequestStarted =
      true;

    let vultResponse;

    try {
      vultResponse =
        await fetch(
          VULT_API_URL,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              'X-Vult-Merchant-Signature':
                signature,
            },

            body:
              JSON.stringify(
                requestBody
              ),
          }
        );
    } catch (
      providerError
    ) {
      /*
       * Provider outcome is unknown.
       *
       * Vult may have received and created
       * the order even though MatMove received
       * no HTTP response.
       */
      console.error(
        'Vult network request failed after provider request started:',
        {
          error:
            providerError,

          paymentTransactionId,

          orderId,
        }
      );

      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          metadata: {
            ...paymentMetadata,

            status:
              'pending',

            provider_request_state:
              'unknown',

            provider_request_error:
              getErrorMessage(
                providerError,
                'Vult network request failed.'
              ),
          },
        })
        .eq(
          'id',
          paymentTransactionId
        )
        .eq(
          'status',
          'pending'
        );

      return res.status(
        202
      ).json({
        status:
          'pending',

        paymentTransactionId,

        orderId,

        message:
          'The Vult payment request could not be confirmed immediately. It remains pending for reconciliation. Please do not retry immediately.',
      });
    }

    const vultData =
      await readJsonResponse(
        vultResponse
      );

    /*
     * =========================================================
     * 11. Provider HTTP response
     * =========================================================
     */

    if (
      !vultResponse.ok
    ) {
      console.error(
        'Vult payment-link request failed:',
        {
          status:
            vultResponse.status,

          paymentTransactionId,

          orderId,

          response:
            vultData,
        }
      );

      /*
       * 4xx = definitive request rejection.
       */
      if (
        isDefinitiveClientRejection(
          vultResponse.status
        )
      ) {
        const failureMessage =
          buildProviderErrorMessage(
            vultData,
            vultResponse.status
          );

        await markPaymentFailed(
          supabaseAdmin,
          paymentTransactionId,
          `vult_http_${vultResponse.status}`,
          failureMessage,
          vultData,
          {
            ...paymentMetadata,

            status:
              'failed',

            provider_http_status:
              vultResponse.status,
          }
        );

        return res.status(
          502
        ).json({
          error:
            'Vult rejected the payment request.',

          paymentTransactionId,
        });
      }

      /*
       * 5xx = ambiguous provider outcome.
       *
       * Keep pending.
       */
      await supabaseAdmin
        .from(
          'payment_transactions'
        )
        .update({
          provider_response:
            vultData,

          metadata: {
            ...paymentMetadata,

            status:
              'pending',

            provider_request_state:
              'unknown',

            provider_http_status:
              vultResponse.status,
          },
        })
        .eq(
          'id',
          paymentTransactionId
        )
        .eq(
          'status',
          'pending'
        );

      return res.status(
        202
      ).json({
        status:
          'pending',

        paymentTransactionId,

        orderId,

        message:
          'Vult did not return a definitive result. The payment remains pending for reconciliation. Please do not retry immediately.',
      });
    }

    /*
     * =========================================================
     * 12. Extract Vult checkout
     * =========================================================
     */

    const paymentLink =
      extractPaymentLink(
        vultData
      );

    const paymentCode =
      extractPaymentCode(
        vultData
      );

    const providerReference =
      extractProviderReference(
        vultData
      );

    const providerStatus =
      extractProviderStatus(
        vultData
      );

    /*
     * A successful HTTP response without a usable
     * hosted payment link cannot be presented as
     * a usable checkout.
     */
    if (
      !paymentLink
    ) {
      console.error(
        'Vult returned a successful HTTP response without a usable payment link:',
        {
          paymentTransactionId,

          orderId,

          providerReference,

          providerStatus,

          response:
            vultData,
        }
      );

      await markPaymentFailed(
        supabaseAdmin,
        paymentTransactionId,
        'invalid_vult_response',
        'Vult did not return a usable payment link.',
        vultData,
        {
          ...paymentMetadata,

          status:
            'failed',

          provider_reference:
            providerReference,

          provider_status:
            providerStatus,
        }
      );

      return res.status(
        502
      ).json({
        error:
          'Vult returned an invalid payment response.',

        paymentTransactionId,
      });
    }

    /*
     * =========================================================
     * 13. Store provider state
     * =========================================================
     *
     * Keep status pending.
     *
     * Vult webhook is authoritative.
     */

    const finalMetadata = {
      ...paymentMetadata,

      status:
        'pending',

      provider_request_state:
        'accepted',

      order_id:
        orderId,

      payment_type:
        type,

      payment_link:
        paymentLink,

      payment_code:
        paymentCode,

      provider_status:
        providerStatus ||
        'pending',

      provider_reference:
        providerReference,

      provider_response:
        vultData,
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
            providerReference,

          provider_response:
            vultData,

          metadata:
            finalMetadata,

          status:
            'pending',
        })
        .eq(
          'id',
          paymentTransactionId
        )
        .eq(
          'status',
          'pending'
        );

    if (
      updatePaymentError
    ) {
      /*
       * Vult accepted the request.
       *
       * Do not falsely fail the payment because
       * MatMove failed to save the provider response.
       */
      console.error(
        'Failed to store Vult payment response:',
        updatePaymentError
      );

      return res.status(
        202
      ).json({
        status:
          'pending',

        paymentTransactionId,

        orderId,

        message:
          'Vult created the payment request, but MatMove could not complete synchronization. Please do not retry immediately.',
      });
    }

    /*
     * =========================================================
     * 14. Return hosted checkout
     * =========================================================
     *
     * NO wallet balance is changed here.
     *
     * Final flow:
     *
     * Vult checkout
     *      ↓
     * Vult webhook
     *      ↓
     * register_provider_webhook_event()
     *      ↓
     * settle_wallet_topup()
     *      ↓
     * MatMove wallet + ledger
     */

    return res.status(
      200
    ).json({
      status:
        'pending',

      paymentTransactionId,

      orderId,

      paymentType:
        type,

      currency,

      amount,

      redirectUrl:
        paymentLink,

      paymentCode:
        paymentCode ||
        null,

      providerReference:
        providerReference ||
        null,
    });
  } catch (
    error
  ) {
    console.error(
      'Vult checkout API exception:',
      {
        error,

        paymentTransactionId,

        providerRequestStarted,
      }
    );

    /*
     * If Vult communication has started, the outcome
     * may be unknown. Preserve pending state.
     */
    if (
      providerRequestStarted &&
      paymentTransactionId
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
              metadata: {
                provider:
                  'vult',

                provider_request_state:
                  'unknown',

                provider_request_error:
                  getErrorMessage(
                    error,
                    'Vult checkout exception.'
                  ),
              },
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
        reconciliationError
      ) {
        console.error(
          'Vult pending-state preservation failed:',
          reconciliationError
        );
      }

      return res.status(
        202
      ).json({
        status:
          'pending',

        paymentTransactionId,

        message:
          'The Vult payment request may have been received. The payment remains pending for reconciliation. Please do not retry immediately.',
      });
    }

    /*
     * Exception occurred before provider communication.
     * It is safe to fail the MatMove pending transaction.
     */
    if (
      paymentTransactionId
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
                'vult_checkout_exception',

              failure_message:
                getErrorMessage(
                  error,
                  'Vult checkout API exception.'
                ),

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
          'Vult payment failure cleanup error:',
          cleanupError
        );
      }
    }

    return res.status(
      500
    ).json({
      error:
        'Unable to start the Vult wallet top-up.',

      ...(paymentTransactionId
        ? {
            paymentTransactionId,
          }
        : {}),
    });
  }
}