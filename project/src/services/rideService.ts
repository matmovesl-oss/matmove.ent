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
  for (let attempt = 0; attempt < 5; attempt++) {
    const { response, data, finish } = await walletFetch(urls[action], { bookingId });
    if (!response.ok) throw new Error(data.error || 'Unable to update this trip.');
    if (response.status === 200 && data.success === true && data.pending === false) {
      finish();
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