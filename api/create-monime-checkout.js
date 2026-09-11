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
    !authorization.startsWith('Bearer ')
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
    return configuredUrl.startsWith('http://') ||
      configuredUrl.startsWith('https://')
      ? configuredUrl.replace(/\/$/, '')
      : `https://${configuredUrl.replace(/\/$/, '')}`;
  }

  const forwardedHost =
    req.headers['x-forwarded-host'];

  const host =
    forwardedHost ||
    req.headers.host;

  const forwardedProto =
    req.headers['x-forwarded-proto'];

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
  const value = String(role || '')
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
          String(value ?? '').trim()
        );

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  const rounded =
    Math.round(
      (amount + Number.EPSILON) * 100
    ) / 100;

  if (
    !Number.isFinite(rounded) ||
    rounded <= 0
  ) {
    return null;
  }

  return rounded;
}

function toMinorUnits(amount) {
  return Math.round(
    (amount + Number.EPSILON) * 100
  );
}

function extractSupabaseError(error) {
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

async function readJsonResponse(response) {
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

function getCheckoutData(response) {
  if (
    response &&
    typeof response === 'object'
  ) {
    if (
      response.result &&
      typeof response.result === 'object'
    ) {
      return response.result;
    }

    if (
      response.data &&
      typeof response.data === 'object'
    ) {
      return response.data;
    }
  }

  return response || {};
}

async function resolveCustomerRole(
  supabaseAdmin,
  userId,
  profileRole
) {
  /*
   * profiles.role is the first source because
   * it is part of the customer's profile.
   *
   * However, role governance in MatMove also
   * maintains public.user_roles. We therefore
   * use that table as an authoritative fallback
   * when the profile role is missing/stale.
   *
   * This function NEVER grants admin access.
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
      .eq('profile_id', userId);

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
            normalizeRole(row?.role)
          )
          .filter((role) =>
            ALLOWED_ROLES.has(role)
          )
      : [];

  /*
   * Prefer a real customer role in a stable
   * order. Admin is deliberately excluded.
   */
  const preferredOrder = [
    'merchant',
    'driver',
    'rider',
  ];

  for (const preferredRole of preferredOrder) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  let paymentTransactionId = null;
  let providerRequestStarted = false;

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
            autoRefreshToken: false,
            persistSession: false,
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
      typeof req.body === 'object'
        ? req.body
        : {};

    const amount =
      parseAmount(body.amount);

    const currency =
      String(
        body.currency || 'SLE'
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
      !ALLOWED_CURRENCIES.has(currency)
    ) {
      return res.status(400).json({
        error:
          'Only SLE and USD wallets are supported.',
      });
    }

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
        .eq('id', userId)
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

    /*
     * =========================================================
     * 5. Customer role
     * =========================================================
     *
     * IMPORTANT:
     *
     * KYC status is intentionally NOT checked here.
     *
     * MatMove customer wallet access is available
     * immediately after account creation for:
     *
     *   Rider
     *   Driver
     *   Merchant
     *
     * KYC approval is a withdrawal-control rule,
     * not a wallet/top-up access rule.
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

      return res.status(403).json({
        error:
          'This account is not registered as a MatMove customer account.',
      });
    }

    /*
     * =========================================================
     * 6. Customer wallet
     * =========================================================
     */

    let {
      data: wallet,
      error: walletError,
    } =
      await supabaseAdmin
        .from('wallets')
        .select(
          'id,user_id,currency,balance,reserved_balance,is_frozen'
        )
        .eq('user_id', userId)
        .eq('currency', currency)
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

    /*
     * A newly-created eligible customer should
     * receive both SLE and USD wallets through
     * the secure backend wallet-creation function.
     *
     * If the wallet trigger has not yet materialized
     * the requested wallet, ask the secure function
     * to ensure the wallet exists.
     *
     * This does NOT credit the wallet.
     */

    if (!wallet) {
      const {
        error: ensureWalletError,
      } =
        await supabaseAdmin.rpc(
          'ensure_matmove_wallets',
          {
            p_profile_id: userId,
          }
        );

      if (ensureWalletError) {
        console.error(
          'Unable to ensure customer wallets:',
          ensureWalletError
        );

        return res.status(404).json({
          error:
            `Your ${currency} wallet could not be found.`,
        });
      }

      const walletRetry =
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

      wallet =
        walletRetry.data;

      walletError =
        walletRetry.error;

      if (walletError) {
        console.error(
          'Wallet retry lookup failed:',
          walletError
        );

        return res.status(500).json({
          error:
            'Unable to load customer wallet.',
        });
      }
    }

    if (!wallet) {
      return res.status(404).json({
        error:
          `Your ${currency} wallet could not be found.`,
      });
    }

    if (
      wallet.user_id !== userId
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

      return res.status(403).json({
        error:
          'This wallet does not belong to the authenticated account.',
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
     * 7. Idempotency
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
     * 8. Create MatMove pending payment
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
      customer_role:
        role,
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
            authData.user.phone ||
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
     * 9. Build checkout URLs
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
     * 10. Monime checkout request
     * =========================================================
     *
     * IMPORTANT:
     *
     * This creates only the provider checkout.
     *
     * It does NOT credit the MatMove wallet.
     *
     * Wallet settlement occurs only after the
     * authoritative provider webhook reaches
     * MatMove and the secure settlement RPC
     * confirms the payment.
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
        customer_role:
          role,
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
     * 11. Extract checkout response
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
     * 12. Store provider state
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
       * Provider checkout already exists.
       * Do not falsely mark the payment failed.
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
     * 13. Return hosted checkout
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
     * If the provider request has already started,
     * the result may be unknown. Keep the payment
     * pending rather than falsely declaring failure.
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