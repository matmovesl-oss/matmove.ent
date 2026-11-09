import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalizeEnvelope, verifyMonimeSignature } from '../server/monime-webhook-inbox.js';

const secret = 'test-secret-with-more-than-thirty-two-characters';
const now = 1_800_000_000;
const raw = Buffer.from('{"event":{"id":"wke-test123","name":"internal_transfer.completed"},"object":{"id":"tr-test123","type":"internal_transfer"},"data":{}}');

function signature(body = raw, timestamp = now, key = secret) {
  const digest = createHmac('sha256', key).update(String(timestamp) + '_').update(body).digest('base64');
  return `t=${timestamp},v1=${digest}`;
}

test('accepts valid HMAC over exact raw bytes', () => {
  assert.equal(verifyMonimeSignature(raw, signature(), secret, now), true);
});

test('rejects tampered body and signature', () => {
  assert.equal(verifyMonimeSignature(Buffer.from(raw.toString() + ' '), signature(), secret, now), false);
  assert.equal(verifyMonimeSignature(raw, signature().replace(/.$/, 'A'), secret, now), false);
});

test('rejects stale and future timestamps', () => {
  assert.equal(verifyMonimeSignature(raw, signature(raw, now - 301), secret, now), false);
  assert.equal(verifyMonimeSignature(raw, signature(raw, now + 61), secret, now), false);
});

test('rejects missing or weak signing secret', () => {
  assert.equal(verifyMonimeSignature(raw, signature(), 'too-short', now), false);
  assert.equal(verifyMonimeSignature(raw, null, secret, now), false);
});

test('normalizes documented Monime envelope without guessing fields', () => {
  const normalized = normalizeEnvelope(JSON.parse(raw.toString()));
  assert.equal(normalized.eventId, 'wke-test123');
  assert.equal(normalized.eventType, 'internal_transfer.completed');
  assert.equal(normalized.objectId, 'tr-test123');
  assert.equal(normalized.objectType, 'internal_transfer');
});

test('rejects malformed event envelopes', () => {
  assert.throws(() => normalizeEnvelope({ event: { id: 'not-an-event-id', name: 'x' }, object: { id: '1', type: 'x' }, data: {} }));
  assert.throws(() => normalizeEnvelope({ event: { id: 'wke-ok', name: 'x' }, object: { id: '1' }, data: {} }));
});
