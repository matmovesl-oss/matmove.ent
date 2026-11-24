import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

type InboxRecord = {
  id: number | string;
  message_id: string;
  user_id: string;
  read_at: string | null;
};

type DatabaseWebhookPayload = {
  type: 'INSERT';
  table: 'matmove_notification_inbox';
  schema: 'public';
  record: InboxRecord;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,256}\]$/;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const webhookSecret = Deno.env.get('MATMOVE_PUSH_WEBHOOK_SECRET');
  if (!webhookSecret || request.headers.get('x-matmove-push-secret') !== webhookSecret) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!expoAccessToken || !supabaseUrl || !secretKeysRaw) {
    return json({ error: 'Push delivery is not configured.' }, 503);
  }

  let serviceKey: string;
  try {
    const secretKeys = JSON.parse(secretKeysRaw);
    serviceKey = secretKeys.default;
  } catch {
    return json({ error: 'Push service credentials are unavailable.' }, 503);
  }
  if (typeof serviceKey !== 'string' || !serviceKey) {
    return json({ error: 'Push service credentials are unavailable.' }, 503);
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid webhook payload.' }, 400);
  }

  const record = payload?.record;
  if (payload?.type !== 'INSERT' || payload.table !== 'matmove_notification_inbox' ||
      payload.schema !== 'public' || !record || !UUID.test(record.message_id) ||
      !UUID.test(record.user_id) || !/^[1-9][0-9]{0,18}$/.test(String(record.id))) {
    return json({ error: 'Unsupported notification event.' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: message, error: messageError } = await supabase
    .from('matmove_notification_messages')
    .select('id,destination')
    .eq('id', record.message_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (messageError) {
    console.error('MatMove push message lookup failed:', messageError.message);
    return json({ error: 'Notification lookup failed.' }, 502);
  }
  if (!message) return json({ sent: 0, reason: 'Notification was removed.' });

  const { data: tokens, error: tokenError } = await supabase
    .from('matmove_push_tokens')
    .select('id,expo_push_token')
    .eq('user_id', record.user_id)
    .is('disabled_at', null)
    .limit(20);

  if (tokenError) {
    console.error('MatMove push token lookup failed:', tokenError.message);
    return json({ error: 'Device lookup failed.' }, 502);
  }

  const validTokens = (tokens ?? []).filter((item: any) =>
    typeof item.id === 'string' && typeof item.expo_push_token === 'string' &&
    TOKEN.test(item.expo_push_token)
  );
  if (!validTokens.length) return json({ sent: 0, reason: 'No active devices.' });

  const messages = validTokens.map((item: any) => ({
    to: item.expo_push_token,
    title: 'MatMove update',
    body: 'You have a new notification. Open MatMove to view it.',
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    collapseId: `matmove-inbox-${record.id}`,
    data: {
      destination: typeof message.destination === 'string' ? message.destination : 'notifications',
      inboxId: String(record.id)
    }
  }));

  let sent = 0;
  let disabled = 0;
  for (let offset = 0; offset < messages.length; offset += 100) {
    const batch = messages.slice(offset, offset + 100);
    const batchTokens = validTokens.slice(offset, offset + 100);
    let response: Response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${expoAccessToken}`
        },
        body: JSON.stringify(batch)
      });
    } catch {
      return json({ error: 'Expo push service could not be reached.', sent, disabled }, 502);
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.data)) {
      console.error('MatMove Expo push request failed:', response.status);
      return json({ error: 'Expo could not accept the notification.', sent, disabled }, 502);
    }

    for (let i = 0; i < result.data.length; i++) {
      const ticket = result.data[i];
      const device = batchTokens[i];
      if (ticket?.status === 'ok') {
        sent++;
      } else if (ticket?.details?.error === 'DeviceNotRegistered') {
        const { error } = await supabase.from('matmove_push_tokens')
          .update({ disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', device.id);
        if (!error) disabled++;
      }
    }
  }

  return json({ sent, disabled });
});
