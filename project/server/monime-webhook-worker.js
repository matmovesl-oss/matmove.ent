import { createClient } from '@supabase/supabase-js';
import { assertMonimeEnvironment } from './wallet-security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 12;

class ManualReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManualReviewError';
  }
}

function client() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase worker configuration missing.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getTransfer(id) {
  const token = process.env.MONIME_API_KEY;
  const space = process.env.MONIME_SPACE_ID;
  if (!token || !space) throw new Error('Monime worker configuration missing.');

  const response = await fetch(`https://api.monime.io/v1/internal-transfers/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Monime-Space-Id': space,
      'Monime-Version': 'caph.2025-08-23',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.result) throw new Error(`Monime transfer lookup failed (HTTP ${response.status}).`);
  return body.result;
}

async function processPurchaseTransfer(db, event) {
  // The purchase worker is deliberately restricted to the completed internal
  // transfer event. A signed event of another kind must not enter fulfilment
  // merely because its object happens to reference an internal transfer.
  if (event.event_type !== 'internal_transfer.completed') {
    throw new ManualReviewError('Unsupported Monime event type for purchase fulfilment; manual review required.');
  }

  const payload = event.payload;
  const object = payload?.object;
  if (object?.type !== 'internal_transfer' || typeof object.id !== 'string') {
    throw new ManualReviewError('Unsupported Monime event object type; manual review required.');
  }

  const transfer = await getTransfer(object.id);
  if (transfer.id !== object.id) throw new ManualReviewError('Monime returned a different transfer identifier; manual review required.');

  const paymentId = transfer.metadata?.matmovePurchasePaymentId;
  if (!UUID.test(String(paymentId || ''))) {
    throw new ManualReviewError('Internal transfer has no valid MatMove purchase-payment reference; manual review required.');
  }

  const { data: payment, error: paymentError } = await db
    .from('matmove_purchase_payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();

  if (paymentError || !payment) throw new Error('Referenced MatMove purchase payment was not found.');
  if (!['travel', 'event'].includes(payment.purchase_type)) {
    throw new ManualReviewError('Referenced record is not a travel or event purchase; manual review required.');
  }

  const matches =
    transfer.amount?.currency === payment.currency &&
    transfer.amount?.value === Number(payment.amount_minor) &&
    transfer.sourceFinancialAccount?.id === payment.source_account_id &&
    transfer.destinationFinancialAccount?.id === payment.destination_account_id &&
    (!payment.provider_transfer_id || payment.provider_transfer_id === transfer.id);

  if (!matches) throw new ManualReviewError('Monime transfer does not match the stored MatMove payment details; manual review required.');

  const status = String(transfer.status || '').toLowerCase();
  if (status === 'pending' || status === 'processing') {
    const { error } = await db.from('matmove_purchase_payments').update({
      state: 'processing',
      provider_status: status,
      provider_transfer_id: transfer.id,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    if (error) throw new Error('Could not record pending transfer status.');
    return 'pending';
  }

  if (status === 'failed') {
    if (payment.fulfilled_at) throw new ManualReviewError('Provider reports a failed transfer for an already fulfilled purchase; manual review required.');
    const { error } = await db.from('matmove_purchase_payments').update({
      state: 'failed',
      provider_status: 'failed',
      provider_transfer_id: transfer.id,
      failure_detail: transfer.failureDetail?.message || 'Monime reports that the transfer failed.',
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    if (error) throw new Error('Could not record failed transfer status.');
    return 'processed';
  }

  if (status !== 'completed') throw new ManualReviewError('Monime transfer status is not final; manual review required.');

  const { error: updateError } = await db.from('matmove_purchase_payments').update({
    state: 'completed',
    provider_status: 'completed',
    provider_transfer_id: transfer.id,
    updated_at: new Date().toISOString()
  }).eq('id', payment.id);
  if (updateError) throw new Error('Could not record completed transfer status.');

  const { data: result, error: fulfilError } = await db.rpc('matmove_fulfill_purchase_payment', {
    p_payment_id: payment.id
  });
  if (fulfilError || result?.fulfilled !== true) throw new Error('Protected purchase fulfilment did not confirm success.');

  const { data: confirmed, error: confirmError } = await db
    .from('matmove_purchase_payments')
    .select('fulfilled_at')
    .eq('id', payment.id)
    .single();
  if (confirmError || !confirmed?.fulfilled_at) throw new Error('Purchase fulfilment timestamp was not confirmed.');
  return 'processed';
}

export async function processMonimeWebhookBatch({ db = client(), limit = 3 } = {}) {
  // Validate Live/Test mode before claiming any durable inbox event.
  assertMonimeEnvironment();
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const batchLimit = Math.max(1, Math.min(25, limit));
  const [pendingResult, staleResult] = await Promise.all([
    db.from('matmove_monime_webhook_events')
      .select('event_id,event_type,object_id,object_type,payload,attempts,status,updated_at,signature_verified,last_error')
      .eq('status', 'pending')
      .order('received_at', { ascending: true })
      .limit(batchLimit),
    db.from('matmove_monime_webhook_events')
      .select('event_id,event_type,object_id,object_type,payload,attempts,status,updated_at,signature_verified,last_error')
      .eq('status', 'processing')
      .lt('updated_at', staleCutoff)
      .order('updated_at', { ascending: true })
      .limit(batchLimit)
  ]);

  if (pendingResult.error || staleResult.error) throw new Error('Could not read Monime webhook inbox.');
  const pending = [...(pendingResult.data || []), ...(staleResult.data || [])]
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    .slice(0, batchLimit);

  let processed = 0;
  let retrying = 0;
  let failed = 0;

  for (const event of pending || []) {
    const now = new Date().toISOString();
    const currentAttempts = Math.max(1, Number(event.attempts || 1));
    const firstPendingAttempt = event.status === 'pending' && !event.last_error && currentAttempts === 1;
    const nextAttempt = firstPendingAttempt ? currentAttempts : currentAttempts + 1;
    let claimQuery = db
      .from('matmove_monime_webhook_events')
      .update({ status: 'processing', attempts: nextAttempt, updated_at: now, last_error: null })
      .eq('event_id', event.event_id)
      .eq('status', event.status);
    if (event.status === 'processing') claimQuery = claimQuery.lt('updated_at', staleCutoff);
    const { data: claimed, error: claimError } = await claimQuery
      .select('event_id')
      .maybeSingle();

    if (claimError) throw new Error('Could not claim a Monime webhook event.');
    if (!claimed) continue;

    try {
      if (event.signature_verified !== true) {
        throw new ManualReviewError('Webhook event was not verified at ingress; manual review required.');
      }
      if (
        !event.payload ||
        event.payload.event?.id !== event.event_id ||
        event.payload.event?.name !== event.event_type ||
        event.payload.object?.id !== event.object_id ||
        event.payload.object?.type !== event.object_type
      ) {
        throw new ManualReviewError('Stored webhook payload failed its event and object identity check; manual review required.');
      }
      const result = await processPurchaseTransfer(db, event);
      if (result === 'pending') {
        const { error: queueError } = await db.from('matmove_monime_webhook_events')
          .update({ status: 'pending', updated_at: new Date().toISOString(), last_error: 'Monime transfer is not final yet.' })
          .eq('event_id', event.event_id);
        if (queueError) throw new Error('Could not return the pending Monime event to the queue.');
        retrying++;
      } else {
        const { error: queueError } = await db.from('matmove_monime_webhook_events')
          .update({ status: 'processed', processed_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null })
          .eq('event_id', event.event_id);
        if (queueError) throw new Error('Could not mark the Monime event as processed.');
        processed++;
      }
    } catch (error) {
      const manualReview = error instanceof ManualReviewError;
      const exhausted = manualReview || nextAttempt >= MAX_ATTEMPTS;
      const nextStatus = exhausted ? 'failed' : 'pending';
      const { error: queueError } = await db.from('matmove_monime_webhook_events')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
          last_error: String(error?.message || 'Webhook processing failed.').slice(0, 1000)
        })
        .eq('event_id', event.event_id);
      if (queueError) throw new Error('Could not persist the Monime event retry state.');
      if (exhausted) failed++;
      else retrying++;
    }
  }

  return { checked: (pending || []).length, processed, retrying, failed };
}
