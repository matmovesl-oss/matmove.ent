import { withSupabase } from "npm:@supabase/server@1";

const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$/;
const DESTINATIONS = new Set(["home", "wallet", "trips", "games", "account", "kyc"]);
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";

type MessageRecord = { id: string };
type PushTokenRow = { user_id: string; expo_push_token: string };
type ExpoTicket = { status?: string; details?: { error?: string } };

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function removeDeadToken(
  supabaseAdmin: any,
  userId: string,
  token: string,
) {
  const { error } = await supabaseAdmin
    .from("matmove_push_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("expo_push_token", token);
  if (error) throw new Error("Could not remove an expired device token.");
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request, ctx) => {
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });
    if (!EXPO_ACCESS_TOKEN) {
      return json(503, { error: "Native push delivery is not configured on this server." });
    }

    let payload: {
      type?: unknown;
      table?: unknown;
      schema?: unknown;
      record?: MessageRecord;
    };
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "Invalid webhook payload." });
    }

    if (payload.type !== "INSERT" || payload.schema !== "public" ||
        payload.table !== "matmove_notification_messages") {
      return json(400, { error: "Unsupported notification event." });
    }

    const record = payload.record;
    if (!record || typeof record.id !== "string" || !UUID.test(record.id)) {
      return json(400, { error: "Invalid notification message reference." });
    }

    try {
      const supabaseAdmin = ctx.supabaseAdmin;

      // One webhook per Admin message; resolve recipients from the trusted inbox.
      const { data: message, error: messageError } = await supabaseAdmin
        .from("matmove_notification_messages")
        .select("id,destination")
        .eq("id", record.id)
        .maybeSingle();
      if (messageError) throw new Error("Could not verify the notification message.");
      if (!message) return json(202, { ok: true, skipped: "Notification message no longer exists." });

      const recipientIds = new Set<string>();
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data: recipients, error: recipientError } = await supabaseAdmin
          .from("matmove_notification_inbox")
          .select("user_id")
          .eq("message_id", record.id)
          .order("user_id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (recipientError) throw new Error("Could not resolve notification recipients.");
        for (const recipient of recipients ?? []) {
          if (typeof recipient.user_id === "string" && UUID.test(recipient.user_id)) {
            recipientIds.add(recipient.user_id);
          }
        }
        if (!recipients || recipients.length < pageSize) break;
      }

      const userIds = [...recipientIds];
      if (!userIds.length) return json(200, { ok: true, recipients: 0, devices: 0, sent: 0 });

      const destination = message.destination;
      const safeDestination = typeof destination === "string" && DESTINATIONS.has(destination)
        ? destination
        : null;

      const tokens: PushTokenRow[] = [];
      for (let offset = 0; offset < userIds.length; offset += 500) {
        const userBatch = userIds.slice(offset, offset + 500);
        const { data: rows, error: tokenError } = await supabaseAdmin
          .from("matmove_push_tokens")
          .select("user_id,expo_push_token")
          .in("user_id", userBatch);
        if (tokenError) throw new Error("Could not load registered device tokens.");
        for (const row of rows ?? []) {
          if (UUID.test(row.user_id) && EXPO_TOKEN.test(row.expo_push_token)) tokens.push(row);
        }
      }

      if (!tokens.length) {
        return json(200, { ok: true, recipients: userIds.length, devices: 0, sent: 0 });
      }

      let sent = 0;
      let failed = 0;
      for (let offset = 0; offset < tokens.length; offset += 100) {
        const batch = tokens.slice(offset, offset + 100);
        const messagesToSend = batch.map((row) => ({
          to: row.expo_push_token,
          title: "MatMove",
          // Keep private inbox content off lock screens.
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
            await removeDeadToken(supabaseAdmin, batch[index].user_id, batch[index].expo_push_token);
          } else {
            failed += 1;
          }
        }
      }

      if (failed > 0) {
        return json(502, {
          error: "One or more push notifications could not be accepted.",
          sent,
          failed,
        });
      }
      return json(200, {
        ok: true,
        recipients: userIds.length,
        devices: tokens.length,
        sent,
        failed,
      });
    } catch (error) {
      console.error(
        "MatMove native push delivery failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return json(502, { error: "MatMove could not deliver this device notification." });
    }
  }),
};
