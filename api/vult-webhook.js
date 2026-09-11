import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES =
  1024 * 1024;

function getHeader(req, name) {
  const value =
    req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

function timingSafeStringEqual(
  left,
  right
) {
  const leftBuffer =
    Buffer.from(
      String(left || ''),
      'utf8'
    );

  const rightBuffer =
    Buffer.from(
      String(right || ''),
      'utf8'
    );

  if (
    leftBuffer.length === 0 ||
    rightBuffer.length === 0 ||
    leftBuffer.length !==
      rightBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    leftBuffer,
    rightBuffer
  );
}

function readRawBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = '';
      let size = 0;
      let settled = false;

      req.setEncoding('utf8');

      req.on(
        'data',
        (chunk) => {
          if (settled) {
            return;
          }

          size += Buffer.byteLength(
            chunk,
            'utf8'
          );

          if (
            size >
            MAX_BODY_BYTES
          ) {
            settled = true;

            reject(
              new Error(
                'Webhook payload is too large.'
              )
            );

            req.destroy();
            return;
          }

          body += chunk;
        }
      );

      req.on(
        'end',
        () => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(body);
        }
      );

      req.on(
        'error',
        (error) => {
          if (settled) {
            return;
          }

          settled = true;
          reject(error);
        }
      );
    }
  );
}

function verifyBasicAuthentication(
  req
) {
  const expectedUsername =
    process.env.VULT_WEBHOOK_USERNAME;

  const expectedPassword =
    process.env.VULT_WEBHOOK_PASSWORD;

  if (
    !expectedUsername ||
    !expectedPassword
  ) {
    return {
      valid: false,
      reason:
        'Vult webhook credentials are not configured.',
    };
  }

  const authorization =
    getHeader(
      req,
      'authorization'
    );

  if (
    !authorization.startsWith(
      'Basic '
    )
  ) {
    return {
      valid: false,
      reason:
        'Missing Basic Authentication.',
    };
  }

  const encoded =
    authorization
      .slice(6)
      .trim();

  if (!encoded) {
    return {
      valid: false,
      reason:
        'Invalid Basic Authentication header.',
    };
  }

  let decoded;

  try {
    decoded =
      Buffer.from(
        encoded,
        'base64'
      ).toString(
        'utf8'
      );
  } catch {
    return {
      valid: false,
      reason:
        'Invalid Basic Authentication encoding.',
    };
  }

  const separator =
    decoded.indexOf(':');

  if (separator < 0) {
    return {
      valid: false,
      reason:
        'Invalid Basic Authentication credentials.',
    };
  }

  const username =
    decoded.slice(
      0,
      separator
    );

  const password =
    decoded.slice(
      separator + 1
    );

  const usernameValid =
    timingSafeStringEqual(
      username,
      expectedUsername
    );

  const passwordValid =
    timingSafeStringEqual(
      password,
      expectedPassword
    );

  return {
    valid:
      usernameValid &&
      passwordValid,

    reason:
      usernameValid &&
      passwordValid
        ? null
        : 'Invalid webhook credentials.',
  };
}

function firstString(
  ...values
) {
  for (const value of values) {
    if (
      typeof value === 'string' &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function normalizeStatus(
  status
) {
  const value =
    String(
      status || ''
    )
      .trim()
      .toLowerCase();

  if (
    value === 'completed'
  ) {
    return 'completed';
  }

  if (
    value === 'failed'
  ) {
    return 'failed';
  }

  return null;
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

async function findVultPayment(
  supabaseAdmin,
  orderId
) {
  const {
    data,
    error,
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
          'provider',
          'provider_reference',
          'idempotency_key',
          'amount',
          'currency',
          'status',
          'metadata',
        ].join(', ')
      )
      .eq(
        'provider',
        'vult'
      )
      .contains(
        'metadata',
        {
          order_id:
            orderId,
        }
      )
      .maybeSingle();

  return {
    payment:
      data || null,

    error,
  };
}

function buildNormalizedPayload(
  payload,
  paymentTransactionId,
  paymentTransaction
) {
  const orderId =
    firstString(
      payload?.orderId,
      payload?.order_id
    );

  const vultRequestId =
    firstString(
      payload?.vultRequestId,
      payload?.vult_request_id
    );

  const status =
    normalizeStatus(
      payload?.status
    );

  return {
    provider:
      'vult',

    event_type:
      `payment.${status}`,

    provider_event_id:
      vultRequestId,

    order_id:
      orderId,

    vult_request_id:
      vultRequestId,

    status,

    success:
      status === 'completed',

    payment_transaction_id:
      paymentTransactionId,

    provider_transaction_id:
      vultRequestId,

    idempotency_key:
      paymentTransaction?.idempotency_key ||
      null,

    provider_payload:
      payload,

    received_at:
      new Date().toISOString(),
  };
}

export default async function handler(
  req,
  res
) {
  /*
   * =========================================================
   * 1. Method
   * =========================================================
   */

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

  /*
   * =========================================================
   * 2. Authenticate Vult
   * =========================================================
   *
   * Vult's supplied merchant integration contract
   * protects the webhook with Basic Authentication.
   *
   * We validate it before accepting or processing
   * any provider event.
   */

  const authentication =
    verifyBasicAuthentication(
      req
    );

  if (
    !authentication.valid
  ) {
    console.error(
      'Rejected Vult webhook:',
      authentication.reason
    );

    return res.status(
      401
    ).json({
      error:
        'Unauthorized.',
    });
  }

  try {
    /*
     * =========================================================
     * 3. Read raw body
     * =========================================================
     */

    const rawBody =
      await readRawBody(
        req
      );

    if (
      !rawBody.trim()
    ) {
      return res.status(
        400
      ).json({
        error:
          'Webhook body is empty.',
      });
    }

    /*
     * =========================================================
     * 4. Parse Vult webhook
     * =========================================================
     *
     * Expected:
     *
     * {
     *   "orderId": "order-123",
     *   "vultRequestId": "123456",
     *   "status": "completed"
     * }
     */

    let payload;

    try {
      payload =
        JSON.parse(
          rawBody
        );
    } catch {
      return res.status(
        400
      ).json({
        error:
          'Invalid JSON payload.',
      });
    }

    const orderId =
      firstString(
        payload?.orderId,
        payload?.order_id
      );

    const vultRequestId =
      firstString(
        payload?.vultRequestId,
        payload?.vult_request_id
      );

    const status =
      normalizeStatus(
        payload?.status
      );

    if (!orderId) {
      console.error(
        'Vult webhook missing orderId.'
      );

      return res.status(
        400
      ).json({
        error:
          'orderId is required.',
      });
    }

    if (!vultRequestId) {
      console.error(
        'Vult webhook missing vultRequestId.'
      );

      return res.status(
        400
      ).json({
        error:
          'vultRequestId is required.',
      });
    }

    if (!status) {
      console.error(
        'Vult webhook contains unsupported status:',
        payload?.status
      );

      return res.status(
        400
      ).json({
        error:
          'Unsupported Vult webhook status.',
      });
    }

    /*
     * =========================================================
     * 5. Supabase service client
     * =========================================================
     */

    const supabaseAdmin =
      getSupabaseAdmin();

    /*
     * =========================================================
     * 6. Match provider order to MatMove payment
     * =========================================================
     *
     * The orderId is generated by MatMove and stored
     * inside payment_transactions.metadata.
     */

    const {
      payment:
        paymentTransaction,
      error:
        paymentLookupError,
    } =
      await findVultPayment(
        supabaseAdmin,
        orderId
      );

    if (
      paymentLookupError
    ) {
      console.error(
        'Vult payment lookup failed:',
        paymentLookupError
      );

      /*
       * We cannot safely register the event as
       * financially linked while the authoritative
       * payment lookup is unavailable.
       */
      return res.status(
        500
      ).json({
        error:
          'Unable to reconcile Vult order.',
      });
    }

    const paymentTransactionId =
      paymentTransaction?.id ||
      null;

    /*
     * =========================================================
     * 7. Build durable provider event
     * =========================================================
     */

    const normalizedPayload =
      buildNormalizedPayload(
        payload,
        paymentTransactionId,
        paymentTransaction
      );

    const eventType =
      `payment.${status}`;

    /*
     * =========================================================
     * 8. Register provider event
     * =========================================================
     *
     * The provider event is stored before financial settlement.
     *
     * This gives MatMove a durable reconciliation trail.
     */

    const {
      data:
        registration,
      error:
        registrationError,
    } =
      await supabaseAdmin.rpc(
        'register_provider_webhook_event',
        {
          p_provider:
            'vult',

          p_event_id:
            vultRequestId,

          p_event_type:
            eventType,

          p_withdrawal_id:
            null,

          p_payment_transaction_id:
            paymentTransactionId,

          p_provider_transaction_id:
            vultRequestId,

          p_idempotency_key:
            paymentTransaction?.idempotency_key ||
            null,

          p_payload:
            normalizedPayload,
        }
      );

    if (
      registrationError
    ) {
      console.error(
        'Vult webhook registration failed:',
        registrationError
      );

      return res.status(
        500
      ).json({
        error:
          'Failed to register Vult webhook event.',
      });
    }

    if (
      !registration?.success
    ) {
      console.error(
        'Vult webhook registration was unsuccessful:',
        registration
      );

      return res.status(
        500
      ).json({
        error:
          'Vult webhook registration was unsuccessful.',
      });
    }

    /*
     * =========================================================
     * 9. Duplicate event
     * =========================================================
     */

    if (
      registration.duplicate
    ) {
      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        duplicate:
          true,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status,

        payment_transaction_id:
          paymentTransactionId,

        message:
          'Vult webhook was already registered.',
      });
    }

    /*
     * =========================================================
     * 10. Vult failed payment
     * =========================================================
     *
     * According to the Vult merchant flow already established
     * for MatMove, a failed card attempt must not create
     * wallet funds.
     *
     * We deliberately do NOT call settle_wallet_topup().
     */

    if (
      status === 'failed'
    ) {
      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status:
          'failed',

        payment_transaction_id:
          paymentTransactionId,

        message:
          'Vult reported a failed payment. No wallet credit was performed. The MatMove payment remains available for retry/reconciliation.',
      });
    }

    /*
     * =========================================================
     * 11. Completed event without matching payment
     * =========================================================
     *
     * SECURITY BOUNDARY:
     *
     * Never create a wallet credit from a provider callback
     * unless there is a corresponding MatMove payment intent.
     */

    if (
      !paymentTransaction
    ) {
      console.error(
        'Vult completed webhook has no matching MatMove payment transaction:',
        {
          orderId,
          vultRequestId,
        }
      );

      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status:
          'completed',

        message:
          'Vult payment completed but no matching MatMove payment transaction was found. No wallet credit was performed.',
      });
    }

    /*
     * =========================================================
     * 12. Validate provider and payment identity
     * =========================================================
     */

    if (
      paymentTransaction.provider !==
      'vult'
    ) {
      console.error(
        'Vult webhook matched a non-Vult payment:',
        {
          paymentTransactionId,
          provider:
            paymentTransaction.provider,
        }
      );

      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        message:
          'Provider mismatch. No wallet credit was performed.',
      });
    }

    /*
     * =========================================================
     * 13. Validate payment transaction type
     * =========================================================
     */

    const transactionType =
      String(
        paymentTransaction.transaction_type ||
          ''
      )
        .trim()
        .toLowerCase();

    if (
      ![
        'wallet_topup',
        'topup',
      ].includes(
        transactionType
      )
    ) {
      console.error(
        'Vult webhook matched an unsupported transaction type:',
        {
          paymentTransactionId,
          transactionType,
        }
      );

      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        message:
          'Transaction is not a MatMove wallet top-up. No wallet credit was performed.',
      });
    }

    /*
     * =========================================================
     * 14. Already completed
     * =========================================================
     *
     * This is an idempotent success path.
     */

    if (
      paymentTransaction.status ===
      'completed'
    ) {
      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          true,

        duplicate:
          true,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status:
          'completed',

        payment_transaction_id:
          paymentTransactionId,

        message:
          'MatMove payment was already completed.',
      });
    }

    /*
     * =========================================================
     * 15. Only pending payments may be settled
     * =========================================================
     */

    if (
      paymentTransaction.status !==
      'pending'
    ) {
      console.error(
        'Vult completed webhook resolved to a non-pending payment:',
        {
          paymentTransactionId,

          paymentStatus:
            paymentTransaction.status,
        }
      );

      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status:
          'completed',

        payment_transaction_id:
          paymentTransactionId,

        message:
          'Payment is not pending. No wallet credit was performed.',
      });
    }

    /*
     * =========================================================
     * 16. Secure financial settlement
     * =========================================================
     *
     * This is the ONLY point in this webhook where
     * MatMove wallet funds can be created.
     *
     * settle_wallet_topup() performs the protected
     * accounting operation and is responsible for:
     *
     * - service-role authorization
     * - payment locking
     * - provider validation
     * - wallet ownership validation
     * - currency validation
     * - frozen-wallet validation
     * - treasury accounting
     * - balanced ledger entries
     * - wallet credit
     * - wallet transaction creation
     * - payment completion
     * - idempotency
     */

    const {
      data:
        settlement,
      error:
        settlementError,
    } =
      await supabaseAdmin.rpc(
        'settle_wallet_topup',
        {
          p_payment_transaction_id:
            paymentTransactionId,

          p_provider_transaction_id:
            vultRequestId,

          p_provider_response:
            normalizedPayload,
        }
      );

    if (
      settlementError
    ) {
      console.error(
        'Vult wallet settlement failed:',
        {
          error:
            settlementError,

          paymentTransactionId,

          orderId,

          vultRequestId,
        }
      );

      /*
       * Vult's webhook is already durably registered.
       *
       * Do not create a second wallet credit here.
       * Do not fabricate a successful settlement.
       *
       * The event remains available for reconciliation.
       */
      return res.status(
        200
      ).json({
        received:
          true,

        registered:
          true,

        processed:
          false,

        provider:
          'vult',

        event_id:
          vultRequestId,

        order_id:
          orderId,

        status:
          'completed',

        payment_transaction_id:
          paymentTransactionId,

        message:
          'Vult payment was confirmed, but wallet settlement requires reconciliation.',
      });
    }

    /*
     * =========================================================
     * 17. Successful settlement
     * =========================================================
     */

    return res.status(
      200
    ).json({
      received:
        true,

      registered:
        true,

      processed:
        true,

      provider:
        'vult',

      event_id:
        vultRequestId,

      order_id:
        orderId,

      status:
        'completed',

      payment_transaction_id:
        paymentTransactionId,

      settlement,
    });
  } catch (error) {
    console.error(
      'Vult webhook exception:',
      error
    );

    return res.status(
      500
    ).json({
      error:
        'Internal Server Error.',
    });
  }
}