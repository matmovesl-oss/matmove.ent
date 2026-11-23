import { supabase } from '@/lib/supabase';

export async function walletFetch(
  url: string,
  body: Record<string, unknown>
) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('MatMove is offline. This server request was not sent. Reconnect and try again.');
  }
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    throw new Error(
      'Please sign in again before using your wallet.'
    );
  }

  const fingerprint = JSON.stringify({
    user: session.user.id,
    url,
    body,
  });

  const storageKey =
    `matmove-request:${fingerprint}`;

  let key: string | null = null;

  try {
    key = sessionStorage.getItem(storageKey);
  } catch {
    // Storage can be disabled by browser settings.
  }

  if (!key) {
    key = crypto.randomUUID();

    try {
      sessionStorage.setItem(storageKey, key);
    } catch {
      // The current request still has a request key.
    }
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  let data: any;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({
        ...body,
        idempotencyKey: key,
      }),
      signal: controller.signal,
    });

    if (
      !(
        response.headers.get('content-type') || ''
      ).includes('application/json')
    ) {
      throw new Error(
        'The payment API is unavailable. Try again shortly.'
      );
    }

    data = await response.clone().json();
  } catch (requestError) {
    if (controller.signal.aborted) {
      throw new Error(
        'The wallet request timed out. MatMove kept the same request reference. Refresh the transaction status before retrying.'
      );
    }
    throw requestError;
  } finally {
    window.clearTimeout(timeout);
  }

  if (
    !(
      response.headers.get('content-type') || ''
    ).includes('application/json')
  ) {
    throw new Error(
      'The payment API is unavailable. Try again shortly.'
    );
  }

  const data =
    await response.clone().json();

  if (
    url === '/api/create-monime-checkout' &&
    response.ok
  ) {
    try {
      sessionStorage.setItem(
        'matmove-checkout-request',
        storageKey
      );
    } catch {
      // Optional browser storage.
    }
  }

  if (url === '/api/get-live-wallet') {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Optional browser storage.
    }
  }

  // Keep the key for uncertain or pending results
  // so retrying does not create another payment.
  return {
    response,
    data,

    finish: () => {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Optional browser storage.
      }
    },
  };
}