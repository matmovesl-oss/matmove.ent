import { walletFetch } from '@/lib/apiFetch';

type RideAction = 'accept' | 'start' | 'complete' | 'cancel' | 'cash_reserve' | 'cash_confirm';
const urls: Record<RideAction, string> = {
  accept: '/api/accept-ride-escrow', start: '/api/start-ride',
  complete: '/api/complete-ride-payout', cancel: '/api/cancel-ride',
  cash_reserve: '/api/accept-ride-escrow?action=cash_reserve',
  cash_confirm: '/api/accept-ride-escrow?action=cash_confirm',
};

export async function updateRide(action: RideAction, bookingId: string) {
  // The browser sends only intent and booking ID. Amounts, financial accounts,
  // driver assignment, transfer keys and settlement all belong to the backend.
  // Cash confirmation is a one-shot mutation: pending settlement is recovered
  // with the read-only cash status endpoint, never by repeating the confirmation.
  if (action === 'cash_confirm') {
    const { response, data, finish } = await walletFetch(urls[action], { bookingId });
    try {
      if (!response.ok) throw new Error(data.error || 'Cash handover confirmation could not be verified.');
      if (![200, 202].includes(response.status) || typeof data.success !== 'boolean' || typeof data.pending !== 'boolean') {
        throw new Error('The backend did not return a verified cash confirmation state. Refresh the trip; do not repeat the cash collection.');
      }
      return data;
    } finally {
      finish();
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const { response, data, finish } = await walletFetch(urls[action], { bookingId });
    let pending = false;
    try {
      if (!response.ok) throw new Error(data.error || 'Unable to update this trip.');
      if (response.status === 200 && data.success === true && data.pending === false) return data;
      if (response.status !== 202 || data.pending !== true) throw new Error('The backend did not verify settlement. Refresh the trip; do not make a new payment.');
      pending = true;
      if (attempt === 4) return data;
    } finally {
      finish();
    }
    if (pending) await new Promise(resolve => window.setTimeout(resolve, 2000));
  }
  throw new Error('Unable to read trip status.');
}

export async function readCashRideStatus(bookingId: string) {
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=cash_status', { bookingId });
  try {
    if (!response.ok) throw new Error(data.error || 'Unable to refresh cash handover status.');
    if (data?.success !== true || !data.payment) throw new Error('The cash handover status could not be verified.');
    return data;
  } finally {
    finish();
  }
}

export async function readRidePayment(bookingId: string) {
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=status', { bookingId });
  try {
    if (!response.ok) throw new Error(data.error || 'Unable to read ride payment details.');
    return data;
  } finally {
    finish();
  }
}