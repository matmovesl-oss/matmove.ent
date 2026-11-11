import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { normalizeEnvelope, readRawBody, verifyMonimeSignature } from '../server/monime-webhook-inbox.js';
import { processMonimeWebhookBatch } from '../server/monime-webhook-worker.js';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60
};

function hasValidCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) return false;

  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(String(req.headers?.authorization || ''), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function runWorker(req, res) {
  if (!hasValidCronAuthorization(req)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await processMonimeWebhookBatch({ limit: 3 });
    return res.status(result.failed > 0 ? 503 : 200).json(result);
  } catch (error) {
    console.error('Monime webhook worker failed', { failure: 'worker_unavailable' });
    return res.status(503).json({ error: 'Webhook worker unavailable.' });
  }
}

async function receiveWebhook(req, res) {
  const secret = process.env.MONIME_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || secret.length < 32 || secret.length > 256 || !supabaseUrl || !serviceRoleKey) {
    // Fail closed. Do not accept unsigned events or acknowledge an event we cannot store.
    return res.status(503).json({ error: 'Webhook endpoint is not configured.' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(413).json({ error: 'Invalid webhook body.' });
  }

  const signature = req.headers?.['monime-signature'];
  if (!verifyMonimeSignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  let normalized;
  try {
    const envelope = JSON.parse(rawBody.toString('utf8'));
    normalized = normalizeEnvelope(envelope);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook event.' });
  }

  const timestamp = normalized.eventTimestamp && Number.isFinite(Date.parse(normalized.eventTimestamp))
    ? new Date(normalized.eventTimestamp).toISOString()
    : null;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { error } = await supabase
      .from('matmove_monime_webhook_events')
      .upsert({
        event_id: normalized.eventId,
        event_type: normalized.eventType,
        object_id: normalized.objectId,
        object_type: normalized.objectType,
        event_timestamp: timestamp,
        payload: normalized.payload,
        signature_verified: true,
        status: 'pending',
        attempts: 1,
        received_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'event_id',
        ignoreDuplicates: true
      });

    if (error) {
      // Return a retryable response if durable storage failed.
      console.error('Monime webhook inbox insert failed', { code: error.code });
      return res.status(503).json({ error: 'Webhook storage unavailable.' });
    }

    // Acknowledge only after the signed event is durably stored.
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Monime webhook inbox unavailable', { failure: 'inbox_unavailable' });
    return res.status(503).json({ error: 'Webhook storage unavailable.' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') return runWorker(req, res);
  if (req.method === 'POST') return receiveWebhook(req, res);

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
