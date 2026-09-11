import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TIMESTAMP_AGE_SECONDS = 300;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }

      size += Buffer.byteLength(
        chunk,
        'utf8'
      );

      if (size > MAX_BODY_BYTES) {
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
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(body);
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function getHeader(req, name) {
  const value =
    req.headers[
      name.toLowerCase()
    ];

  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

function firstString(...values) {
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

function parseSignatureHeader(header) {
  const value = String(
    header || ''
  ).trim();

  if (!value) {
    return {
      timestamp: null,
      signatures: [],
    };
  }

  /*
   * Supports:
   *
   * t=...,v1=...
   * timestamp=...,signature=...
   * ts=...,sig=...
   *
   * Also supports a bare sha256=<digest>
   * or a bare digest.
   */
  const parts = {};

  for (
    const part of value.split(',')
  ) {
    const separatorIndex =
      part.indexOf('=');

    if (
      separatorIndex === -1
    ) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          separatorIndex
        )
        .trim();

    const val =
      part
        .slice(
          separatorIndex + 1
        )
        .trim();

    if (key && val) {
      parts[key] = val;
    }
  }

  const signatures = [
    parts.v1,
    parts.signature,
    parts.sig,
  ].filter(
    (item) =>
      typeof item === 'string' &&
      item.trim()
  );

  if (
    signatures.length === 0 &&
    value
  ) {
    signatures.push(
      value.startsWith(
        'sha256='
      )
        ? value.slice(7)
        : value
    );
  }

  return {
    timestamp:
      parts.t ||
      parts.timestamp ||
      parts.ts ||
      null,

    signatures,
  };
}

function safeTimingEqual(
  expected,
  received
) {
  if (
    !Buffer.isBuffer(expected) ||
    !Buffer.isBuffer(received) ||
    expected.length === 0 ||
    received.length === 0 ||
    expected.length !==
      received.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expected,
    received
  );
}

function signatureMatches(
  expectedHex,
  expectedBase64,
  receivedSignature
) {
  let received = String(
    receivedSignature || ''
  ).trim();

  if (!received) {
    return false;
  }

  if (
    received.startsWith(
      'sha256='
    )
  ) {
    received =
      received.slice(7);
  }

  /*
   * Hex HMAC-SHA256.
   */
  if (
    /^[a-fA-F0-9]{64}$/.test(
      received
    )
  ) {
    return safeTimingEqual(
      Buffer.from(
        expectedHex,
        'hex'
      ),
      Buffer.from(
        received,
        'hex'
      )
    );
  }

  /*
   * Base64 HMAC-SHA256.
   */
  try {
    const receivedBuffer =
      Buffer.from(
        received,
        'base64'
      );

    const expectedBuffer =
      Buffer.from(
        expectedBase64,
        'base64'
      );

    return safeTimingEqual(
      expectedBuffer,
      receivedBuffer
    );
  } catch {
    return false;
  }
}

function buildHmac(
  secret,
  payload
) {
  return crypto
    .createHmac(
      'sha256',
      secret
    )
    .update(
      payload,
      'utf8'
    );
}

function timestampIsValid(
  timestamp
) {
  if (
    timestamp === null ||
    timestamp === undefined ||
    timestamp === ''
  ) {
    return true;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }

  /*
   * Some providers express timestamps
   * in seconds while others use milliseconds.
   */
  const timestampSeconds =
    timestampNumber > 100000000000
      ? Math.floor(
          timestampNumber / 1000
        )
      : Math.floor(
          timestampNumber
        );

  const nowSeconds =
    Math.floor(
      Date.now() / 1000
    );

  return (
    Math.abs(
      nowSeconds -
        timestampSeconds
    ) <=
    MAX_TIMESTAMP_AGE_SECONDS
  );
}

/*
 * -------------------------------------------------------------
 * Monime signature verification
 * -------------------------------------------------------------
 *
 * The production webhook secret must never be exposed to the
 * browser.
 *
 * We support the timestamped construction already used by the
 * MatMove integration:
 *
 *     timestamp + "." + rawBody
 *
 * We also support raw-body HMAC because the currently available
 * provider material does not establish that every Monime webhook
 * configuration uses the timestamped construction.
 *
 * MONIME_WEBHOOK_SIGNATURE_MODE may optionally be set to:
 *
 *   timestamp
 *   raw
 *   auto
 *
 * Default:
 *
 *   auto
 *
 * In auto mode, the timestamped construction is checked first,
 * then raw-body HMAC is checked.
 *
 * Once Monime confirms the exact production webhook signing
 * contract for this merchant, set the environment variable to
 * the exact required mode.
 * -------------------------------------------------------------
 */
function verifyMonimeSignature(
  rawBody,
  signatureHeader,
  secret
) {
  if (!signatureHeader) {
    return {
      valid: false,
      reason:
        'Missing Monime-Signature header.',
    };
  }

  if (!secret) {
    return {
      valid: false,
      reason:
        'Missing Monime webhook secret.',
    };
  }

  const {
    timestamp,
    signatures,
  } =
    parseSignatureHeader(
      signatureHeader
    );

  if (
    signatures.length === 0
  ) {
    return {
      valid: false,
      reason:
        'No usable webhook signature found.',
    };
  }

  if (
    !timestampIsValid(
      timestamp
    )
  ) {
    return {
      valid: false,
      reason:
        'Webhook timestamp is outside the allowed replay window.',
    };
  }

  const mode =
    String(
      process.env
        .MONIME_WEBHOOK_SIGNATURE_MODE ||
        'auto'
    )
      .trim()
      .toLowerCase();

  const candidates = [];

  /*
   * Timestamp + body construction.
   */
  if (
    timestamp &&
    (
      mode ===
        'timestamp' ||
      mode === 'auto'
    )
  ) {
    candidates.push(
      buildHmac(
        secret,
        `${timestamp}.${rawBody}`
      )
    );
  }

  /*
   * Raw body construction.
   */
  if (
    mode === 'raw' ||
    mode === 'auto'
  ) {
    candidates.push(
      buildHmac(
        secret,
        rawBody
      )
    );
  }

  if (
    candidates.length === 0
  ) {
    return {
      valid: false,
      reason:
        'Unsupported webhook signature mode.',
    };
  }

  for (
    const hmac of candidates
  ) {
    const expectedHex =
      hmac.digest('hex');

    const expectedBase64 =
      buildHmac(
        secret,
        mode ===
          'timestamp'
          ? `${timestamp}.${rawBody}`
          : rawBody
      ).digest('base64');

    for (
      const signature of signatures
    ) {
      if (
        signatureMatches(
          expectedHex,
          expectedBase64,
          signature
        )
      ) {
        return {
          valid: true,
          reason: null,
          mode,
          timestamp:
            timestamp || null,
        };
      }
    }
  }

  return {
    valid: false,
    reason:
      'Webhook signature mismatch.',
  };
}

/*
 * -------------------------------------------------------------
 * Payload helpers
 * -------------------------------------------------------------
 */

function getCandidateObjects(
  payload
) {
  return [
    payload,
    payload?.event,
    payload?.object,
    payload?.data,
    payload?.data?.object,
    payload?.data?.resource,
    payload?.resource,
  ].filter(Boolean);
}

function getEventId(payload) {
  return firstString(
    payload?.event?.id,
    payload?.event?.eventId,
    payload?.event?.event_id,
    payload?.eventId,
    payload?.event_id,
    payload?.id
  );
}

function getEventType(payload) {
  return firstString(
    payload?.event?.name,
    payload?.event?.type,
    payload?.event?.eventType,
    payload?.event?.event_type,
    payload?.eventType,
    payload?.event_type,
    payload?.type,
    payload?.name
  );
}

function findNestedMetadata(
  payload
) {
  const candidates =
    getCandidateObjects(
      payload
    );

  for (
    const candidate of candidates
  ) {
    if (
      candidate?.metadata &&
      typeof candidate.metadata ===
        'object'
    ) {
      return candidate.metadata;
    }
  }

  return {};
}

function extractWithdrawalId(
  payload
) {
  const metadata =
    findNestedMetadata(
      payload
    );

  const candidates =
    getCandidateObjects(
      payload
    );

  for (
    const candidate of candidates
  ) {
    const value =
      firstString(
        candidate?.withdrawal_id,
        candidate?.withdrawalId,
        candidate?.matmove_withdrawal_id,
        candidate?.matmoveWithdrawalId
      );

    if (value) {
      return value;
    }
  }

  return firstString(
    metadata.withdrawal_id,
    metadata.withdrawalId,
    metadata.matmove_withdrawal_id,
    metadata.matmoveWithdrawalId
  );
}

function extractPaymentTransactionId(
  payload
) {
  const metadata =
    findNestedMetadata(
      payload
    );

  const candidates =
    getCandidateObjects(
      payload
    );

  for (
    const candidate of candidates
  ) {
    const value =
      firstString(
        candidate?.payment_transaction_id,
        candidate?.paymentTransactionId,
        candidate?.matmove_payment_transaction_id,
        candidate?.matmovePaymentTransactionId
      );

    if (value) {
      return value;
    }
  }

  return firstString(
    metadata.payment_transaction_id,
    metadata.paymentTransactionId,
    metadata.matmove_payment_transaction_id,
    metadata.matmovePaymentTransactionId
  );
}

function extractCheckoutSessionId(
  payload
) {
  const candidates =
    getCandidateObjects(
      payload
    );

  for (
    const candidate of candidates
  ) {
    const value =
      firstString(
        candidate?.checkoutSessionId,
        candidate?.checkout_session_id,
        candidate?.checkoutSession?.id,
        candidate?.checkout_session?.id,
        candidate?.checkout_session
      );

    if (value) {
      return value;
    }
  }

  return firstString(
    payload?.object?.id,
    payload?.data?.object?.id,
    payload?.data?.resource?.id
  );
}

function extractProviderTransactionId(
  payload
) {
  const candidates =
    getCandidateObjects(
      payload
    );

  /*
   * For checkout events, the checkout-session
   * ID is the provider reference we can use
   * to reconcile the payment.
   */
  const checkoutSessionId =
    extractCheckoutSessionId(
      payload
    );

  if (
    checkoutSessionId
  ) {
    return checkoutSessionId;
  }

  for (
    const candidate of candidates
  ) {
    const value =
      firstString(
        candidate?.providerTransactionId,
        candidate?.provider_transaction_id,
        candidate?.payoutId,
        candidate?.payout_id,
        candidate?.transactionId,
        candidate?.transaction_id,
        candidate?.paymentId,
        candidate?.payment_id
      );

    if (value) {
      return value;
    }
  }

  return null;
}

function extractIdempotencyKey(
  payload
) {
  const metadata =
    findNestedMetadata(
      payload
    );

  const candidates =
    getCandidateObjects(
      payload
    );

  for (
    const candidate of candidates
  ) {
    const value =
      firstString(
        candidate?.idempotency_key,
        candidate?.idempotencyKey
      );

    if (value) {
      return value;
    }
  }

  return firstString(
    metadata.idempotency_key,
    metadata.idempotencyKey
  );
}

/*
 * -------------------------------------------------------------
 * Event classification
 * -------------------------------------------------------------
 */

function normalizedEventType(
  eventType
) {
  return String(
    eventType || ''
  )
    .trim()
    .toLowerCase();
}

function isPayoutEvent(
  eventType
) {
  return normalizedEventType(
    eventType
  ).startsWith(
    'payout.'
  );
}

function isCheckoutCompletedEvent(
  eventType
) {
  return [
    'checkout_session.completed',
    'checkout.session.completed',
    'checkout.completed',
  ].includes(
    normalizedEventType(
      eventType
    )
  );
}

function isCheckoutExpiredEvent(
  eventType
) {
  return [
    'checkout_session.expired',
    'checkout.session.expired',
    'checkout.expired',
  ].includes(
    normalizedEventType(
      eventType
    )
  );
}

function isCheckoutCancelledEvent(
  eventType
) {
  return [
    'checkout_session.cancelled',
    'checkout_session.canceled',
    'checkout.session.cancelled',
    'checkout.session.canceled',
    'checkout.cancelled',
    'checkout.canceled',
  ].includes(
    normalizedEventType(
      eventType
    )
  );
}

function isTerminalPayoutEvent(
  eventType
) {
  return [
    'payout.completed',
    'payout.failed',
    'payout.cancelled',
    'payout.canceled',
    'payout.rejected',
  ].includes(
    normalizedEventType(
      eventType
    )
  );
}

function isSuccessfulPayoutEvent(
  eventType
) {
  return (
    normalizedEventType(
      eventType
    ) ===
    'payout.completed'
  );
}

/*
 * -------------------------------------------------------------
 * Normalized internal provider payload
 * -------------------------------------------------------------
 */

function buildNormalizedPayload(
  originalPayload,
  eventType
) {
  const normalizedEvent =
    normalizedEventType(
      eventType
    );

  const providerTransactionId =
    extractProviderTransactionId(
      originalPayload
    );

  const success =
    isCheckoutCompletedEvent(
      eventType
    ) ||
    isSuccessfulPayoutEvent(
      eventType
    );

  const failed =
    isCheckoutExpiredEvent(
      eventType
    ) ||
    isCheckoutCancelledEvent(
      eventType
    ) ||
    [
      'payout.failed',
      'payout.cancelled',
      'payout.canceled',
      'payout.rejected',
    ].includes(
      normalizedEvent
    );

  return {
    success:
      success === true,

    provider:
      'monime',

    event_type:
      eventType,

    provider_event_id:
      getEventId(
        originalPayload
      ),

    provider_transaction_id:
      providerTransactionId,

    withdrawal_id:
      extractWithdrawalId(
        originalPayload
      ),

    payment_transaction_id:
      extractPaymentTransactionId(
        originalPayload
      ),

    idempotency_key:
      extractIdempotencyKey(
        originalPayload
      ),

    failure_code:
      failed
        ? 'PROVIDER_FAILED'
        : null,

    failure_message:
      failed
        ? `Monime event ${eventType}.`
        : null,

    provider_payload:
      originalPayload,
  };
}

/*
 * -------------------------------------------------------------
 * Payment lookup
 * -------------------------------------------------------------
 */

async function findPaymentTransaction(
  supabaseAdmin,
  paymentTransactionId,
  providerTransactionId
) {
  if (
    paymentTransactionId
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
            'amount',
            'currency',
            'status',
            'idempotency_key',
            'provider_reference',
            'metadata',
          ].join(', ')
        )
        .eq(
          'id',
          paymentTransactionId
        )
        .eq(
          'provider',
          'monime'
        )
        .maybeSingle();

    if (error) {
      return {
        payment:
          null,
        error,
      };
    }

    if (data) {
      return {
        payment:
          data,
        error:
          null,
      };
    }
  }

  if (
    providerTransactionId
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
            'amount',
            'currency',
            'status',
            'idempotency_key',
            'provider_reference',
            'metadata',
          ].join(', ')
        )
        .eq(
          'provider',
          'monime'
        )
        .eq(
          'provider_reference',
          providerTransactionId
        )
        .maybeSingle();

    if (error) {
      return {
        payment:
          null,
        error,
      };
    }

    return {
      payment:
        data ||
        null,
      error:
        null,
    };
  }

  return {
    payment:
      null,
    error:
      null,
  };
}

/*
 * -------------------------------------------------------------
 * Handler
 * -------------------------------------------------------------
 */

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

  const webhookSecret =
    process.env
      .MONIME_WEBHOOK_SECRET;

  const supabaseUrl =
    process.env
      .SUPABASE_URL ||
    process.env
      .VITE_SUPABASE_URL;

  const supabaseServiceRoleKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;

  if (!webhookSecret) {
    console.error(
      'MONIME_WEBHOOK_SECRET is not configured.'
    );

    return res.status(
      500
    ).json({
      error:
        'Webhook configuration error.',
    });
  }

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    console.error(
      'Supabase server environment variables are not configured.'
    );

    return res.status(
      500
    ).json({
      error:
        'Financial service configuration error.',
    });
  }

  try {
    /*
     * =========================================================
     * 1. Read exact raw body
     * =========================================================
     */

    const rawBody =
      await readRawBody(
        req
      );

    /*
     * =========================================================
     * 2. Verify webhook signature BEFORE JSON parsing
     * =========================================================
     */

    const signatureHeader =
      getHeader(
        req,
        'monime-signature'
      );

    const verification =
      verifyMonimeSignature(
        rawBody,
        signatureHeader,
        webhookSecret
      );

    if (
      !verification.valid
    ) {
      console.error(
        'Rejected Monime webhook:',
        verification.reason
      );

      return res.status(
        401
      ).json({
        error:
          'Invalid webhook signature.',
      });
    }

    /*
     * =========================================================
     * 3. Parse verified JSON
     * =========================================================
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

    const eventId =
      getEventId(
        payload
      );

    const eventType =
      getEventType(
        payload
      );

    if (
      !eventId ||
      !eventType
    ) {
      return res.status(
        400
      ).json({
        error:
          'Monime event ID or event type is missing.',
      });
    }

    const withdrawalId =
      extractWithdrawalId(
        payload
      );

    const paymentTransactionId =
      extractPaymentTransactionId(
        payload
      );

    const providerTransactionId =
      extractProviderTransactionId(
        payload
      );

    const idempotencyKey =
      extractIdempotencyKey(
        payload
      );

    const normalizedPayload =
      buildNormalizedPayload(
        payload,
        eventType
      );

    /*
     * =========================================================
     * 4. Service-role Supabase client
     * =========================================================
     */

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        supabaseServiceRoleKey,
        {
          auth: {
            autoRefreshToken:
              false,
            persistSession:
              false,
          },
        }
      );

    /*
     * =========================================================
     * 5. Register authenticated provider event
     * =========================================================
     */

    const {
      data: registration,
      error:
        registrationError,
    } =
      await supabaseAdmin.rpc(
        'register_provider_webhook_event',
        {
          p_provider:
            'monime',

          p_event_id:
            eventId,

          p_event_type:
            eventType,

          p_withdrawal_id:
            withdrawalId,

          p_payment_transaction_id:
            paymentTransactionId,

          p_provider_transaction_id:
            providerTransactionId,

          p_idempotency_key:
            idempotencyKey,

          p_payload:
            normalizedPayload,
        }
      );

    if (
      registrationError
    ) {
      console.error(
        'Monime webhook registration failed:',
        registrationError
      );

      return res.status(
        500
      ).json({
        error:
          'Failed to register webhook event.',
      });
    }

    if (
      !registration?.success
    ) {
      return res.status(
        500
      ).json({
        error:
          'Webhook event registration was not successful.',
      });
    }

    const internalEventId =
      registration.event_id;

    if (
      !internalEventId
    ) {
      return res.status(
        500
      ).json({
        error:
          'Webhook registration returned an invalid event identifier.',
      });
    }

    /*
     * =========================================================
     * 6. Completed wallet top-up
     * =========================================================
     */

    if (
      isCheckoutCompletedEvent(
        eventType
      )
    ) {
      const {
        payment,
        error:
          paymentLookupError,
      } =
        await findPaymentTransaction(
          supabaseAdmin,
          paymentTransactionId,
          providerTransactionId
        );

      if (
        paymentLookupError
      ) {
        console.error(
          'Monime payment lookup failed:',
          paymentLookupError
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
          event_id:
            eventId,
          event_type:
            eventType,
          reason:
            'Payment lookup failed after webhook registration. Event retained for reconciliation.',
        });
      }

      if (!payment) {
        /*
         * SECURITY:
         *
         * Never create a wallet transaction from an unmatched
         * provider webhook.
         */
        console.error(
          'Completed Monime checkout has no matching MatMove payment transaction.',
          {
            eventId,
            eventType,
            paymentTransactionId,
            providerTransactionId,
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
          event_id:
            eventId,
          event_type:
            eventType,
          reason:
            'No matching MatMove payment transaction found. No wallet credit performed.',
        });
      }

      /*
       * Idempotent duplicate.
       */
      if (
        payment.status ===
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
          event_id:
            eventId,
          event_type:
            eventType,
          payment_transaction_id:
            payment.id,
          reason:
            'Wallet top-up was already settled.',
        });
      }

      /*
       * Only pending top-ups may settle.
       */
      if (
        payment.status !==
        'pending'
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
          event_id:
            eventId,
          event_type:
            eventType,
          payment_transaction_id:
            payment.id,
          reason:
            'Payment is not pending. No wallet credit performed.',
        });
      }

      /*
       * The secure settlement RPC performs:
       *
       * - ownership validation
       * - wallet validation
       * - currency validation
       * - frozen-wallet validation
       * - treasury validation
       * - ledger debit/credit
       * - wallet credit
       * - wallet transaction
       * - payment completion
       *
       * The browser never participates in any of this.
       */
      const {
        data: settlement,
        error:
          settlementError,
      } =
        await supabaseAdmin.rpc(
          'settle_wallet_topup',
          {
            p_payment_transaction_id:
              payment.id,

            p_provider_transaction_id:
              providerTransactionId ||
              null,

            p_provider_response:
              normalizedPayload,
          }
        );

      if (
        settlementError
      ) {
        console.error(
          'Monime wallet top-up settlement failed:',
          {
            error:
              settlementError,
            eventId,
            paymentTransactionId:
              payment.id,
          }
        );

        /*
         * Provider confirmation is preserved in the webhook-event
         * table. Do not fabricate a financial success response.
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
          event_id:
            eventId,
          event_type:
            eventType,
          payment_transaction_id:
            payment.id,
          reason:
            'Provider payment was confirmed, but wallet settlement failed. Event retained for reconciliation.',
        });
      }

      return res.status(
        200
      ).json({
        received:
          true,
        registered:
          true,
        processed:
          true,
        event_id:
          eventId,
        event_type:
          eventType,
        payment_transaction_id:
          payment.id,
        settlement,
      });
    }

    /*
     * =========================================================
     * 7. Expired/cancelled checkout
     * =========================================================
     *
     * No wallet credit.
     *
     * We don't blindly mark the MatMove payment failed here because
     * the exact provider lifecycle may contain additional retry/
     * reconciliation states.
     */

    if (
      isCheckoutExpiredEvent(
        eventType
      ) ||
      isCheckoutCancelledEvent(
        eventType
      )
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
        event_id:
          eventId,
        event_type:
          eventType,
        reason:
          'Checkout ended without successful completion. No wallet credit performed.',
      });
    }

    /*
     * =========================================================
     * 8. Ignore unrelated Monime events
     * =========================================================
     */

    if (
      !isPayoutEvent(
        eventType
      )
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
        event_id:
          eventId,
        event_type:
          eventType,
        reason:
          'Monime event registered. No MatMove financial settlement was required.',
      });
    }

    /*
     * =========================================================
     * 9. Non-terminal payout event
     * =========================================================
     */

    if (
      !isTerminalPayoutEvent(
        eventType
      )
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
        event_id:
          eventId,
        event_type:
          eventType,
        reason:
          'Payout event is not terminal.',
      });
    }

    /*
     * =========================================================
     * 10. Terminal payout mapping
     * =========================================================
     */

    if (
      !withdrawalId
    ) {
      console.error(
        'Terminal Monime payout event is missing MatMove withdrawal ID.',
        {
          eventId,
          eventType,
          providerTransactionId,
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
        event_id:
          eventId,
        event_type:
          eventType,
        reason:
          'Terminal payout event has no MatMove withdrawal ID.',
      });
    }

    /*
     * =========================================================
     * 11. Secure payout processing
     * =========================================================
     *
     * process_provider_webhook_event() is the financial
     * authority. It calls the protected settlement function
     * rather than allowing this API route to update wallets.
     */
    const {
      data: processingResult,
      error:
        processingError,
    } =
      await supabaseAdmin.rpc(
        'process_provider_webhook_event',
        {
          p_event_id:
            internalEventId,
        }
      );

    if (
      processingError
    ) {
      console.error(
        'Monime payout financial processing failed:',
        {
          error:
            processingError,
          eventId,
          withdrawalId,
        }
      );

      /*
       * Event is already durable and can be reconciled/reprocessed.
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
        event_id:
          eventId,
        event_type:
          eventType,
        reason:
          'Payout financial processing failed. Event retained for reconciliation.',
      });
    }

    return res.status(
      200
    ).json({
      received:
        true,
      registered:
        true,
      processed:
        true,
      event_id:
        eventId,
      event_type:
        eventType,
      settlement:
        processingResult,
    });
  } catch (error) {
    console.error(
      'Monime webhook exception:',
      error
    );

    /*
     * We intentionally do not expose internal errors or database
     * details to the provider.
     */
    return res.status(
      500
    ).json({
      error:
        'Internal Server Error.',
    });
  }
}