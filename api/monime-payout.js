import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req) {
  const authorization =
    req.headers.authorization || '';

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

function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      'Supabase server environment variables are not configured.'
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

function getSupabaseUserClient(
  accessToken
) {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;

  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !anonKey
  ) {
    throw new Error(
      'Supabase public server environment variables are not configured.'
    );
  }

  return createClient(
    supabaseUrl,
    anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      },
    }
  );
}

function generateIdempotencyKey() {
  return crypto.randomUUID();
}

function normalizePhone(phone) {
  if (
    typeof phone !== 'string'
  ) {
    return '';
  }

  return phone.trim();
}

function normalizeNetwork(network) {
  const value =
    String(
      network || ''
    )
      .trim()
      .toLowerCase();

  if (
    value === 'orange' ||
    value === 'orange_money' ||
    value === 'orangemoney' ||
    value === 'm17'
  ) {
    return {
      providerId: 'm17',
      name: 'Orange Money',
    };
  }

  if (
    value === 'afrimoney' ||
    value === 'afri_money' ||
    value === 'afri money' ||
    value === 'm18'
  ) {
    return {
      providerId: 'm18',
      name: 'Afrimoney',
    };
  }

  return null;
}

function parseAmount(value) {
  const amount =
    typeof value === 'number'
      ? value
      : Number(value);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  const normalized =
    Math.round(
      amount * 100
    ) / 100;

  if (
    !Number.isFinite(
      normalized
    ) ||
    normalized <= 0
  ) {
    return null;
  }

  return normalized;
}

function extractProviderPayout(
  payoutResponse
) {
  if (
    payoutResponse?.result &&
    typeof payoutResponse.result ===
      'object'
  ) {
    return payoutResponse.result;
  }

  if (
    payoutResponse?.data &&
    typeof payoutResponse.data ===
      'object'
  ) {
    return (
      payoutResponse.data.result ||
      payoutResponse.data
    );
  }

  return payoutResponse;
}

function extractProviderPayoutId(
  payoutResponse
) {
  const payout =
    extractProviderPayout(
      payoutResponse
    );

  const candidates = [
    payout?.id,
    payout?.payoutId,
    payout?.payout_id,
    payout?.providerTransactionId,
    payout?.provider_transaction_id,
    payoutResponse?.id,
    payoutResponse?.payoutId,
    payoutResponse?.payout_id,
  ];

  for (
    const value of candidates
  ) {
    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function extractProviderStatus(
  payoutResponse
) {
  const payout =
    extractProviderPayout(
      payoutResponse
    );

  return String(
    payout?.status ||
      payoutResponse?.status ||
      ''
  ).toLowerCase();
}

function getInitiationValue(
  initiation,
  ...keys
) {
  for (
    const key of keys
  ) {
    const value =
      initiation?.[key];

    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function isPendingWithdrawal(
  status
) {
  return (
    String(
      status || ''
    ).toLowerCase() ===
    'pending'
  );
}

function isFinalWithdrawal(
  status
) {
  return [
    'completed',
    'failed',
    'cancelled',
    'canceled',
    'rejected',
  ].includes(
    String(
      status || ''
    ).toLowerCase()
  );
}

function isProviderDefinitelyRejected(
  status
) {
  return (
    status >= 400 &&
    status < 500
  );
}

async function rejectWithdrawal(
  supabaseAdmin,
  withdrawalId,
  reason
) {
  if (!withdrawalId) {
    return {
      success: false,
      skipped: true,
    };
  }

  try {
    const {
      data,
      error,
    } =
      await supabaseAdmin.rpc(
        'admin_reject_withdrawal',
        {
          p_withdrawal_id:
            withdrawalId,

          p_reason:
            reason,
        }
      );

    if (error) {
      console.error(
        'Failed to reject withdrawal after confirmed provider rejection:',
        error
      );

      return {
        success: false,
        error:
          error.message,
      };
    }

    if (
      data?.success === false
    ) {
      console.error(
        'Admin withdrawal rejection returned failure:',
        data
      );

      return {
        success: false,
        result:
          data,
      };
    }

    return {
      success: true,
      result:
        data,
    };
  } catch (error) {
    console.error(
      'Withdrawal rejection exception:',
      error
    );

    return {
      success: false,
      error:
        error?.message ||
        'Unknown rejection error.',
    };
  }
}

async function getExistingWithdrawal(
  supabaseAdmin,
  userId,
  idempotencyKey
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        'withdrawal_requests'
      )
      .select(
        [
          'id',
          'user_id',
          'payment_transaction_id',
          'amount',
          'currency',
          'status',
          'provider',
          'customer_phone',
          'idempotency_key',
          'provider_transaction_id',
        ].join(', ')
      )
      .eq(
        'user_id',
        userId
      )
      .eq(
        'idempotency_key',
        idempotencyKey
      )
      .maybeSingle();

  return {
    withdrawal:
      data || null,
    error,
  };
}

function buildProviderErrorMessage(
  payoutData,
  status
) {
  const providerMessage =
    payoutData?.message ||
    payoutData?.error?.message ||
    payoutData?.error ||
    payoutData?.detail;

  if (
    typeof providerMessage ===
      'string' &&
    providerMessage.trim()
  ) {
    return providerMessage
      .trim()
      .slice(0, 300);
  }

  return `Provider rejected the payout request (HTTP ${status}).`;
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

  let withdrawalId =
    null;

  let paymentTransactionId =
    null;

  let providerRequestStarted =
    false;

  try {
    /*
     * =========================================================
     * 1. Authenticate the actual Supabase user
     * =========================================================
     *
     * Never trust a browser-supplied userId.
     */
    const accessToken =
      getBearerToken(req);

    if (!accessToken) {
      return res.status(
        401
      ).json({
        error:
          'Authentication required.',
      });
    }

    const supabaseAdmin =
      getSupabaseAdmin();

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

    const authenticatedUserId =
      authData.user.id;

    /*
     * =========================================================
     * 2. Validate request
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

    const phone =
      normalizePhone(
        body.phone
      );

    const network =
      normalizeNetwork(
        body.network ||
          body.mobileMoneyNetwork ||
          body.provider
      );

    const currency =
      String(
        body.currency ||
          'SLE'
      )
        .trim()
        .toUpperCase();

    if (!amount) {
      return res.status(
        400
      ).json({
        error:
          'A valid withdrawal amount is required.',
      });
    }

    if (
      amount < 1
    ) {
      return res.status(
        400
      ).json({
        error:
          'Minimum withdrawal amount is SLE 1.',
      });
    }

    if (!phone) {
      return res.status(
        400
      ).json({
        error:
          'Mobile money phone number is required.',
      });
    }

    if (!network) {
      return res.status(
        400
      ).json({
        error:
          'Select Orange Money or Afrimoney.',
      });
    }

    if (
      currency !==
      'SLE'
    ) {
      return res.status(
        400
      ).json({
        error:
          'Monime mobile-money withdrawals currently support SLE only.',
      });
    }

    /*
     * =========================================================
     * 3. Verify customer profile
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
          'id, role, phone, kyc_status'
        )
        .eq(
          'id',
          authenticatedUserId
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

    const normalizedRole =
      String(
        profile.role || ''
      ).toLowerCase();

    if (
      ![
        'driver',
        'merchant',
        'vendor',
      ].includes(
        normalizedRole
      )
    ) {
      return res.status(
        403
      ).json({
        error:
          'Only drivers and merchants can withdraw wallet funds.',
      });
    }

    if (
      String(
        profile.kyc_status ||
          ''
      ).toLowerCase() !==
      'approved'
    ) {
      return res.status(
        403
      ).json({
        error:
          'Approved KYC is required before withdrawal.',
      });
    }

    /*
     * =========================================================
     * 4. Establish idempotency
     * =========================================================
     */

    const requestedIdempotencyKey =
      typeof body.idempotencyKey ===
        'string'
        ? body.idempotencyKey.trim()
        : '';

    const idempotencyKey =
      requestedIdempotencyKey ||
      generateIdempotencyKey();

    /*
     * Prevent absurdly large attacker-controlled
     * idempotency strings from being stored.
     */
    if (
      idempotencyKey.length >
      200
    ) {
      return res.status(
        400
      ).json({
        error:
          'Invalid idempotency key.',
      });
    }

    /*
     * =========================================================
     * 5. Check existing withdrawal
     * =========================================================
     *
     * We must not create two withdrawals for the same
     * idempotency key.
     */
    const {
      withdrawal:
        existingWithdrawal,
      error:
        existingWithdrawalError,
    } =
      await getExistingWithdrawal(
        supabaseAdmin,
        authenticatedUserId,
        idempotencyKey
      );

    if (
      existingWithdrawalError
    ) {
      console.error(
        'Existing withdrawal lookup failed:',
        existingWithdrawalError
      );

      return res.status(
        500
      ).json({
        error:
          'Unable to verify withdrawal request.',
      });
    }

    if (
      existingWithdrawal
    ) {
      if (
        existingWithdrawal.provider_transaction_id
      ) {
        return res.status(
          200
        ).json({
          status:
            existingWithdrawal.status ||
            'pending',

          duplicate:
            true,

          withdrawal_id:
            existingWithdrawal.id,

          payment_transaction_id:
            existingWithdrawal.payment_transaction_id,

          provider:
            'monime',

          provider_payout_id:
            existingWithdrawal.provider_transaction_id,

          message:
            'This withdrawal request has already been submitted to Monime.',
        });
      }

      if (
        isPendingWithdrawal(
          existingWithdrawal.status
        )
      ) {
        return res.status(
          200
        ).json({
          status:
            'pending',

          duplicate:
            true,

          withdrawal_id:
            existingWithdrawal.id,

          payment_transaction_id:
            existingWithdrawal.payment_transaction_id,

          provider:
            'monime',

          message:
            'This withdrawal request is already pending provider reconciliation.',
        });
      }

      if (
        isFinalWithdrawal(
          existingWithdrawal.status
        )
      ) {
        return res.status(
          409
        ).json({
          error:
            'This withdrawal request has already reached a final state.',

          withdrawal_id:
            existingWithdrawal.id,

          status:
            existingWithdrawal.status,
        });
      }

      return res.status(
        409
      ).json({
        error:
          'A withdrawal request already exists for this idempotency key.',

        withdrawal_id:
          existingWithdrawal.id,

        status:
          existingWithdrawal.status,
      });
    }

    /*
     * =========================================================
     * 6. Initiate MatMove withdrawal
     * =========================================================
     *
     * The secure RPC:
     *
     * - authenticates caller
     * - checks role
     * - checks KYC
     * - locks wallet
     * - checks available balance
     * - reserves funds
     * - creates payment transaction
     * - creates withdrawal request
     *
     * No permanent debit occurs here.
     */
    const customerClient =
      getSupabaseUserClient(
        accessToken
      );

    const {
      data: initiation,
      error:
        initiationError,
    } =
      await customerClient.rpc(
        'initiate_wallet_withdrawal',
        {
          p_amount:
            amount,

          p_currency:
            currency,

          p_provider:
            'mobile_money',

          p_customer_phone:
            phone,

          p_idempotency_key:
            idempotencyKey,

          p_description:
            `Mobile money withdrawal via ${network.name}`,
        }
      );

    if (
      initiationError
    ) {
      console.error(
        'Wallet withdrawal initiation failed:',
        initiationError
      );

      const message =
        initiationError.message ||
        'Withdrawal could not be initiated.';

      if (
        /insufficient|available balance|frozen|kyc|approved|withdraw/i.test(
          message
        )
      ) {
        return res.status(
          400
        ).json({
          error:
            message,
        });
      }

      return res.status(
        500
      ).json({
        error:
          'Withdrawal could not be initiated.',
      });
    }

    if (
      !initiation ||
      initiation.success !==
        true
    ) {
      console.error(
        'Withdrawal initiation returned an unexpected result:',
        initiation
      );

      return res.status(
        500
      ).json({
        error:
          'Withdrawal could not be initiated.',
      });
    }

    withdrawalId =
      getInitiationValue(
        initiation,
        'withdrawal_id',
        'withdrawalId',
        'id'
      );

    paymentTransactionId =
      getInitiationValue(
        initiation,
        'payment_transaction_id',
        'paymentTransactionId'
      );

    if (
      !withdrawalId
    ) {
      console.error(
        'Withdrawal initiation did not return a withdrawal ID:',
        initiation
      );

      return res.status(
        500
      ).json({
        error:
          'Withdrawal was not created correctly.',
      });
    }

    /*
     * =========================================================
     * 7. Verify Monime production configuration
     * =========================================================
     */

    const monimeApiKey =
      process.env.MONIME_API_KEY;

    const monimeSpaceId =
      process.env.MONIME_SPACE_ID;

    if (
      !monimeApiKey ||
      !monimeSpaceId
    ) {
      console.error(
        'Monime production environment variables are not configured.'
      );

      await rejectWithdrawal(
        supabaseAdmin,
        withdrawalId,
        'Monime payout service is not configured.'
      );

      return res.status(
        500
      ).json({
        error:
          'Payment provider is not configured.',
      });
    }

    /*
     * =========================================================
     * 8. Build Monime payout request
     * =========================================================
     *
     * Monime amount values are sent in the smallest currency
     * unit used by the API.
     */
    const monimeAmountValue =
      Math.round(
        amount * 100
      );

    const monimePayload = {
      amount: {
        currency:
          'SLE',

        value:
          monimeAmountValue,
      },

      destination: {
        type:
          'momo',

        providerId:
          network.providerId,

        phoneNumber:
          phone,
      },

      metadata: {
        withdrawal_id:
          withdrawalId,

        payment_transaction_id:
          paymentTransactionId,

        matmove_user_id:
          authenticatedUserId,

        idempotency_key:
          idempotencyKey,

        provider:
          'monime',

        network:
          network.name,
      },
    };

    /*
     * =========================================================
     * 9. Submit payout to Monime
     * =========================================================
     */
    let monimeResponse;

    try {
      providerRequestStarted =
        true;

      monimeResponse =
        await fetch(
          'https://api.monime.io/v1/payouts',
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
            },

            body:
              JSON.stringify(
                monimePayload
              ),
          }
        );
    } catch (
      providerNetworkError
    ) {
      /*
       * =======================================================
       * AMBIGUOUS PROVIDER OUTCOME
       * =======================================================
       *
       * A network failure cannot tell us whether Monime accepted
       * the payout.
       *
       * Therefore:
       *
       * - keep withdrawal pending
       * - keep funds reserved
       * - do not mark failed
       * - do not create another payout
       */
      console.error(
        'Monime payout network error:',
        providerNetworkError
      );

      return res.status(
        202
      ).json({
        status:
          'pending',

        withdrawal_id:
          withdrawalId,

        payment_transaction_id:
          paymentTransactionId,

        provider:
          'monime',

        message:
          'Withdrawal was secured but provider confirmation could not be determined. It remains pending for reconciliation.',
      });
    }

    /*
     * =========================================================
     * 10. Parse provider response
     * =========================================================
     */

    const responseText =
      await monimeResponse.text();

    let payoutData =
      null;

    try {
      payoutData =
        responseText
          ? JSON.parse(
              responseText
            )
          : null;
    } catch {
      payoutData = {
        raw:
          responseText,
      };
    }

    /*
     * =========================================================
     * 11. Definitive provider rejection
     * =========================================================
     *
     * Only a clear client-side rejection is treated as definitive
     * evidence that the payout was not accepted.
     */
    if (
      !monimeResponse.ok
    ) {
      console.error(
        'Monime payout rejected:',
        {
          status:
            monimeResponse.status,

          response:
            payoutData,

          withdrawalId,
        }
      );

      /*
       * 4xx = request definitely rejected.
       *
       * 5xx = provider/server outcome may be ambiguous.
       *
       * We therefore only release the MatMove reservation for
       * a definite 4xx rejection.
       */
      if (
        isProviderDefinitelyRejected(
          monimeResponse.status
        )
      ) {
        const rejection =
          await rejectWithdrawal(
            supabaseAdmin,
            withdrawalId,
            buildProviderErrorMessage(
              payoutData,
              monimeResponse.status
            )
          );

        if (
          !rejection.success
        ) {
          /*
           * Do not tell the customer the withdrawal was released
           * if MatMove itself could not release the reservation.
           */
          return res.status(
            202
          ).json({
            status:
              'pending',

            withdrawal_id:
              withdrawalId,

            message:
              'The payment provider rejected the payout, but MatMove is still reconciling the withdrawal.',
          });
        }

        return res.status(
          400
        ).json({
          error:
            'Mobile money payout was rejected by the payment provider.',

          withdrawal_id:
            withdrawalId,
        });
      }

      /*
       * 5xx and other non-definitive failures:
       *
       * Keep reservation intact.
       */
      return res.status(
        202
      ).json({
        status:
          'pending',

        withdrawal_id:
          withdrawalId,

        payment_transaction_id:
          paymentTransactionId,

        provider:
          'monime',

        message:
          'The payment provider did not return a definitive result. Your withdrawal remains pending for reconciliation.',
      });
    }

    /*
     * =========================================================
     * 12. Provider accepted the payout
     * =========================================================
     */

    const providerPayoutId =
      extractProviderPayoutId(
        payoutData
      );

    const providerStatus =
      extractProviderStatus(
        payoutData
      );

    /*
     * A successful HTTP response without a provider payout ID
     * is not enough to declare financial completion.
     *
     * The webhook must provide the authoritative final result.
     */
    if (
      !providerPayoutId
    ) {
      console.error(
        'Monime accepted payout request but no provider payout ID was returned.',
        {
          withdrawalId,
          providerStatus,
        }
      );

      return res.status(
        202
      ).json({
        status:
          'pending',

        withdrawal_id:
          withdrawalId,

        payment_transaction_id:
          paymentTransactionId,

        provider:
          'monime',

        provider_status:
          providerStatus ||
          'accepted',

        message:
          'Withdrawal was accepted for processing and remains pending until Monime confirms the final outcome.',
      });
    }

    /*
     * =========================================================
     * 13. Accepted is NOT completed
     * =========================================================
     *
     * Do not debit the wallet here.
     *
     * The Monime webhook will call:
     *
     * register_provider_webhook_event()
     *        ↓
     * process_provider_webhook_event()
     *        ↓
     * settle_wallet_withdrawal()
     *
     * Only that authoritative path completes the financial
     * settlement.
     */
    return res.status(
      200
    ).json({
      status:
        'pending',

      withdrawal_id:
        withdrawalId,

      payment_transaction_id:
        paymentTransactionId,

      provider:
        'monime',

      provider_payout_id:
        providerPayoutId,

      provider_status:
        providerStatus ||
        'pending',

      currency:
        'SLE',

      amount,

      network:
        network.name,

      message:
        'Withdrawal submitted successfully and is awaiting provider confirmation.',
    });
  } catch (
    error
  ) {
    console.error(
      'Monime payout API exception:',
      error
    );

    /*
     * =========================================================
     * CRITICAL FAILURE RULE
     * =========================================================
     *
     * Once the provider request may have started, never release
     * the reserved funds based solely on an application exception.
     *
     * The financial outcome must be reconciled from the provider.
     */
    if (
      providerRequestStarted &&
      withdrawalId
    ) {
      console.error(
        'Withdrawal remains pending because provider acceptance could not be determined:',
        withdrawalId
      );

      return res.status(
        202
      ).json({
        status:
          'pending',

        withdrawal_id:
          withdrawalId,

        payment_transaction_id:
          paymentTransactionId,

        provider:
          'monime',

        message:
          'Withdrawal remains pending for provider reconciliation.',
      });
    }

    /*
     * If the exception happened before the provider request
     * started, release the reservation.
     */
    if (
      withdrawalId
    ) {
      await rejectWithdrawal(
        supabaseAdmin,
        withdrawalId,
        'Withdrawal could not be submitted to the payment provider.'
      );
    }

    return res.status(
      500
    ).json({
      error:
        'Unable to process withdrawal request.',
    });
  }
}