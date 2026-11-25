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
  assert.match(source, /matmove_push_dispatch_context/);
  assert.match(source, /EXPO_ACCESS_TOKEN/);
  assert.match(source, /DeviceNotRegistered/);
  assert.match(source, /offset \+= 100/);
  assert.match(source, /You have a new message in your MatMove inbox\./);
  assert.doesNotMatch(source, /payload\.record\.body/);
  assert.doesNotMatch(source, /payload\.record\.title/);
  assert.match(source, /x-matmove-push-secret/);
});
