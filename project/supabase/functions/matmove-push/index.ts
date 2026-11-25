const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TOKEN = /^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{8,256}\\]$/;
const DESTINATIONS = new Set(["home", "wallet", "trips", "games", "account", "kyc"]);
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";

type InboxRecord = {
  id: string | number;
  user_id: string;
  message_id: string;
};
type PushTokenRow = { expo_push_token: string };
type ExpoTicket = { status?: string; details?: { error?: string } };

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validInboxId(value: unknown): value is string | number {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]{0,18}$/.test(text)) return false;
  try {
    return BigInt(text) <= 9223372036854775807n;
  } catch {
    return false;
  }
}

function restUrl(table: string, filters: Record<string, string>, select: string) {
  const url = new URL(SUPABASE_URL + "/rest/v1/" + table);
  url.searchParams.set("select", select);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return url;
}

async function supabaseRest<T>(
  table: string,
  filters: Record<string, string>,
  select: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(restUrl(table, filters, select), {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error("Supabase request failed with status " + response.status + ".");
  if (response.status === 204) return [] as T;
  return await response.json() as T;
}

async function removeDeadToken(userId: string, token: string) {
  const url = restUrl("matmove_push_tokens", {
    user_id: "eq." + userId,
    expo_push_token: "eq." + token,
  }, "id");
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      prefer: "return=minimal",
    },
  });
  if (!response.ok) throw new Error("Could not remove an expired device token (HTTP " + response.status + ").");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !EXPO_ACCESS_TOKEN) {
    return json(503, { error: "Native push delivery is not configured on this server." });
  }

  let payload: { type?: unknown; table?: unknown; schema?: unknown; record?: InboxRecord };
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "Invalid webhook payload." });
  }

  if (payload.type !== "INSERT" || payload.schema !== "public" ||
      payload.table !== "matmove_notification_inbox") {
    return json(400, { error: "Unsupported notification event." });
  }

  const record = payload.record;
  if (!record || !validInboxId(record.id) ||
      typeof record.user_id !== "string" || !UUID.test(record.user_id) ||
      typeof record.message_id !== "string" || !UUID.test(record.message_id)) {
    return json(400, { error: "Invalid notification recipient record." });
  }

  try {
    // Confirm the webhook references a real inbox row and recipient before using service access.
    const inboxRows = await supabaseRest<Array<{ id: string }>>(
      "matmove_notification_inbox",
      {
        id: "eq." + String(record.id),
        user_id: "eq." + record.user_id,
        message_id: "eq." + record.message_id,
      },
      "id",
    );
    if (inboxRows.length !== 1) return json(202, { ok: true, skipped: "Inbox row no longer exists." });

    const messages = await supabaseRest<Array<{ destination: string | null }>>(
      "matmove_notification_messages",
      { id: "eq." + record.message_id },
      "destination",
    );
    if (messages.length !== 1) return json(202, { ok: true, skipped: "Notification message no longer exists." });

    const destination = messages[0].destination;
    const safeDestination = typeof destination === "string" && DESTINATIONS.has(destination)
      ? destination
      : null;

    const rows = await supabaseRest<PushTokenRow[]>(
      "matmove_push_tokens",
      { user_id: "eq." + record.user_id },
      "expo_push_token",
    );
    const tokens = [...new Set(rows
      .map((row) => row.expo_push_token)
      .filter((token) => EXPO_TOKEN.test(token)))];

    if (!tokens.length) return json(200, { ok: true, devices: 0, sent: 0 });

    let sent = 0;
    let failed = 0;
    for (let offset = 0; offset < tokens.length; offset += 100) {
      const batch = tokens.slice(offset, offset + 100);
      const messagesToSend = batch.map((to) => ({
        to,
        title: "MatMove",
        // Do not expose private inbox text on a lock screen.
        body: "You have a new notification. Open MatMove to view it.",
        sound: "default",
        channelId: "default",
        data: safeDestination ? { destination: safeDestination } : {},
      }));

      const expoResponse = await fetch(EXPO_SEND_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer " + EXPO_ACCESS_TOKEN,
        },
        body: JSON.stringify(messagesToSend),
      });
      if (!expoResponse.ok) {
        throw new Error("Expo push service returned HTTP " + expoResponse.status + ".");
      }

      const result = await expoResponse.json() as { data?: ExpoTicket[] | ExpoTicket };
      const tickets = Array.isArray(result.data)
        ? result.data
        : result.data ? [result.data] : [];

      for (let index = 0; index < batch.length; index += 1) {
        const ticket = tickets[index];
        if (ticket?.status === "ok") {
          sent += 1;
        } else if (ticket?.details?.error === "DeviceNotRegistered") {
          await removeDeadToken(record.user_id, batch[index]);
        } else {
          failed += 1;
        }
      }
    }

    if (failed > 0) return json(502, { error: "One or more push notifications could not be accepted.", sent, failed });
    return json(200, { ok: true, devices: tokens.length, sent, failed });
  } catch (error) {
    console.error("MatMove native push delivery failed:", error instanceof Error ? error.message : "Unknown error");
    return json(502, { error: "MatMove could not deliver this device notification." });
  }
});
