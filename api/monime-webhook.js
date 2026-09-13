import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BODY_BYTES = 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let settled = false;

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }

      size += Buffer.byteLength(chunk, 'utf8');

      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('Webhook payload is too large.'));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(body);
      }
    });

    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || '';
  }

  return value || '';
}

function getHeaderNames(req) {
  return Object.keys(req.headers || {}).map((name) =>
    String(name).toLowerCase()
  );
}

function summarizeHeaderValue(name, value) {
  const normalizedName = String(name || '').toLowerCase();
  const text = String(value || '');

  /*
   * Never log credential values.
   */
  const sensitiveNames = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'monime-signature',
    'signature',
    'x-signature',
  ]);

  if (sensitiveNames.has(normalizedName)) {
    return {
      present: Boolean(text),
      length: text.length,
    };
  }

  return {
    present: Boolean(text),
    length: text.length,
    prefix: text.slice(0, 40),
  };
}

function getEventId(payload) {
  return (
    payload?.event?.id ||
    payload?.eventId ||
    payload?.event_id ||
    payload?.id ||
    null
  );
}

function getEventType(payload) {
  return (
    payload?.event?.name ||
    payload?.event?.type ||
    payload?.eventType ||
    payload?.event_type ||
    payload?.type ||
    null
  );
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      error: 'Method not allowed.',
    });
  }

  try {
    const rawBody = await readRawBody(req);

    let payload = null;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({
        error: 'Invalid JSON payload.',
      });
    }

    const headerNames = getHeaderNames(req);

    const headerSummary = {};

    for (const name of headerNames) {
      headerSummary[name] = summarizeHeaderValue(
        name,
        getHeader(req, name)
      );
    }

    const signatureCandidateHeaders = [
      'monime-signature',
      'signature',
      'x-signature',
      'x-monime-signature',
      'monime-webhook-signature',
    ];

    const signatureHeaderPresence = {};

    for (const name of signatureCandidateHeaders) {
      const value = getHeader(req, name);

      signatureHeaderPresence[name] = {
        present: Boolean(value),
        length: String(value || '').length,
      };
    }

    const eventId = getEventId(payload);
    const eventType = getEventType(payload);

    /*
     * Diagnostic logging:
     *
     * - Header NAMES are safe to log.
     * - Credential/signature VALUES are never logged.
     */
    console.log(
      'MONIME WEBHOOK DIAGNOSTIC',
      JSON.stringify(
        {
          method: req.method,
          rawBodyLength: Buffer.byteLength(rawBody, 'utf8'),
          eventId,
          eventType,
          headerNames,
          signatureHeaderPresence,
          headerSummary,
          timestamp:
            payload?.event?.timestamp || null,
        },
        null,
        2
      )
    );

    /*
     * Return 200 temporarily so Monime stops retrying this
     * diagnostic request immediately.
     *
     * IMPORTANT:
     * This version does NOT settle wallets.
     */
    return res.status(200).json({
      received: true,
      diagnostic: true,
      event_id: eventId,
      event_type: eventType,
      signature_headers: signatureHeaderPresence,
      message:
        'Diagnostic webhook received. No financial settlement performed.',
    });
  } catch (error) {
    console.error(
      'Monime diagnostic webhook exception:',
      error
    );

    return res.status(500).json({
      error: 'Internal Server Error.',
    });
  }
}

export default handler;