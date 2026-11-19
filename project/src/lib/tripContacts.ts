import { supabase } from '@/lib/supabase';

type Participant = { id?: string; full_name?: string; phone?: string; phone_number?: string; vehicle_type?: string | null; plate_number?: string | null };
type TripContactCard = { bookingId: string; status?: string; rider?: Participant | null; driver?: Participant | null; payment?: any; investigation?: any };

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
 * profile directly. This RPC returns only participant contact cards for
 * bookings the signed-in customer or driver is allowed to see.
 */
export async function attachTripContacts<T extends { id: string; rider?: any; driver?: any }>(rows: T[]): Promise<T[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = [...new Set(rows.map(row => row.id).filter(id => typeof id === 'string' && id.length > 0))];
  if (!ids.length) return rows;
  try {
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
    const batches = await Promise.all(chunks.map(async chunk => {
      try {
        const { data, error } = await supabase.rpc('matmove_trip_contact_cards', { p_booking_ids: chunk });
        return error || !Array.isArray(data) ? [] : data.filter((item: any) => item && chunk.includes(item.bookingId));
      } catch {
        return [];
      }
    }));
    const cards = new Map<string, TripContactCard>(
      batches.flat().map((item: TripContactCard) => [item.bookingId, item])
    );
    return rows.map(row => {
      const card = cards.get(row.id);
      if (!card) return row;
      return {
        ...row,
        rider: mergeParticipant(row.rider, card.rider),
        driver: mergeParticipant(row.driver, card.driver),
        paymentInfo: card.payment ?? (row as any).paymentInfo ?? null,
        paymentIssue: card.investigation ?? (row as any).paymentIssue ?? null,
      };
    });
  } catch {
    // A contact/payment-card outage must never hide a booking or block status sync.
    return rows;
  }
}
