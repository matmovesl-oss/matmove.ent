import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { config } from '../api/monime-webhook.js';

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function setOrDelete(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('Monime worker route rejects missing and incorrect CRON_SECRET credentials', async () => {
  const previous = process.env.CRON_SECRET;
  const secret = 'test-cron-secret-that-is-long-enough-for-validation';

  try {
    delete process.env.CRON_SECRET;
    const missing = response();
    await handler({ method: 'GET', headers: {} }, missing);
    assert.equal(missing.statusCode, 401);

    process.env.CRON_SECRET = secret;
    const incorrect = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong-secret' } }, incorrect);
    assert.equal(incorrect.statusCode, 401);
  } finally {
    setOrDelete('CRON_SECRET', previous);
  }
});

test('Monime worker route returns unavailable when its privileged backend is not configured', async () => {
  const previous = {
    cron: process.env.CRON_SECRET,
    supabase: process.env.SUPABASE_URL,
    viteSupabase: process.env.VITE_SUPABASE_URL,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const secret = 'test-cron-secret-that-is-long-enough-for-validation';

  try {
    process.env.CRON_SECRET = secret;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = response();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${secret}` } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'Webhook worker unavailable.');
  } finally {
    setOrDelete('CRON_SECRET', previous.cron);
    setOrDelete('SUPABASE_URL', previous.supabase);
    setOrDelete('VITE_SUPABASE_URL', previous.viteSupabase);
    setOrDelete('SUPABASE_SERVICE_ROLE_KEY', previous.serviceRole);
  }
});

test('Monime route accepts only GET for worker and POST for signed webhook delivery', async () => {
  const res = response();
  await handler({ method: 'PUT', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
});


test('Monime webhook worker has an explicit bounded serverless execution window', () => {
  assert.equal(config.maxDuration, 60);
  assert.equal(config.api.bodyParser, false);
});

test('webhook route logs fixed diagnostic codes rather than raw backend exceptions', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../api/monime-webhook.js', import.meta.url), 'utf8');
  assert.match(source, /failure:\s*'worker_unavailable'/);
  assert.match(source, /failure:\s*'inbox_unavailable'/);
  assert.equal(source.includes('error?.message'), false);
});
