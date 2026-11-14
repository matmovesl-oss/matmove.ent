import { supabase } from '@/lib/supabase';

type Participant = { id?: string; full_name?: string; phone?: string; phone_number?: string };
type TripContactCard = { bookingId: string; status?: string; rider?: Participant | null; driver?: Participant | null };

function mergeParticipant(previous: any, incoming: Participant | null | undefined) {
  if (!incoming) return previous ?? null;
  const phone = String(incoming.phone || incoming.phone_number || previous?.phone || previous?.phone_number || '');
  return {
    ...(previous || {}),
    ...incoming,
    full_name: incoming.full_name || previous?.full_name || '',
    phone,
    phone_number: phone,
  };
}

/**
 * Profile RLS intentionally prevents one customer/driver from reading another
 * profile directly. This RPC returns only the two participant contact cards
 * for bookings the signed-in customer or driver is allowed to see.
 */
export async function attachTripContacts<T extends { id: string; rider?: any; driver?: any }>(rows: T[]): Promise<T[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = [...new Set(rows.map(row => row.id).filter(id => typeof id === 'string' && id.length > 0))].slice(0, 100);
  if (!ids.length) return rows;
  try {
    const { data, error } = await supabase.rpc('matmove_trip_contact_cards', { p_booking_ids: ids });
    if (error || !Array.isArray(data)) return rows;
    const cards = new Map<string, TripContactCard>(
      data.filter((item: any) => item && ids.includes(item.bookingId)).map((item: TripContactCard) => [item.bookingId, item])
    );
    return rows.map(row => {
      const card = cards.get(row.id);
      if (!card) return row;
      return {
        ...row,
        rider: mergeParticipant(row.rider, card.rider),
        driver: mergeParticipant(row.driver, card.driver),
      };
    });
  } catch {
    // A contact-card outage must never hide the booking or block status sync.
    return rows;
  }
}
