export type TripPeriod = '30' | '90' | 'all';
export type TripStatusFilter = 'all' | 'pending' | 'pending_admin' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';

export function filterTripHistory<T extends { status?: string | null; created_at?: unknown }>(
  trips: T[],
  period: TripPeriod,
  statusFilter: TripStatusFilter,
  now = Date.now()
): T[] {
  const cutoff = period === 'all' ? null : now - (period === '30' ? 30 : 90) * 24 * 60 * 60 * 1000;
  return trips.filter(trip => {
    if (statusFilter !== 'all' && trip.status !== statusFilter) return false;
    if (cutoff === null) return true;
    const createdAt = Date.parse(String(trip.created_at || ''));
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}
