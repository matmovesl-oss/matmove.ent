import { walletFetch } from '@/lib/apiFetch';

type RideAction = 'accept' | 'start' | 'complete' | 'cancel' | 'cash_reserve' | 'cash_confirm';
const urls: Record<RideAction, string> = {
  accept: '/api/accept-ride-escrow', start: '/api/start-ride',
  complete: '/api/complete-ride-payout', cancel: '/api/cancel-ride',
  cash_reserve: '/api/accept-ride-escrow?action=cash_reserve',
  cash_confirm: '/api/accept-ride-escrow?action=cash_confirm',
};

const pendingRideActionIds = new Map<string, string>();

function getRideActionRequestId(action: RideAction, bookingId: string): string | undefined {
  if (!['accept', 'cancel'].includes(action)) return undefined;
  const key = `matmove:ride-action:${action}:${bookingId}`;
  const cached = pendingRideActionIds.get(key);
  if (cached) return cached;

  try {
    const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
    if (stored && /^[0-9a-f-]{36}$/i.test(stored)) {
      pendingRideActionIds.set(key, stored);
      return stored;
    }
  } catch {
    // Browser storage may be disabled; in-memory reuse still covers retries.
  }

  const requestId = crypto.randomUUID();
  pendingRideActionIds.set(key, requestId);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, requestId);
  } catch {
    // Keep the in-memory ID if session storage is unavailable.
  }
  return requestId;
}

function clearRideActionRequestId(action: RideAction, bookingId: string): void {
  if (!['accept', 'cancel'].includes(action)) return;
  const key = `matmove:ride-action:${action}:${bookingId}`;
  pendingRideActionIds.delete(key);
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
  } catch {
    // The database still enforces idempotency if browser storage is blocked.
  }
}

export async function updateRide(action: RideAction, bookingId: string) {
  // Reuse the same ID after a timeout or lost response, including after reload.
  // The browser never supplies amounts, accounts, payout beneficiaries or ledger state.
  const requestId = getRideActionRequestId(action, bookingId);
  const body = requestId ? { bookingId, requestId } : { bookingId };
  for (let attempt = 0; attempt < 5; attempt++) {
    const { response, data, finish } = await walletFetch(urls[action], body);
    if (!response.ok) throw new Error(data.error || 'Unable to update this trip.');
    if (response.status === 200 && data.success === true && data.pending === false) {
      finish();
      clearRideActionRequestId(action, bookingId);
      return data;
    }
    if (response.status !== 202 || data.pending !== true) throw new Error('The backend did not verify settlement. Refresh the trip; do not make a new payment.');
    if (attempt === 4) return data;
    await new Promise(resolve => window.setTimeout(resolve, 2000));
  }
  throw new Error('Unable to read trip status.');
}

export async function readCashRideStatus(bookingId: string) {
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=cash_status', { bookingId });
  if (!response.ok || data?.success !== true || data?.pending !== false || !data?.payment) {
    throw new Error(data?.error || 'Unable to verify the cash handover status.');
  }
  finish();
  return data;
}

export async function readRidePayment(bookingId: string) {
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=status', { bookingId });
  if (!response.ok) throw new Error(data.error || 'Unable to read ride payment details.');
  finish();
  return data;
}