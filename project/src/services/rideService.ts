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

export async function readRidePayment(bookingId: string) {
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=status', { bookingId });
  if (!response.ok) throw new Error(data.error || 'Unable to read ride payment details.');
  finish();
  return data;
}
/** Read the cash ledger snapshot for a booking participant. This is a read-only
 * operation; it never records a confirmation or creates a Monime transfer. */
export async function readCashRideStatus(bookingId: string) {
  if (!bookingId) throw new Error('A cash ride booking is required.');
  const { response, data, finish } = await walletFetch('/api/accept-ride-escrow?action=cash_status', { bookingId });
  if (!response.ok || data?.success !== true || data?.pending !== false ||
      data?.booking?.id !== bookingId || !data?.payment ||
      typeof data.payment.driverCashConfirmed !== 'boolean' ||
      typeof data.payment.riderCashConfirmed !== 'boolean') {
    throw new Error(data?.error || 'Cash collection status could not be verified.');
  }
  finish();
  return data;
}
