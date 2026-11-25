import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

type WebhookPayload = {
  type?: string;
  schema?: string;
  table?: string;
  record?: {
    id?: string;
    deleted_at?: string | null;
    recipient_count?: number;
  };
};

type PushToken = { token: string; platform: 'ios' | 'android' };
type DispatchContext = {
  message_id: string;
  destination: string | null;
  tokens: PushToken[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,255}\]$/;
const DESTINATIONS = new Set(['home', 'wallet', 'trips', 'games', 'account', 'kyc']);
const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function getSupabaseApiKey(): string {
  const rawKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (rawKeys) {
    try {
      const keys = JSON.parse(rawKeys) as Record<string, unknown>;
      const key = keys.default;
      if (typeof key === 'string' && key.trim()) return key.trim();
    } catch {
      // Fall through to the legacy server key while the project completes key migration.
    }
  }

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy?.trim()) return legacy.trim();
  throw new Error('Supabase server secret is not configured.');
}

async function callServiceRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const baseUrl = Deno.env.get('SUPABASE_URL')?.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Supabase URL is not configured.');

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: getSupabaseApiKey(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  let payload: unknown = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error('Supabase returned an invalid push dispatch response.');
  }

  if (!response.ok) {
    throw new Error(`Supabase push RPC failed with status ${response.status}.`);
  }
  return payload as T;
}

async function removeInvalidToken(token: string): Promise<void> {
  try {
    await callServiceRpc<boolean>('matmove_push_remove_invalid_token', { p_token: token });
  } catch {
    // A stale token must never cause the notification job to leak token data or crash cleanup.
    console.error('MatMove could not remove an Expo-rejected device token.');
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const configuredSecret = Deno.env.get('MATMOVE_PUSH_WEBHOOK_SECRET')?.trim();
  if (!configuredSecret || configuredSecret.length < 32) {
    return json({ error: 'Push webhook authentication is not configured.' }, 503);
  }

  const suppliedSecret = request.headers.get('x-matmove-push-secret') ?? '';
  if (!constantTimeEqual(suppliedSecret, configuredSecret)) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json() as WebhookPayload;
  } catch {
    return json({ error: 'Invalid webhook payload.' }, 400);
  }

  if (payload.type !== 'UPDATE' || payload.schema !== 'public' ||
      payload.table !== 'matmove_notification_messages' ||
      !payload.record || typeof payload.record.id !== 'string' ||
      !UUID.test(payload.record.id)) {
    return json({ error: 'Unsupported notification event.' }, 400);
  }

  // The message row is updated after all per-customer inbox rows are inserted.
  // Ignore later soft-delete updates so deleted messages are never pushed.
  if (payload.record.deleted_at) return json({ ok: true, skipped: 'message-deleted' });
  if (typeof payload.record.recipient_count !== 'number' || payload.record.recipient_count < 1) {
    return json({ ok: true, skipped: 'no-recipients' });
  }

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN')?.trim();
  if (!expoAccessToken) return json({ error: 'Expo push credentials are not configured.' }, 503);

  let context: DispatchContext | null;
  try {
    context = await callServiceRpc<DispatchContext | null>(
      'matmove_push_dispatch_context',
      { p_message_id: payload.record.id }
    );
  } catch {
    console.error('MatMove could not load the push dispatch context.');
    return json({ error: 'Notification delivery could not be prepared.' }, 502);
  }

  if (!context || context.message_id !== payload.record.id || !Array.isArray(context.tokens)) {
    return json({ ok: true, skipped: 'message-unavailable' });
  }

  const tokens = context.tokens.filter((item): item is PushToken =>
    !!item && typeof item.token === 'string' && TOKEN.test(item.token) &&
    (item.platform === 'ios' || item.platform === 'android')
  );
  if (tokens.length === 0) return json({ ok: true, sent: 0, skipped: 'no-registered-devices' });

  const destination = typeof context.destination === 'string' && DESTINATIONS.has(context.destination)
    ? context.destination
    : undefined;
  let sent = 0;
  let failed = 0;
  let removed = 0;

  // Expo accepts at most 100 push messages in one request.
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const batch = tokens.slice(offset, offset + 100);
    const messages = batch.map(({ token }) => ({
      to: token,
      title: 'MatMove',
      body: 'You have a new message in your MatMove inbox.',
      sound: 'default',
      channelId: 'default',
      priority: 'high',
      data: destination ? { destination } : {}
    }));

    let response: Response;
    try {
      response = await fetch(EXPO_SEND_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expoAccessToken}`
        },
        body: JSON.stringify(messages)
      });
    } catch {
      return json({ error: 'Expo push service could not be reached.' }, 502);
    }

    let result: { data?: Array<{ status?: string; details?: { error?: string } }> };
    try {
      result = await response.json() as typeof result;
    } catch {
      return json({ error: 'Expo returned an invalid push response.' }, 502);
    }
    if (!response.ok || !Array.isArray(result.data) || result.data.length !== batch.length) {
      return json({ error: 'Expo could not accept the MatMove push batch.' }, 502);
    }

    for (let index = 0; index < result.data.length; index += 1) {
      const ticket = result.data[index];
      if (ticket.status === 'ok') {
        sent += 1;
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        await removeInvalidToken(batch[index].token);
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }

  console.info('MatMove push dispatch completed.', {
    messageId: payload.record.id,
    sent,
    failed,
    removed
  });

  if (failed > 0) return json({ ok: false, sent, failed, removed }, 502);
  return json({ ok: true, sent, failed, removed });
});
