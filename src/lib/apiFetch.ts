import { supabase } from '@/lib/supabase';

export async function walletFetch(
  url: string,
  body: Record<string, unknown>
) {
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:
        `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      ...body,
      idempotencyKey: key,
    }),
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