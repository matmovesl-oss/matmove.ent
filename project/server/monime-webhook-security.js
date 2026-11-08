import { createHmac, timingSafeEqual } from 'node:crypto';

export const MONIME_WEBHOOK_MAX_BYTES = 1024 * 1024;

export async function readMonimeRawBody(req, maxBytes = MONIME_WEBHOOK_MAX_BYTES) {
  const declaredLength = Number(req?.headers?.['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error('Webhook body is too large.');
    error.status = 413;
    throw error;
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    const error = new Error('Raw webhook request stream is unavailable.');
    error.status = 400;
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Webhook body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

/** Monime signs `<timestamp>_<raw body>` with HMAC-SHA256 and base64. */
export function verifyMonimeWebhookSignature(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || typeof signatureHeader !== 'string' ||
      typeof secret !== 'string' || secret.length === 0 || !Number.isSafeInteger(nowSeconds)) return false;

  const fields = Object.create(null);
  for (const segment of signatureHeader.split(',')) {
    const separator = segment.indexOf('=');
    if (separator < 1) return false;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (!key || !value || Object.hasOwn(fields, key)) return false;
    fields[key] = value;
  }

  const timestampText = fields.t;
  const signatureText = fields.v1;
  if (!/^\d{10}$/.test(timestampText || '') || !/^[A-Za-z0-9+/]{43}=$/.test(signatureText || '')) return false;

  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || timestamp < nowSeconds - 300 || timestamp > nowSeconds + 60) return false;

  const supplied = Buffer.from(signatureText, 'base64');
  if (supplied.length !== 32 || supplied.toString('base64') !== signatureText) return false;

  const expected = createHmac('sha256', secret)
    .update(timestampText, 'utf8')
    .update('_', 'utf8')
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, supplied);
}

export function parseMonimeWebhook(rawBody) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return null;
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      typeof event.id !== 'string' || !/^wke-[A-Za-z0-9_-]{1,120}$/.test(event.id) ||
      typeof event.type !== 'string' || !/^[a-z][a-z0-9_.-]{1,99}$/.test(event.type) ||
      !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  return event;
}
