import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const functionSource = () => readFile(
  new URL('../supabase/functions/matmove-push/index.ts', import.meta.url),
  'utf8'
);

test('native push webhook authenticates server-to-server calls and sends generic, content-free alerts', async () => {
  const source = await functionSource();

  assert.match(source, /MATMOVE_PUSH_WEBHOOK_SECRET/);
  assert.match(source, /x-matmove-push-secret/);
  assert.match(source, /constantTimeEqual/);
  assert.match(source, /payload\.type !== 'UPDATE'/);
  assert.match(source, /payload\.table !== 'matmove_notification_messages'/);
  assert.match(source, /payload\.record\.recipient_count <= payload\.old_record\.recipient_count/);
  assert.match(source, /matmove_push_dispatch_context/);
  assert.match(source, /EXPO_ACCESS_TOKEN/);
  assert.match(source, /DeviceNotRegistered/);
  assert.match(source, /offset \+= 100/);
  assert.match(source, /You have a new message in your MatMove inbox\./);
  assert.doesNotMatch(source, /payload\.record\.body/);
  assert.doesNotMatch(source, /payload\.record\.title/);
  assert.match(source, /x-matmove-push-secret/);
});


test('native push delivery uses a Vault-backed secret and only dispatches after inbox fan-out', async () => {
  const source = await functionSource();
  const migration = await readFile(
    new URL('../supabase/migrations/20261125151000_matmove_native_push_webhook_v1.sql', import.meta.url),
    'utf8'
  );

  assert.match(source, /matmove_push_verify_webhook_secret/);
  assert.match(source, /SUPABASE_SECRET_KEYS/);
  assert.ok(source.includes("Authorization: `Bearer ${apiKey}`"));
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /matmove_push_verify_webhook_secret/);
  assert.match(migration, /grant execute on function public\.matmove_push_verify_webhook_secret\(text\)\s+to service_role/i);
  assert.match(migration, /net\.http_post/);
  assert.match(migration, /x-matmove-push-secret/);
  assert.match(migration, /after update of recipient_count/i);
  assert.match(migration, /when \(new\.recipient_count > old\.recipient_count\)/i);
  assert.doesNotMatch(migration, /EXPO_ACCESS_TOKEN\s*[:=]/i);
});
